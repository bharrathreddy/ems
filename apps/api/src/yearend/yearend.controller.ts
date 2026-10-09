import { Body, Controller, Get, HttpCode, Inject, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sql } from 'kysely';
import { z } from 'zod';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { currentYear, resolveYear } from '../common/academic-year';
import { requireInstitutionAdmin } from '../common/admin';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { PermissionsService } from '../permissions/permissions.service';
import { syncFamilyLogin } from '../students/family-accounts';
import { FeeAccountsService } from '../fees/fee-accounts.service';

type Action = 'promote' | 'detain' | 'leave' | 'complete' | 'pending';
const STATUS: Record<Exclude<Action, 'pending'>, 'promoted' | 'detained' | 'left' | 'completed'> = { promote: 'promoted', detain: 'detained', leave: 'left', complete: 'completed' };
const ToYear = z.object({ toYearId: z.coerce.number().int().positive() });
const ApplyBody = z.object({
  toYearId: z.number().int().positive(),
  decisions: z.array(z.object({
    studentId: z.string().length(26),
    action: z.enum(['promote', 'detain', 'leave', 'complete', 'pending']),
    classId: z.number().int().positive().optional(),
    sectionId: z.number().int().positive().optional(),
    remarks: z.string().trim().max(255).nullish(),
  })).min(1).max(500),
});
const RollsAuto = z.object({ yearId: z.number().int().positive(), sectionId: z.number().int().positive(), mode: z.enum(['alpha', 'admission']) });
const RollsManual = z.object({ yearId: z.number().int().positive(), sectionId: z.number().int().positive(), rolls: z.array(z.object({ studentId: z.string().length(26), rollNo: z.string().trim().max(10).nullable() })) });

/**
 * Year-end (agreed design): promote section by section into the planned year, give roll numbers,
 * check, then switch. Only the Institution Admin or the developer may do this.
 */
