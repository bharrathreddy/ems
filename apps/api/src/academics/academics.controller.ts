import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseIntPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { DeveloperOnly, RequirePermission } from '../permissions/permission.guard';
import { currentYear } from '../common/academic-year';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const YearBody = z.object({ name: z.string().trim().regex(/^\d{4}-\d{2}$/, 'Use the format 2026-27.'), startDate: date, endDate: date })
  .refine((v) => v.endDate > v.startDate, { message: 'End date must be after start date.', path: ['endDate'] });
const ClassBody = z.object({ name: z.string().trim().min(1).max(50), levelOrder: z.number().int().min(-5).max(100), isActive: z.boolean().optional() });
const SectionBody = z.object({ name: z.string().trim().min(1).max(20), isActive: z.boolean().optional() });
const ClassTeacherBody = z.object({ staffId: z.string().length(26).nullable() });
const AssignmentBody = z.object({ staffId: z.string().length(26), sectionId: z.coerce.number().int().positive(), subjectId: z.coerce.number().int().positive() });
const SubjectBody = z.object({ name: z.string().trim().min(1).max(100), code: z.string().trim().max(20).nullish() });

@ApiTags('Academics')
@ApiBearerAuth()
@Controller()
export class AcademicsController {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService) {}

  // ---------- Academic years ----------

  @Get('academic-years')
  @RequirePermission('academics', 'view')
  years() {
    return this.db.selectFrom('academic_years')
      .select(['id', 'name', 'start_date', 'end_date', 'is_current', 'status']).orderBy('start_date', 'desc').execute();
  }

  @Post('academic-years')
  @RequirePermission('academics', 'manage')
  async createYear(@CurrentUser() u: RequestUser, @Body(new ZodPipe(YearBody)) b: z.infer<typeof YearBody>, @Req() req: AppRequest) {
    const overlap = await this.db.selectFrom('academic_years').select('name')
      .where('start_date', '<=', new Date(b.endDate)).where('end_date', '>=', new Date(b.startDate)).executeTakeFirst();
    if (overlap) throw Errors.conflict(`Dates overlap with academic year ${overlap.name}.`);
    const res = await this.db.insertInto('academic_years')
      .values({ name: b.name, start_date: new Date(b.startDate), end_date: new Date(b.endDate) }).executeTakeFirstOrThrow();
    await this.audit.log(u, { module: 'academics', action: 'create_year', entityType: 'academic_year', entityId: Number(res.insertId), after: b, ...clientMeta(req) });
    return { id: Number(res.insertId) };
  }

  /** Developer correction tool. The normal yearly change is Year-end > Switch, which also closes the old year. */
  @Post('academic-years/:id/make-current')
  @HttpCode(200)
  @DeveloperOnly()
  async makeCurrent(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Req() req: AppRequest) {
    await this.db.transaction().execute(async (trx) => {
      const y = await trx.selectFrom('academic_years').select(['id', 'status']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!y) throw Errors.notFound('Academic year');
      if (y.status === 'closed') throw Errors.badRequest('YEAR_CLOSED', 'A closed academic year cannot be made current.');
      await trx.updateTable('academic_years').set({ is_current: 0 }).where('is_current', '=', 1).execute();
      await trx.updateTable('academic_years').set({ is_current: 1, status: 'active' }).where('id', '=', id).execute();
      await this.audit.log(u, { module: 'academics', action: 'make_current_year', entityType: 'academic_year', entityId: id, ...clientMeta(req) }, trx);
    });
    return { id, isCurrent: true };
  }

  // ---------- Classes and sections ----------

  @Get('classes')
  @RequirePermission('academics', 'view')
  async classes() {
    const [classes, sections] = await Promise.all([
      this.db.selectFrom('classes').select(['id', 'name', 'level_order', 'is_active']).orderBy('level_order').execute(),
      this.db.selectFrom('sections').select(['id', 'class_id', 'name', 'is_active']).orderBy('name').execute(),
    ]);
    return classes.map((c) => ({ ...c, sections: sections.filter((s) => s.class_id === c.id) }));
  }

  @Post('classes')
  @RequirePermission('academics', 'manage')
  async createClass(@CurrentUser() u: RequestUser, @Body(new ZodPipe(ClassBody)) b: z.infer<typeof ClassBody>, @Req() req: AppRequest) {
    const res = await this.db.insertInto('classes').values({ name: b.name, level_order: b.levelOrder, is_active: b.isActive === false ? 0 : 1 }).executeTakeFirstOrThrow();
    await this.audit.log(u, { module: 'academics', action: 'create_class', entityType: 'class', entityId: Number(res.insertId), after: b, ...clientMeta(req) });
    return { id: Number(res.insertId) };
  }

  @Patch('classes/:id')
  @RequirePermission('academics', 'manage')
  async updateClass(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(ClassBody.partial())) b: Partial<z.infer<typeof ClassBody>>, @Req() req: AppRequest) {
    const res = await this.db.updateTable('classes').set({
      ...(b.name !== undefined && { name: b.name }),
      ...(b.levelOrder !== undefined && { level_order: b.levelOrder }),
      ...(b.isActive !== undefined && { is_active: b.isActive ? 1 : 0 }),
    }).where('id', '=', id).executeTakeFirst();
    if (!Number(res.numUpdatedRows)) throw Errors.notFound('Class');
    await this.audit.log(u, { module: 'academics', action: 'update_class', entityType: 'class', entityId: id, after: b, ...clientMeta(req) });
    return { id };
  }

  @Post('classes/:id/sections')
  @RequirePermission('academics', 'manage')
  async createSection(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) classId: number, @Body(new ZodPipe(SectionBody)) b: z.infer<typeof SectionBody>, @Req() req: AppRequest) {
    const cls = await this.db.selectFrom('classes').select('id').where('id', '=', classId).executeTakeFirst();
    if (!cls) throw Errors.notFound('Class');
    const res = await this.db.insertInto('sections').values({ class_id: classId, name: b.name.toUpperCase() }).executeTakeFirstOrThrow();
    await this.audit.log(u, { module: 'academics', action: 'create_section', entityType: 'section', entityId: Number(res.insertId), after: { classId, ...b }, ...clientMeta(req) });
    return { id: Number(res.insertId) };
  }

  @Patch('sections/:id')
  @RequirePermission('academics', 'manage')
  async updateSection(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(SectionBody.partial())) b: Partial<z.infer<typeof SectionBody>>, @Req() req: AppRequest) {
    const res = await this.db.updateTable('sections').set({
      ...(b.name !== undefined && { name: b.name.toUpperCase() }),
      ...(b.isActive !== undefined && { is_active: b.isActive ? 1 : 0 }),
    }).where('id', '=', id).executeTakeFirst();
    if (!Number(res.numUpdatedRows)) throw Errors.notFound('Section');
    await this.audit.log(u, { module: 'academics', action: 'update_section', entityType: 'section', entityId: id, after: b, ...clientMeta(req) });
    return { id };
  }

  // ---------- Subjects ----------

  @Get('subjects')
  @RequirePermission('academics', 'view')
  subjects() {
    return this.db.selectFrom('subjects').select(['id', 'name', 'code', 'is_active']).orderBy('name').execute();
  }

  @Post('subjects')
  @RequirePermission('academics', 'manage')
  async createSubject(@CurrentUser() u: RequestUser, @Body(new ZodPipe(SubjectBody)) b: z.infer<typeof SubjectBody>, @Req() req: AppRequest) {
    const res = await this.db.insertInto('subjects').values({ name: b.name, code: b.code ?? null }).executeTakeFirstOrThrow();
    await this.audit.log(u, { module: 'academics', action: 'create_subject', entityType: 'subject', entityId: Number(res.insertId), after: b, ...clientMeta(req) });
    return { id: Number(res.insertId) };
  }

  // ---------- Who teaches where (current academic year). These drive teacher data scopes. ----------

  @Get('teaching')
  @RequirePermission('academics', 'view')
  async teaching() {
    const year = await currentYear(this.db);
    const [classTeachers, assignments] = await Promise.all([
      this.db.selectFrom('class_teachers as ct').innerJoin('staff as s', 's.id', 'ct.staff_id').innerJoin('users as u', 'u.id', 's.user_id')
        .select(['ct.section_id', 's.public_id as staff_id', 'u.name']).where('ct.academic_year_id', '=', year.id).execute(),
      this.db.selectFrom('teacher_assignments as ta').innerJoin('staff as s', 's.id', 'ta.staff_id').innerJoin('users as u', 'u.id', 's.user_id')
        .innerJoin('subjects as sub', 'sub.id', 'ta.subject_id')
        .select(['ta.id', 'ta.section_id', 'ta.subject_id', 'sub.name as subject', 's.public_id as staff_id', 'u.name'])
        .where('ta.academic_year_id', '=', year.id).execute(),
    ]);
    return { academicYear: year.name, classTeachers, assignments };
  }

  private async staffIdOf(publicId: string) {
    const s = await this.db.selectFrom('staff').select('id').where('public_id', '=', publicId).where('status', '=', 'active').executeTakeFirst();
    if (!s) throw Errors.notFound('Staff member');
    return s.id;
  }

  @Put('sections/:id/class-teacher')
  @RequirePermission('academics', 'manage')
  async setClassTeacher(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) sectionId: number, @Body(new ZodPipe(ClassTeacherBody)) b: z.infer<typeof ClassTeacherBody>, @Req() req: AppRequest) {
    const year = await currentYear(this.db);
    const sec = await this.db.selectFrom('sections').select('id').where('id', '=', sectionId).executeTakeFirst();
    if (!sec) throw Errors.notFound('Section');
    await this.db.deleteFrom('class_teachers').where('academic_year_id', '=', year.id).where('section_id', '=', sectionId).execute();
    if (b.staffId) {
      await this.db.insertInto('class_teachers').values({ academic_year_id: year.id, section_id: sectionId, staff_id: await this.staffIdOf(b.staffId) }).execute();
    }
    await this.audit.log(u, { module: 'academics', action: 'set_class_teacher', entityType: 'section', entityId: sectionId, after: b, ...clientMeta(req) });
    return { sectionId, staffId: b.staffId };
  }

  @Post('teacher-assignments')
  @RequirePermission('academics', 'manage')
  async assign(@CurrentUser() u: RequestUser, @Body(new ZodPipe(AssignmentBody)) b: z.infer<typeof AssignmentBody>, @Req() req: AppRequest) {
    const year = await currentYear(this.db);
    const staffId = await this.staffIdOf(b.staffId);
    const sec = await this.db.selectFrom('sections').select('class_id').where('id', '=', b.sectionId).executeTakeFirst();
    if (!sec) throw Errors.notFound('Section');
    await this.db.insertInto('class_subjects').values({ academic_year_id: year.id, class_id: sec.class_id, subject_id: b.subjectId }).ignore().execute();
    // One teacher per section + subject (teaching grid): replaces any previous teacher.
    await this.db.deleteFrom('teacher_assignments').where('academic_year_id', '=', year.id).where('section_id', '=', b.sectionId).where('subject_id', '=', b.subjectId).execute();
    const res = await this.db.insertInto('teacher_assignments').values({
      academic_year_id: year.id, staff_id: staffId, section_id: b.sectionId, subject_id: b.subjectId,
    }).executeTakeFirstOrThrow();
    await this.audit.log(u, { module: 'academics', action: 'assign_teacher', entityType: 'teacher_assignment', entityId: Number(res.insertId), after: b, ...clientMeta(req) });
    return { id: Number(res.insertId) };
  }

  @Delete('teacher-assignments/:id')
  @RequirePermission('academics', 'manage')
  async unassign(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Req() req: AppRequest) {
    await this.db.deleteFrom('teacher_assignments').where('id', '=', id).execute();
    await this.audit.log(u, { module: 'academics', action: 'unassign_teacher', entityType: 'teacher_assignment', entityId: id, ...clientMeta(req) });
    return { id };
  }
}
