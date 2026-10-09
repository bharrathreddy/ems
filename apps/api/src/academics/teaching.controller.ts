import { Body, Controller, Get, Inject, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { resolveYear } from '../common/academic-year';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { describeClash, findClashes } from '../timetable/clashes';

const staffId = z.string().length(26).nullable();
const GridBody = z.object({
  yearId: z.number().int().positive().optional(),
  classSubjects: z.array(z.object({ classId: z.number().int().positive(), subjectIds: z.array(z.number().int().positive()) })).default([]),
  classTeachers: z.array(z.object({ sectionId: z.number().int().positive(), staffId })).default([]),
  assignments: z.array(z.object({ sectionId: z.number().int().positive(), subjectId: z.number().int().positive(), staffId })).default([]),
});
const YearQuery = z.object({ yearId: z.coerce.number().int().positive().optional() });

/**
 * The teaching grid: for one academic year, which subjects each class studies,
 * each section's class teacher, and the teacher of every section + subject.
 * Assigned fresh every year (nothing is copied).
 */
@ApiTags('Academics')
@ApiBearerAuth()
@Controller('teaching')
export class TeachingController {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService) {}

  @Get('grid')
  @RequirePermission('academics', 'view')
  async grid(@Query(new ZodPipe(YearQuery)) q: z.infer<typeof YearQuery>) {
    const year = await resolveYear(this.db, q.yearId, false);
    const [years, classes, sections, subjects, classSubjects, cts, tas, staff] = await Promise.all([
      this.db.selectFrom('academic_years').select(['id', 'name', 'status', 'is_current']).orderBy('start_date', 'desc').execute(),
      this.db.selectFrom('classes').select(['id', 'name']).where('is_active', '=', 1).orderBy('level_order').execute(),
      this.db.selectFrom('sections').select(['id', 'class_id', 'name']).where('is_active', '=', 1).orderBy('name').execute(),
      this.db.selectFrom('subjects').select(['id', 'name', 'code']).where('is_active', '=', 1).orderBy('name').execute(),
      this.db.selectFrom('class_subjects').select(['class_id', 'subject_id']).where('academic_year_id', '=', year.id).orderBy('display_order').execute(),
      this.db.selectFrom('class_teachers as ct').innerJoin('staff as s', 's.id', 'ct.staff_id').select(['ct.section_id', 's.public_id']).where('ct.academic_year_id', '=', year.id).execute(),
      this.db.selectFrom('teacher_assignments as ta').innerJoin('staff as s', 's.id', 'ta.staff_id').select(['ta.section_id', 'ta.subject_id', 's.public_id']).where('ta.academic_year_id', '=', year.id).execute(),
      this.db.selectFrom('staff as s').innerJoin('users as u', 'u.id', 's.user_id').select(['s.public_id', 'u.name', 's.designation'])
        .where('s.status', '=', 'active').where('s.deleted_at', 'is', null).where('u.status', '=', 'active').orderBy('u.name').execute(),
    ]);
    return {
      year: { id: year.id, name: year.name, status: year.status, editable: year.status !== 'closed' },
      years: years.filter((y) => y.status !== 'closed' || y.id === year.id),
      subjects, staff,
      classes: classes.map((c) => ({
        ...c,
        subjectIds: classSubjects.filter((x) => x.class_id === c.id).map((x) => x.subject_id),
        sections: sections.filter((s) => s.class_id === c.id).map((s) => ({
          ...s,
          classTeacher: cts.find((x) => x.section_id === s.id)?.public_id ?? null,
          teachers: Object.fromEntries(tas.filter((x) => x.section_id === s.id).map((x) => [x.subject_id, x.public_id])),
        })),
      })),
    };
  }

  /** Saves any part of the grid in one go. All or nothing; blocked if it would create a timetable clash. */
  @Put('grid')
  @RequirePermission('academics', 'manage')
  async save(@CurrentUser() u: RequestUser, @Body(new ZodPipe(GridBody)) b: z.infer<typeof GridBody>, @Req() req: AppRequest) {
    const year = await resolveYear(this.db, b.yearId, true);
    const staffMap = new Map((await this.db.selectFrom('staff').select(['id', 'public_id']).where('status', '=', 'active').execute()).map((s) => [s.public_id, s.id]));
    const sid = (p: string | null) => {
      if (p === null) return null;
      const id = staffMap.get(p);
      if (!id) throw Errors.validation([{ field: 'staffId', message: 'Unknown or inactive staff member.' }]);
      return id;
    };
    const sectionClass = new Map((await this.db.selectFrom('sections').select(['id', 'class_id']).execute()).map((s) => [s.id, s.class_id]));
    const affected = new Set<number>();
    await this.db.transaction().execute(async (trx) => {
      for (const cs of b.classSubjects) {
        const current = (await trx.selectFrom('class_subjects').select('subject_id').where('academic_year_id', '=', year.id).where('class_id', '=', cs.classId).execute()).map((r) => r.subject_id);
        const removed = current.filter((x) => !cs.subjectIds.includes(x));
        if (removed.length) {
          const used = await trx.selectFrom('timetable_slots as t').innerJoin('sections as s', 's.id', 't.section_id').innerJoin('subjects as sub', 'sub.id', 't.subject_id')
            .select(['sub.name', 's.name as section']).where('t.academic_year_id', '=', year.id).where('s.class_id', '=', cs.classId).where('t.subject_id', 'in', removed).executeTakeFirst();
          if (used) throw Errors.badRequest('SUBJECT_IN_TIMETABLE', `${used.name} is in the timetable of section ${used.section}. Remove it from the timetable first.`);
          const secIds = [...sectionClass].filter(([, c]) => c === cs.classId).map(([s]) => s);
          if (secIds.length) await trx.deleteFrom('teacher_assignments').where('academic_year_id', '=', year.id).where('section_id', 'in', secIds).where('subject_id', 'in', removed).execute();
          await trx.deleteFrom('class_subjects').where('academic_year_id', '=', year.id).where('class_id', '=', cs.classId).where('subject_id', 'in', removed).execute();
        }
        const added = cs.subjectIds.filter((x) => !current.includes(x));
        if (added.length) await trx.insertInto('class_subjects').values(added.map((subject_id, i) => ({ academic_year_id: year.id, class_id: cs.classId, subject_id, display_order: current.length + i }))).execute();
      }
      for (const ct of b.classTeachers) {
        await trx.deleteFrom('class_teachers').where('academic_year_id', '=', year.id).where('section_id', '=', ct.sectionId).execute();
        const id = sid(ct.staffId);
        if (id) await trx.insertInto('class_teachers').values({ academic_year_id: year.id, section_id: ct.sectionId, staff_id: id }).execute();
      }
      for (const a of b.assignments) {
        const classId = sectionClass.get(a.sectionId);
        if (!classId) throw Errors.notFound('Section');
        const old = await trx.selectFrom('teacher_assignments').select('staff_id').where('academic_year_id', '=', year.id).where('section_id', '=', a.sectionId).where('subject_id', '=', a.subjectId).executeTakeFirst();
        if (old) affected.add(old.staff_id);
        await trx.deleteFrom('teacher_assignments').where('academic_year_id', '=', year.id).where('section_id', '=', a.sectionId).where('subject_id', '=', a.subjectId).execute();
        const id = sid(a.staffId);
        if (id) {
          const taught = await trx.selectFrom('class_subjects').select('subject_id').where('academic_year_id', '=', year.id).where('class_id', '=', classId).where('subject_id', '=', a.subjectId).executeTakeFirst();
          if (!taught) await trx.insertInto('class_subjects').values({ academic_year_id: year.id, class_id: classId, subject_id: a.subjectId }).execute();
          await trx.insertInto('teacher_assignments').values({ academic_year_id: year.id, section_id: a.sectionId, subject_id: a.subjectId, staff_id: id }).execute();
          affected.add(id);
        }
      }
      const clashes = await findClashes(trx, year.id, [...affected]);
      if (clashes.length) throw Errors.badRequest('TIMETABLE_CLASH', describeClash(clashes[0]));
      await this.audit.log(u, { module: 'academics', action: 'save_teaching_grid', after: { year: year.name, ...b }, ...clientMeta(req) }, trx);
    });
    return this.grid({ yearId: year.id });
  }
}