@ApiTags('Year end')
@ApiBearerAuth()
@Controller('year-end')
export class YearEndController {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService, private readonly perms: PermissionsService, private readonly accounts: FeeAccountsService) {}

  private async years(toYearId: number) {
    const from = await currentYear(this.db);
    const to = await resolveYear(this.db, toYearId, true);
    if (to.is_current || to.id === from.id) throw Errors.badRequest('NOT_NEXT_YEAR', 'Choose the next (planned) academic year.');
    if (new Date(to.start_date) <= new Date(from.start_date)) throw Errors.badRequest('NOT_NEXT_YEAR', `${to.name} starts before ${from.name}.`);
    return { from, to };
  }

  private async classes() {
    const cls = await this.db.selectFrom('classes').select(['id', 'name', 'level_order']).where('is_active', '=', 1).orderBy('level_order').execute();
    const secs = await this.db.selectFrom('sections').select(['id', 'class_id', 'name']).where('is_active', '=', 1).orderBy('name').execute();
    return cls.map((c, i) => ({ ...c, next: cls[i + 1]?.id ?? null, sections: secs.filter((s) => s.class_id === c.id) }));
  }

  /** Progress per section, for the year-end overview. */
  @Get('overview')
  @RequirePermission('academics', 'view')
  async overview(@Query(new ZodPipe(ToYear)) q: z.infer<typeof ToYear>) {
    const { from, to } = await this.years(q.toYearId);
    const rows = await this.db.selectFrom('enrollments as e').innerJoin('students as s', 's.id', 'e.student_id')
      .innerJoin('sections as sec', 'sec.id', 'e.section_id').innerJoin('classes as c', 'c.id', 'e.class_id')
      .select(['e.section_id', 'sec.name as section', 'c.name as class_name', 'c.level_order',
        sql<number>`COUNT(*)`.as('total'), sql<number>`SUM(CASE WHEN e.status = 'enrolled' THEN 1 ELSE 0 END)`.as('pending'),
        sql<number>`SUM(CASE WHEN e.status = 'promoted' THEN 1 ELSE 0 END)`.as('promoted'), sql<number>`SUM(CASE WHEN e.status = 'detained' THEN 1 ELSE 0 END)`.as('detained'),
        sql<number>`SUM(CASE WHEN e.status IN ('left', 'completed') THEN 1 ELSE 0 END)`.as('leaving')])
      .where('e.academic_year_id', '=', from.id).where('s.status', '=', 'active')
      .groupBy(['e.section_id', 'sec.name', 'c.name', 'c.level_order']).orderBy('c.level_order').orderBy('sec.name').execute();
    const newAdmissions = await this.db.selectFrom('enrollments as e').select((eb) => eb.fn.countAll<number>().as('n')).where('e.academic_year_id', '=', to.id)
      .where((eb) => eb.not(eb.exists(eb.selectFrom('enrollments as p').select('p.id').whereRef('p.student_id', '=', 'e.student_id').where('p.academic_year_id', '=', from.id)))).executeTakeFirst();
    return { from: { id: from.id, name: from.name }, to: { id: to.id, name: to.name },
      sections: rows.map((r) => ({ ...r, total: Number(r.total), pending: Number(r.pending), promoted: Number(r.promoted), detained: Number(r.detained), leaving: Number(r.leaving) })),
      newAdmissions: Number(newAdmissions?.n ?? 0) };
  }

  /** One section's students with their current decision (or the suggested default). */
  @Get('sections/:id')
  @RequirePermission('academics', 'view')
  async section(@Param('id', ParseIntPipe) sectionId: number, @Query(new ZodPipe(ToYear)) q: z.infer<typeof ToYear>) {
    const { from, to } = await this.years(q.toYearId);
    const classes = await this.classes();
    const sec = await this.db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id').select(['s.id', 's.name', 'c.id as class_id', 'c.name as class_name']).where('s.id', '=', sectionId).executeTakeFirst();
    if (!sec) throw Errors.notFound('Section');
    const cls = classes.find((c) => c.id === sec.class_id)!;
    const next = classes.find((c) => c.id === cls.next);
    const defaultTarget = next ? { classId: next.id, sectionId: (next.sections.find((s) => s.name === sec.name) ?? next.sections[0])?.id ?? null } : null;
    const students = await this.db.selectFrom('enrollments as e').innerJoin('students as s', 's.id', 'e.student_id')
      .leftJoin('enrollments as t', (j) => j.onRef('t.student_id', '=', 'e.student_id').on('t.academic_year_id', '=', to.id))
      .select(['s.public_id', 's.first_name', 's.last_name', 's.admission_no', 'e.roll_no', 'e.status', 'e.remarks', 't.class_id as target_class_id', 't.section_id as target_section_id'])
      .where('e.academic_year_id', '=', from.id).where('e.section_id', '=', sectionId).where('s.status', '=', 'active')
      .orderBy(sql`CAST(e.roll_no AS UNSIGNED)`).orderBy('s.first_name').execute();
    return {
      from: { id: from.id, name: from.name }, to: { id: to.id, name: to.name },
      section: { id: sec.id, name: sec.name, classId: sec.class_id, className: sec.class_name, isTopClass: !next },
      defaultAction: next ? 'promote' : 'complete', defaultTarget,
      classes: classes.map(({ next: _n, ...c }) => c),
      students: students.map((s) => ({
        id: s.public_id, name: [s.first_name, s.last_name].filter(Boolean).join(' '), admissionNo: s.admission_no, rollNo: s.roll_no, remarks: s.remarks,
        decided: s.status !== 'enrolled',
        action: s.status === 'promoted' ? 'promote' : s.status === 'detained' ? 'detain' : s.status === 'left' ? 'leave' : s.status === 'completed' ? 'complete' : null,
        classId: s.target_class_id, sectionId: s.target_section_id,
      })),
    };
  }

  /** Save decisions. Changeable until the switch (undo with action "pending"). */
  @Post('apply')
  @HttpCode(200)
  @RequirePermission('academics', 'manage')
  async apply(@CurrentUser() u: RequestUser, @Body(new ZodPipe(ApplyBody)) b: z.infer<typeof ApplyBody>, @Req() req: AppRequest) {
    requireInstitutionAdmin(u);
    const { from, to } = await this.years(b.toYearId);
    const sections = new Map((await this.db.selectFrom('sections').select(['id', 'class_id']).where('is_active', '=', 1).execute()).map((s) => [s.id, s.class_id]));
    const errors: Array<{ field: string; message: string }> = [];
    await this.db.transaction().execute(async (trx) => {
      for (const [i, d] of b.decisions.entries()) {
        const st = await trx.selectFrom('students as s').innerJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 's.id').on('e.academic_year_id', '=', from.id))
          .select(['s.id', 'e.id as enrollment_id', 'e.class_id']).where('s.public_id', '=', d.studentId).where('s.status', '=', 'active').executeTakeFirst();
        if (!st) { errors.push({ field: `decisions.${i}`, message: 'Student is not in a class this year.' }); continue; }
        const removeTarget = () => trx.deleteFrom('enrollments').where('student_id', '=', st.id).where('academic_year_id', '=', to.id).execute();
        if (d.action === 'pending') {
          await trx.updateTable('enrollments').set({ status: 'enrolled', remarks: null }).where('id', '=', st.enrollment_id).execute();
          await removeTarget(); continue;
        }
        if (d.action === 'detain' && !d.remarks) { errors.push({ field: `decisions.${i}.remarks`, message: 'Give the reason for keeping the student in the same class.' }); continue; }
        if (d.action === 'promote' || d.action === 'detain') {
          const classId = d.action === 'detain' ? st.class_id : d.classId;
          if (!classId || !d.sectionId || sections.get(d.sectionId) !== classId) { errors.push({ field: `decisions.${i}.sectionId`, message: 'Choose a section of the new class.' }); continue; }
          if (d.action === 'promote' && classId === st.class_id) { errors.push({ field: `decisions.${i}.classId`, message: 'Promotion must be to a different class. Use Detain to keep the same class.' }); continue; }
          const existing = await trx.selectFrom('enrollments').select(['id', 'class_id', 'section_id']).where('student_id', '=', st.id).where('academic_year_id', '=', to.id).executeTakeFirst();
          if (existing) {
            if (existing.class_id !== classId || existing.section_id !== d.sectionId) await trx.updateTable('enrollments').set({ class_id: classId, section_id: d.sectionId, roll_no: null }).where('id', '=', existing.id).execute();
          } else {
            await trx.insertInto('enrollments').values({ student_id: st.id, academic_year_id: to.id, class_id: classId, section_id: d.sectionId, joined_on: new Date(to.start_date) }).execute();
          }
        } else {
          await removeTarget();
        }
        await trx.updateTable('enrollments').set({ status: STATUS[d.action], remarks: d.remarks ?? (d.action === 'leave' ? 'Left with TC' : d.action === 'complete' ? 'Completed school' : null) }).where('id', '=', st.enrollment_id).execute();
      }
      if (errors.length) throw Errors.validation(errors);
      await this.audit.log(u, { module: 'year_end', action: 'promotion', after: { from: from.name, to: to.name, count: b.decisions.length, decisions: b.decisions }, ...clientMeta(req) }, trx);
    });
    return { saved: b.decisions.length };
  }

  private async rollList(yearId: number, sectionId: number) {
    return this.db.selectFrom('enrollments as e').innerJoin('students as s', 's.id', 'e.student_id')
      .select(['e.id', 's.public_id', 's.first_name', 's.last_name', 's.admission_no', 'e.roll_no'])
      .where('e.academic_year_id', '=', yearId).where('e.section_id', '=', sectionId).where('s.status', '=', 'active').execute();
  }

  @Get('rolls')
  @RequirePermission('academics', 'view')
  async rolls(@Query(new ZodPipe(z.object({ yearId: z.coerce.number().int().positive(), sectionId: z.coerce.number().int().positive() }))) q: { yearId: number; sectionId: number }) {
    const list = await this.rollList(q.yearId, q.sectionId);
    return list.map((r) => ({ studentId: r.public_id, name: [r.first_name, r.last_name].filter(Boolean).join(' '), admissionNo: r.admission_no, rollNo: r.roll_no }))
      .sort((a, b) => (Number(a.rollNo) || 9999) - (Number(b.rollNo) || 9999) || a.name.localeCompare(b.name));
  }

  /** Agreed Q4: roll numbers alphabetically, by admission number, or typed in. */
  @Post('rolls/auto')
  @HttpCode(200)
  @RequirePermission('academics', 'manage')
  async autoRolls(@CurrentUser() u: RequestUser, @Body(new ZodPipe(RollsAuto)) b: z.infer<typeof RollsAuto>, @Req() req: AppRequest) {
    await resolveYear(this.db, b.yearId, true);
    const list = await this.rollList(b.yearId, b.sectionId);
    const num = (a: string) => (/^\d+$/.test(a) ? Number(a) : Number.MAX_SAFE_INTEGER);
    list.sort((a, c) => b.mode === 'alpha'
      ? `${a.first_name} ${a.last_name ?? ''}`.localeCompare(`${c.first_name} ${c.last_name ?? ''}`, 'en', { sensitivity: 'base' })
      : num(a.admission_no) - num(c.admission_no) || a.admission_no.localeCompare(c.admission_no));
    await this.db.transaction().execute(async (trx) => {
      for (const [i, r] of list.entries()) await trx.updateTable('enrollments').set({ roll_no: String(i + 1) }).where('id', '=', r.id).execute();
      await this.audit.log(u, { module: 'year_end', action: 'auto_rolls', after: b, ...clientMeta(req) }, trx);
    });
    return this.rolls({ yearId: b.yearId, sectionId: b.sectionId });
  }

  @Put('rolls')
  @RequirePermission('academics', 'manage')
  async setRolls(@CurrentUser() u: RequestUser, @Body(new ZodPipe(RollsManual)) b: z.infer<typeof RollsManual>, @Req() req: AppRequest) {
    await resolveYear(this.db, b.yearId, true);
    const list = await this.rollList(b.yearId, b.sectionId);
    const byId = new Map(list.map((r) => [r.public_id, r]));
    const final = new Map(list.map((r) => [r.public_id, r.roll_no]));
    for (const r of b.rolls) { if (!byId.has(r.studentId)) throw Errors.notFound('Student'); final.set(r.studentId, r.rollNo || null); }
    const seen = new Map<string, string>();
    for (const [sid, roll] of final) {
      if (!roll) continue;
      if (seen.has(roll)) throw Errors.validation([{ field: 'rolls', message: `Roll number ${roll} is given to two students.` }]);
      seen.set(roll, sid);
    }
    await this.db.transaction().execute(async (trx) => {
      for (const r of b.rolls) await trx.updateTable('enrollments').set({ roll_no: r.rollNo || null }).where('id', '=', byId.get(r.studentId)!.id).execute();
      await this.audit.log(u, { module: 'year_end', action: 'set_rolls', after: b, ...clientMeta(req) }, trx);
    });
    return this.rolls({ yearId: b.yearId, sectionId: b.sectionId });
  }

  /** Agreed: before switching, warn about sections not promoted, sections without a class teacher, fees not set up. */
  @Get('switch-check')
  @RequirePermission('academics', 'view')
  async check(@Query(new ZodPipe(ToYear)) q: z.infer<typeof ToYear>) {
    const { from, to } = await this.years(q.toYearId);
    const ov = await this.overview(q);
    const [targetSections, cts, fees, plan] = await Promise.all([
      this.db.selectFrom('enrollments as e').innerJoin('sections as s', 's.id', 'e.section_id').innerJoin('classes as c', 'c.id', 'e.class_id')
        .select(['e.section_id', 'e.class_id', 's.name as section', 'c.name as class_name', 'c.level_order', sql<number>`COUNT(*)`.as('n')])
        .where('e.academic_year_id', '=', to.id).groupBy(['e.section_id', 'e.class_id', 's.name', 'c.name', 'c.level_order']).orderBy('c.level_order').execute(),
      this.db.selectFrom('class_teachers').select('section_id').where('academic_year_id', '=', to.id).execute(),
      this.db.selectFrom('class_tuition_fees').select('class_id').where('academic_year_id', '=', to.id).execute(),
      this.db.selectFrom('academic_year_fee_settings').select('default_fee_plan_id').where('academic_year_id', '=', to.id).executeTakeFirst(),
    ]);
    const ctSet = new Set(cts.map((c) => c.section_id));
    const feeSet = new Set(fees.map((f) => f.class_id));
    const sum = (k: 'pending' | 'promoted' | 'detained' | 'leaving') => ov.sections.reduce((t, s) => t + s[k], 0);
    const notPromoted = ov.sections.filter((s) => s.pending > 0).map((s) => ({ className: s.class_name, section: s.section, pending: s.pending }));
    const noClassTeacher = targetSections.filter((s) => !ctSet.has(s.section_id)).map((s) => `${s.class_name} ${s.section}`);
    const classesWithoutFee = [...new Map(targetSections.filter((s) => !feeSet.has(s.class_id)).map((s) => [s.class_id, s.class_name])).values()];
    return {
      from: ov.from, to: ov.to,
      counts: { promoted: sum('promoted'), detained: sum('detained'), leaving: sum('leaving'), notDecided: sum('pending'), newAdmissions: ov.newAdmissions },
      warnings: { notPromoted, noClassTeacher, feesNotSetUp: !plan, classesWithoutFee },
      ready: !notPromoted.length && !noClassTeacher.length && !!plan && !classesWithoutFee.length,
    };
  }

  /** The switch: next year becomes current, this year closes (read-only), leavers and Class 10 become inactive. */
  @Post('switch')
  @HttpCode(200)
  @RequirePermission('academics', 'manage')
  async switchYear(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ toYearId: z.number().int().positive(), acceptWarnings: z.boolean().default(false) }))) b: { toYearId: number; acceptWarnings: boolean }, @Req() req: AppRequest) {
    requireInstitutionAdmin(u);
    const chk = await this.check({ toYearId: b.toYearId });
    if (!chk.ready && !b.acceptWarnings) throw Errors.badRequest('SWITCH_WARNINGS', 'Some steps are not finished. Review the checklist and confirm to switch anyway.');
    const { from, to } = await this.years(b.toYearId);
    // Every student of the closing year must have their fees recorded before it is locked,
    // otherwise dues of students whose fees were never opened would disappear.
    await this.accounts.syncYear(from.id);
    let deactivated = 0;
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('academic_years').set({ is_current: 0, status: 'closed' }).where('id', '=', from.id).execute();
      await trx.updateTable('academic_years').set({ is_current: 1, status: 'active' }).where('id', '=', to.id).execute();
      const leavers = await trx.selectFrom('enrollments as e').innerJoin('students as s', 's.id', 'e.student_id')
        .select(['s.id', 's.family_id', 'e.status', 'e.remarks']).where('e.academic_year_id', '=', from.id).where('e.status', 'in', ['left', 'completed']).where('s.status', '=', 'active')
        .where((eb) => eb.not(eb.exists(eb.selectFrom('enrollments as t').select('t.id').whereRef('t.student_id', '=', 's.id').where('t.academic_year_id', '=', to.id)))).execute();
      for (const l of leavers) {
        await trx.updateTable('students').set({ status: 'inactive', inactive_at: new Date(), inactive_reason: l.remarks ?? (l.status === 'completed' ? 'Completed school' : 'Left with TC'), updated_by: u.id }).where('id', '=', l.id).execute();
      }
      for (const fam of new Set(leavers.map((l) => l.family_id))) await syncFamilyLogin(trx, fam);
      deactivated = leavers.length;
      await this.audit.log(u, { module: 'year_end', action: 'switch_year', after: { from: from.name, to: to.name, deactivated, warnings: chk.warnings }, ...clientMeta(req) }, trx);
    });
    this.perms.invalidate();
    const fees = await this.accounts.syncYear(to.id);
    return { current: to.name, closed: from.name, studentsMadeInactive: deactivated, feeAccountsCreated: fees.created };
  }
}
