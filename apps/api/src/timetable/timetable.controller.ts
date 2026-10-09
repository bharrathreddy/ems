import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseIntPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sql } from 'kysely';
import { z } from 'zod';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { resolveYear } from '../common/academic-year';
import { readJson } from '../common/json';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { visibleStudentId } from '../students/student-scope';
import { describeClash, findClashes } from './clashes';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour).');
const YearQuery = z.object({ yearId: z.coerce.number().int().positive().optional() });
const PeriodsBody = z.object({
  force: z.boolean().optional(),
  periods: z.array(z.object({
    id: z.number().int().positive().optional(),
    kind: z.enum(['period', 'break', 'lunch', 'assembly']),
    label: z.string().trim().min(1).max(40),
    start: time, end: time,
  })).min(1).max(20),
});
const SlotBody = z.object({ day: z.number().int().min(1).max(6), periodId: z.number().int().positive(), subjectId: z.number().int().positive().nullable() });
const CopyBody = z.object({ fromDay: z.number().int().min(1).max(6), toDays: z.array(z.number().int().min(1).max(6)).min(1) });
const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Bell schedules per class group, weekly timetable per section (Mon to Sat, same timings every day). */
@ApiTags('Timetable')
@ApiBearerAuth()
@Controller()
export class TimetableController {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService) {}

  // ---------------- Setup ----------------

  private async saturdaysOff(): Promise<number[]> {
    const r = await this.db.selectFrom('settings').select('value').where('setting_group', '=', 'calendar').where('setting_key', '=', 'saturdays_off').executeTakeFirst();
    return readJson<number[]>(r?.value) ?? [];
  }

  @Get('timetable/setup')
  @RequirePermission('timetable', 'view')
  async setup(@Query(new ZodPipe(YearQuery)) q: z.infer<typeof YearQuery>) {
    const year = await resolveYear(this.db, q.yearId, false);
    const [groups, members, periods, classes, slots] = await Promise.all([
      this.db.selectFrom('bell_groups').select(['id', 'name']).where('academic_year_id', '=', year.id).orderBy('id').execute(),
      this.db.selectFrom('bell_group_classes').select(['class_id', 'bell_group_id']).where('academic_year_id', '=', year.id).execute(),
      this.db.selectFrom('bell_periods as p').innerJoin('bell_groups as g', 'g.id', 'p.bell_group_id')
        .select(['p.id', 'p.bell_group_id', 'p.seq', 'p.kind', 'p.label', 'p.start_time', 'p.end_time']).where('g.academic_year_id', '=', year.id).orderBy('p.seq').execute(),
      this.db.selectFrom('classes').select(['id', 'name']).where('is_active', '=', 1).orderBy('level_order').execute(),
      this.db.selectFrom('timetable_slots').select(['bell_period_id', (eb) => eb.fn.countAll<number>().as('n')]).where('academic_year_id', '=', year.id).groupBy('bell_period_id').execute(),
    ]);
    const used = new Map(slots.map((s) => [s.bell_period_id, Number(s.n)]));
    return {
      year: { id: year.id, name: year.name, editable: year.status !== 'closed' },
      saturdaysOff: await this.saturdaysOff(),
      classes: classes.map((c) => ({ ...c, groupId: members.find((m) => m.class_id === c.id)?.bell_group_id ?? null })),
      groups: groups.map((g) => ({
        ...g,
        classIds: members.filter((m) => m.bell_group_id === g.id).map((m) => m.class_id),
        periods: periods.filter((p) => p.bell_group_id === g.id).map((p) => ({ id: p.id, kind: p.kind, label: p.label, start: p.start_time.slice(0, 5), end: p.end_time.slice(0, 5), slotsUsing: used.get(p.id) ?? 0 })),
      })),
    };
  }

  @Put('timetable/saturdays-off')
  @RequirePermission('timetable', 'manage')
  async setSaturdays(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ weeks: z.array(z.number().int().min(1).max(5)).max(5) }))) b: { weeks: number[] }, @Req() req: AppRequest) {
    const weeks = [...new Set(b.weeks)].sort();
    await this.db.insertInto('settings').values({ setting_group: 'calendar', setting_key: 'saturdays_off', value: JSON.stringify(weeks), updated_by: u.id })
      .onDuplicateKeyUpdate({ value: JSON.stringify(weeks), updated_by: u.id }).execute();
    await this.audit.log(u, { module: 'timetable', action: 'saturdays_off', after: weeks, ...clientMeta(req) });
    return { saturdaysOff: weeks };
  }

  /** Optional: start a planned year with last year's bell schedules (groups, classes, periods; no lessons). */
  @Post('timetable/copy-schedules')
  @HttpCode(200)
  @RequirePermission('timetable', 'manage')
  async copySchedules(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ fromYearId: z.number().int().positive(), toYearId: z.number().int().positive() }))) b: { fromYearId: number; toYearId: number }, @Req() req: AppRequest) {
    const from = await resolveYear(this.db, b.fromYearId, false);
    const to = await resolveYear(this.db, b.toYearId, true);
    const existing = await this.db.selectFrom('bell_groups').select('id').where('academic_year_id', '=', to.id).executeTakeFirst();
    if (existing) throw Errors.badRequest('ALREADY_SET_UP', `${to.name} already has bell schedules.`);
    await this.db.transaction().execute(async (trx) => {
      const groups = await trx.selectFrom('bell_groups').select(['id', 'name']).where('academic_year_id', '=', from.id).execute();
      for (const g of groups) {
        const r = await trx.insertInto('bell_groups').values({ academic_year_id: to.id, name: g.name }).executeTakeFirstOrThrow();
        const gid = Number(r.insertId);
        const periods = await trx.selectFrom('bell_periods').select(['seq', 'kind', 'label', 'start_time', 'end_time']).where('bell_group_id', '=', g.id).execute();
        if (periods.length) await trx.insertInto('bell_periods').values(periods.map((p) => ({ ...p, bell_group_id: gid }))).execute();
        const cls = await trx.selectFrom('bell_group_classes').select('class_id').where('bell_group_id', '=', g.id).execute();
        if (cls.length) await trx.insertInto('bell_group_classes').values(cls.map((c) => ({ academic_year_id: to.id, class_id: c.class_id, bell_group_id: gid }))).execute();
      }
      await this.audit.log(u, { module: 'timetable', action: 'copy_schedules', after: { from: from.name, to: to.name }, ...clientMeta(req) }, trx);
    });
    return this.setup({ yearId: to.id });
  }

  @Post('timetable/groups')
  @RequirePermission('timetable', 'manage')
  async createGroup(@CurrentUser() u: RequestUser, @Query(new ZodPipe(YearQuery)) q: z.infer<typeof YearQuery>, @Body(new ZodPipe(z.object({ name: z.string().trim().min(2).max(80) }))) b: { name: string }, @Req() req: AppRequest) {
    const year = await resolveYear(this.db, q.yearId, true);
    const r = await this.db.insertInto('bell_groups').values({ academic_year_id: year.id, name: b.name }).executeTakeFirstOrThrow();
    await this.audit.log(u, { module: 'timetable', action: 'create_group', entityType: 'bell_group', entityId: Number(r.insertId), after: b, ...clientMeta(req) });
    return { id: Number(r.insertId) };
  }

  private async groupForEdit(id: number) {
    const g = await this.db.selectFrom('bell_groups').select(['id', 'academic_year_id', 'name']).where('id', '=', id).executeTakeFirst();
    if (!g) throw Errors.notFound('Bell schedule');
    const year = await resolveYear(this.db, g.academic_year_id, true);
    return { g, year };
  }

  @Patch('timetable/groups/:id')
  @RequirePermission('timetable', 'manage')
  async renameGroup(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(z.object({ name: z.string().trim().min(2).max(80) }))) b: { name: string }, @Req() req: AppRequest) {
    await this.groupForEdit(id);
    await this.db.updateTable('bell_groups').set({ name: b.name }).where('id', '=', id).execute();
    await this.audit.log(u, { module: 'timetable', action: 'rename_group', entityType: 'bell_group', entityId: id, after: b, ...clientMeta(req) });
    return { id };
  }

  @Delete('timetable/groups/:id')
  @RequirePermission('timetable', 'manage')
  async deleteGroup(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Query('force') force: string | undefined, @Req() req: AppRequest) {
    await this.groupForEdit(id);
    const used = await this.db.selectFrom('timetable_slots as t').innerJoin('bell_periods as p', 'p.id', 't.bell_period_id').select((eb) => eb.fn.countAll<number>().as('n')).where('p.bell_group_id', '=', id).executeTakeFirst();
    if (Number(used?.n) > 0 && force !== '1') throw Errors.badRequest('GROUP_IN_USE', `${used!.n} timetable entries use this schedule. Confirm to delete them too.`);
    await this.db.deleteFrom('bell_groups').where('id', '=', id).execute();
    await this.audit.log(u, { module: 'timetable', action: 'delete_group', entityType: 'bell_group', entityId: id, ...clientMeta(req) });
    return { id };
  }

  /** Puts classes into this group (moving them out of any other). Their existing timetable entries would no longer fit, so they need confirming. */
  @Put('timetable/groups/:id/classes')
  @RequirePermission('timetable', 'manage')
  async setClasses(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(z.object({ classIds: z.array(z.number().int().positive()), force: z.boolean().optional() }))) b: { classIds: number[]; force?: boolean }, @Req() req: AppRequest) {
    const { year } = await this.groupForEdit(id);
    await this.db.transaction().execute(async (trx) => {
      const current = (await trx.selectFrom('bell_group_classes').select('class_id').where('bell_group_id', '=', id).execute()).map((r) => r.class_id);
      const others = await trx.selectFrom('bell_group_classes').select(['class_id', 'bell_group_id']).where('academic_year_id', '=', year.id).where('class_id', 'in', b.classIds.length ? b.classIds : [0]).where('bell_group_id', '!=', id).execute();
      const leaving = [...current.filter((c) => !b.classIds.includes(c)), ...others.map((o) => o.class_id)];
      if (leaving.length) {
        const slotIds = trx.selectFrom('timetable_slots as t').innerJoin('sections as s', 's.id', 't.section_id').select('t.id').where('t.academic_year_id', '=', year.id).where('s.class_id', 'in', leaving);
        const n = await trx.selectFrom('timetable_slots as t').innerJoin('sections as s', 's.id', 't.section_id').select((eb) => eb.fn.countAll<number>().as('n')).where('t.academic_year_id', '=', year.id).where('s.class_id', 'in', leaving).executeTakeFirst();
        if (Number(n?.n) > 0 && !b.force) throw Errors.badRequest('CLASSES_HAVE_TIMETABLE', `${n!.n} timetable entries belong to classes changing schedule. Confirm to clear them.`);
        const ids = (await slotIds.execute()).map((r) => r.id);
        if (ids.length) await trx.deleteFrom('timetable_slots').where('id', 'in', ids).execute();
        await trx.deleteFrom('bell_group_classes').where('academic_year_id', '=', year.id).where('class_id', 'in', leaving).execute();
      }
      const toAdd = b.classIds.filter((c) => !current.includes(c) || others.some((o) => o.class_id === c));
      if (toAdd.length) await trx.insertInto('bell_group_classes').values(toAdd.map((class_id) => ({ academic_year_id: year.id, class_id, bell_group_id: id }))).execute();
      await this.audit.log(u, { module: 'timetable', action: 'set_group_classes', entityType: 'bell_group', entityId: id, after: b, ...clientMeta(req) }, trx);
    });
    return { id, classIds: b.classIds };
  }

  /** Replaces the group's periods. Times must be in order without overlaps. New timings are re-checked for teacher clashes. */
  @Put('timetable/groups/:id/periods')
  @RequirePermission('timetable', 'manage')
  async setPeriods(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(PeriodsBody)) b: z.infer<typeof PeriodsBody>, @Req() req: AppRequest) {
    const { year } = await this.groupForEdit(id);
    const errors: Array<{ field: string; message: string }> = [];
    b.periods.forEach((p, i) => {
      if (p.end <= p.start) errors.push({ field: `periods.${i}.end`, message: `${p.label}: end must be after start.` });
      if (i > 0 && p.start < b.periods[i - 1].end) errors.push({ field: `periods.${i}.start`, message: `${p.label} starts before ${b.periods[i - 1].label} ends.` });
    });
    if (errors.length) throw Errors.validation(errors);
    await this.db.transaction().execute(async (trx) => {
      const existing = await trx.selectFrom('bell_periods').select(['id', 'kind']).where('bell_group_id', '=', id).execute();
      const keep = new Set(b.periods.map((p) => p.id).filter(Boolean));
      const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
      // A period that becomes a break can no longer hold lessons.
      const toBreak = b.periods.filter((p) => p.id && p.kind !== 'period').map((p) => p.id!);
      const affected = [...removed, ...toBreak];
      if (affected.length) {
        const n = await trx.selectFrom('timetable_slots').select((eb) => eb.fn.countAll<number>().as('n')).where('bell_period_id', 'in', affected).executeTakeFirst();
        if (Number(n?.n) > 0 && !b.force) throw Errors.badRequest('PERIODS_IN_USE', `${n!.n} timetable entries are in periods you removed or turned into breaks. Confirm to clear them.`);
        await trx.deleteFrom('timetable_slots').where('bell_period_id', 'in', affected).execute();
      }
      if (removed.length) await trx.deleteFrom('bell_periods').where('id', 'in', removed).execute();
      for (const [i, p] of b.periods.entries()) {
        const row = { seq: i + 1, kind: p.kind, label: p.label, start_time: `${p.start}:00`, end_time: `${p.end}:00` };
        if (p.id && existing.some((e) => e.id === p.id)) await trx.updateTable('bell_periods').set(row).where('id', '=', p.id).execute();
        else await trx.insertInto('bell_periods').values({ ...row, bell_group_id: id }).execute();
      }
      const clashes = await findClashes(trx, year.id);
      if (clashes.length) throw Errors.badRequest('TIMETABLE_CLASH', `These timings create a clash. ${describeClash(clashes[0])}`);
      await this.audit.log(u, { module: 'timetable', action: 'set_periods', entityType: 'bell_group', entityId: id, after: b.periods, ...clientMeta(req) }, trx);
    });
    return this.setup({ yearId: year.id });
  }

  // ---------------- Section timetable ----------------

  private async sectionTimetable(sectionId: number, yearId: number) {
    const sec = await this.db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id')
      .select(['s.id', 's.name', 'c.id as class_id', 'c.name as class_name']).where('s.id', '=', sectionId).executeTakeFirst();
    if (!sec) throw Errors.notFound('Section');
    const member = await this.db.selectFrom('bell_group_classes as m').innerJoin('bell_groups as g', 'g.id', 'm.bell_group_id')
      .select(['g.id', 'g.name']).where('m.academic_year_id', '=', yearId).where('m.class_id', '=', sec.class_id).executeTakeFirst();
    const [periods, slots, subjects, ct] = await Promise.all([
      member ? this.db.selectFrom('bell_periods').select(['id', 'kind', 'label', 'start_time', 'end_time']).where('bell_group_id', '=', member.id).orderBy('seq').execute() : Promise.resolve([]),
      this.db.selectFrom('timetable_slots as t').innerJoin('subjects as sub', 'sub.id', 't.subject_id')
        .leftJoin('teacher_assignments as ta', (j) => j.onRef('ta.section_id', '=', 't.section_id').onRef('ta.subject_id', '=', 't.subject_id').onRef('ta.academic_year_id', '=', 't.academic_year_id'))
        .leftJoin('staff as st', 'st.id', 'ta.staff_id').leftJoin('users as u', 'u.id', 'st.user_id')
        .select(['t.day_of_week as day', 't.bell_period_id as periodId', 't.subject_id as subjectId', 'sub.name as subject', 'u.name as teacher'])
        .where('t.section_id', '=', sectionId).where('t.academic_year_id', '=', yearId).execute(),
      this.db.selectFrom('class_subjects as cs').innerJoin('subjects as sub', 'sub.id', 'cs.subject_id')
        .leftJoin('teacher_assignments as ta', (j) => j.onRef('ta.subject_id', '=', 'cs.subject_id').on('ta.section_id', '=', sectionId).onRef('ta.academic_year_id', '=', 'cs.academic_year_id'))
        .leftJoin('staff as st', 'st.id', 'ta.staff_id').leftJoin('users as u', 'u.id', 'st.user_id')
        .select(['sub.id', 'sub.name', 'u.name as teacher']).where('cs.academic_year_id', '=', yearId).where('cs.class_id', '=', sec.class_id).orderBy('cs.display_order').orderBy('sub.name').execute(),
      this.db.selectFrom('class_teachers as ct').innerJoin('staff as st', 'st.id', 'ct.staff_id').innerJoin('users as u', 'u.id', 'st.user_id')
        .select('u.name').where('ct.academic_year_id', '=', yearId).where('ct.section_id', '=', sectionId).executeTakeFirst(),
    ]);
    return {
      section: { id: sec.id, name: sec.name, classId: sec.class_id, className: sec.class_name, classTeacher: ct?.name ?? null },
      group: member ?? null,
      periods: periods.map((p) => ({ id: p.id, kind: p.kind, label: p.label, start: p.start_time.slice(0, 5), end: p.end_time.slice(0, 5) })),
      slots, subjects, saturdaysOff: await this.saturdaysOff(),
    };
  }

  @Get('timetable/sections/:id')
  @RequirePermission('timetable', 'view')
  async getSection(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Query(new ZodPipe(YearQuery)) q: z.infer<typeof YearQuery>) {
    if (u.permissions.get('timetable.view') !== 'all') throw Errors.forbidden();
    const year = await resolveYear(this.db, q.yearId, false);
    return { year: { id: year.id, name: year.name, editable: year.status !== 'closed' }, ...(await this.sectionTimetable(id, year.id)) };
  }

  private async checkCell(trx: Database, yearId: number, sectionId: number, day: number, periodId: number, subjectId: number | null) {
    const sec = await trx.selectFrom('sections').select('class_id').where('id', '=', sectionId).executeTakeFirst();
    if (!sec) throw Errors.notFound('Section');
    const period = await trx.selectFrom('bell_periods as p').innerJoin('bell_group_classes as m', 'm.bell_group_id', 'p.bell_group_id')
      .select(['p.kind']).where('p.id', '=', periodId).where('m.class_id', '=', sec.class_id).where('m.academic_year_id', '=', yearId).executeTakeFirst();
    if (!period) throw Errors.badRequest('WRONG_PERIOD', 'This period is not part of this class\'s bell schedule.');
    if (period.kind !== 'period') throw Errors.badRequest('NOT_A_PERIOD', 'Lessons cannot be placed in a break.');
    if (subjectId) {
      const taught = await trx.selectFrom('class_subjects').select('subject_id').where('academic_year_id', '=', yearId).where('class_id', '=', sec.class_id).where('subject_id', '=', subjectId).executeTakeFirst();
      if (!taught) throw Errors.badRequest('SUBJECT_NOT_IN_CLASS', 'Add this subject to the class in the Teaching grid first.');
    }
  }

  private async writeCell(trx: Database, yearId: number, sectionId: number, day: number, periodId: number, subjectId: number | null, userId: number) {
    await trx.deleteFrom('timetable_slots').where('section_id', '=', sectionId).where('day_of_week', '=', day).where('bell_period_id', '=', periodId).execute();
    if (subjectId) await trx.insertInto('timetable_slots').values({ academic_year_id: yearId, section_id: sectionId, day_of_week: day, bell_period_id: periodId, subject_id: subjectId, updated_by: userId }).execute();
  }

  private async teacherOf(trx: Database, yearId: number, sectionId: number, subjectId: number) {
    const t = await trx.selectFrom('teacher_assignments').select('staff_id').where('academic_year_id', '=', yearId).where('section_id', '=', sectionId).where('subject_id', '=', subjectId).executeTakeFirst();
    return t?.staff_id ?? null;
  }

  @Put('timetable/sections/:id/slots')
  @RequirePermission('timetable', 'manage')
  async setSlot(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) sectionId: number, @Query(new ZodPipe(YearQuery)) q: z.infer<typeof YearQuery>, @Body(new ZodPipe(SlotBody)) b: z.infer<typeof SlotBody>) {
    const year = await resolveYear(this.db, q.yearId, true);
    await this.db.transaction().execute(async (trx) => {
      await this.checkCell(trx, year.id, sectionId, b.day, b.periodId, b.subjectId);
      await this.writeCell(trx, year.id, sectionId, b.day, b.periodId, b.subjectId, u.id);
      if (b.subjectId) {
        const staff = await this.teacherOf(trx, year.id, sectionId, b.subjectId);
        if (staff) {
          const clashes = await findClashes(trx, year.id, [staff]);
          if (clashes.length) throw Errors.badRequest('TIMETABLE_CLASH', describeClash(clashes[0]));
        }
      }
    });
    return this.sectionTimetable(sectionId, year.id);
  }

  /** Copy one day's lessons to other days of the same section. All or nothing. */
  @Post('timetable/sections/:id/copy-day')
  @HttpCode(200)
  @RequirePermission('timetable', 'manage')
  async copyDay(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) sectionId: number, @Query(new ZodPipe(YearQuery)) q: z.infer<typeof YearQuery>, @Body(new ZodPipe(CopyBody)) b: z.infer<typeof CopyBody>, @Req() req: AppRequest) {
    const year = await resolveYear(this.db, q.yearId, true);
    await this.db.transaction().execute(async (trx) => {
      const src = await trx.selectFrom('timetable_slots').select(['bell_period_id', 'subject_id']).where('section_id', '=', sectionId).where('academic_year_id', '=', year.id).where('day_of_week', '=', b.fromDay).execute();
      const staff = new Set<number>();
      for (const day of b.toDays.filter((d) => d !== b.fromDay)) {
        await trx.deleteFrom('timetable_slots').where('section_id', '=', sectionId).where('academic_year_id', '=', year.id).where('day_of_week', '=', day).execute();
        for (const s of src) {
          await this.writeCell(trx, year.id, sectionId, day, s.bell_period_id, s.subject_id, u.id);
          const t = await this.teacherOf(trx, year.id, sectionId, s.subject_id);
          if (t) staff.add(t);
        }
      }
      const clashes = await findClashes(trx, year.id, [...staff]);
      if (clashes.length) throw Errors.badRequest('TIMETABLE_CLASH', describeClash(clashes[0]));
      await this.audit.log(u, { module: 'timetable', action: 'copy_day', entityType: 'section', entityId: sectionId, after: { from: DAYS[b.fromDay], to: b.toDays.map((d) => DAYS[d]) }, ...clientMeta(req) }, trx);
    });
    return this.sectionTimetable(sectionId, year.id);
  }

  // ---------------- Personal views ----------------

  /** A teacher's own week, across all sections they teach. */
  @Get('timetable/mine')
  @RequirePermission('timetable', 'view')
  async mine(@CurrentUser() u: RequestUser, @Query(new ZodPipe(YearQuery)) q: z.infer<typeof YearQuery>) {
    const year = await resolveYear(this.db, q.yearId, false);
    const staff = await this.db.selectFrom('staff').select('id').where('user_id', '=', u.id).executeTakeFirst();
    if (!staff) return { year: { id: year.id, name: year.name }, lessons: [], saturdaysOff: await this.saturdaysOff() };
    const lessons = await this.db.selectFrom('timetable_slots as t')
      .innerJoin('teacher_assignments as ta', (j) => j.onRef('ta.section_id', '=', 't.section_id').onRef('ta.subject_id', '=', 't.subject_id').onRef('ta.academic_year_id', '=', 't.academic_year_id'))
      .innerJoin('bell_periods as p', 'p.id', 't.bell_period_id').innerJoin('sections as s', 's.id', 't.section_id').innerJoin('classes as c', 'c.id', 's.class_id').innerJoin('subjects as sub', 'sub.id', 't.subject_id')
      .select(['t.day_of_week as day', 'p.label as period', sql<string>`TIME_FORMAT(p.start_time, '%H:%i')`.as('start'), sql<string>`TIME_FORMAT(p.end_time, '%H:%i')`.as('end'),
        'c.name as className', 's.name as section', 's.id as sectionId', 'sub.name as subject'])
      .where('t.academic_year_id', '=', year.id).where('ta.staff_id', '=', staff.id).orderBy('t.day_of_week').orderBy('p.start_time').execute();
    return { year: { id: year.id, name: year.name }, lessons, saturdaysOff: await this.saturdaysOff() };
  }

  /** A student's timetable, for their family (own_children) or for staff with full timetable view. */
  @Get('students/:id/timetable')
  @RequirePermission('timetable', 'view')
  async forStudent(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    const year = await resolveYear(this.db, undefined, false);
    const sid = await visibleStudentId(this.db, u, id, 'timetable.view', year.id);
    const e = await this.db.selectFrom('enrollments').select('section_id').where('student_id', '=', sid).where('academic_year_id', '=', year.id).executeTakeFirst();
    if (!e) return { year: { id: year.id, name: year.name }, section: null, periods: [], slots: [], subjects: [], group: null, saturdaysOff: [] };
    return { year: { id: year.id, name: year.name }, ...(await this.sectionTimetable(e.section_id, year.id)) };
  }
}
