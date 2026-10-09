import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { sql } from 'kysely';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { FilesService, STORAGE_DIR } from '../common/files.service';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { photoStudentId, studentFilter, teacherSectionIds, visibleStudentId } from '../students/student-scope';
import { StudentsService } from '../students/students.service';
import { assertImage } from '../cms/files.controller';
import { addDays, iso, schoolToday } from '../attendance/calendar';
import { ExamsService } from './exams.service';
import { renderReportCards, reportCardData } from './report-card';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();
const ScaleBody = z.object({ name: z.string().trim().min(2).max(80), bands: z.array(z.object({ grade: z.string().trim().min(1).max(6), min: z.number().min(0).max(100), label: z.string().trim().max(40).nullish() })).min(2).max(15) });
const YearQ = z.object({ yearId: z.coerce.number().int().positive().optional() });
const SheetKey = z.object({ examId: z.coerce.number().int().positive(), sectionId: z.coerce.number().int().positive(), subjectId: z.coerce.number().int().positive() });
const SheetBody = SheetKey.extend({ submit: z.boolean().default(false), entries: z.array(z.object({ studentId: z.string().length(26), marks: z.number().min(0).max(1000).nullable(), absent: z.boolean().default(false) })).max(200) });

@ApiTags('Exams')
@ApiBearerAuth()
@Controller()
export class ExamsController {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly ex: ExamsService, private readonly audit: AuditService,
    private readonly files: FilesService, private readonly students: StudentsService) {}

  // ---------------- Setup ----------------
  @Get('exams/setup') @RequirePermission('exams', 'view')
  setup(@Query(new ZodPipe(YearQ)) q: { yearId?: number }) { return this.ex.setup(q.yearId); }

  @Post('exams') @RequirePermission('exams', 'configure')
  add(@CurrentUser() u: RequestUser, @Query(new ZodPipe(YearQ)) q: { yearId?: number }, @Body(new ZodPipe(z.object({ name: z.string().trim().min(2).max(80), code: z.string().trim().min(1).max(20).regex(/^[\w-]+$/, 'Letters, numbers and dashes only.'), kind: z.enum(['unit', 'prefinal']), maxMarks: z.number().positive().max(1000), classIds: z.array(z.number().int().positive()).min(1) }))) b: any, @Req() r: AppRequest) {
    return this.ex.addExam(u, q.yearId, b, clientMeta(r));
  }

  @Patch('exams/:id') @RequirePermission('exams', 'configure')
  update(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(z.object({ name: z.string().trim().min(2).max(80).optional(), maxMarks: z.number().positive().max(1000).optional(), classIds: z.array(z.number().int().positive()).optional() }))) b: any, @Req() r: AppRequest) {
    return this.ex.updateExam(u, id, b, clientMeta(r));
  }

  @Delete('exams/:id') @RequirePermission('exams', 'configure')
  remove(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Req() r: AppRequest) { return this.ex.deleteExam(u, id, clientMeta(r)); }

  @Put('exams/class-rules') @RequirePermission('exams', 'configure')
  rules(@CurrentUser() u: RequestUser, @Query(new ZodPipe(YearQ)) q: { yearId?: number }, @Body(new ZodPipe(z.object({ rows: z.array(z.object({ classId: z.number().int().positive(), gradeScaleId: z.number().int().positive().nullable(),
    display: z.enum(['marks', 'grades', 'both']), formula: z.enum(['term', 'year_end', 'weights']), faWeight: z.number().int().min(0).max(100), passPct: z.number().min(0).max(100) })) }))) b: any, @Req() r: AppRequest) {
    return this.ex.setClassRules(u, q.yearId, b.rows, clientMeta(r));
  }

  @Post('grade-scales') @RequirePermission('exams', 'configure')
  addScale(@CurrentUser() u: RequestUser, @Body(new ZodPipe(ScaleBody)) b: any, @Req() r: AppRequest) { return this.ex.saveScale(u, null, b, clientMeta(r)); }

  @Put('grade-scales/:id') @RequirePermission('exams', 'configure')
  saveScale(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(ScaleBody)) b: any, @Req() r: AppRequest) { return this.ex.saveScale(u, id, b, clientMeta(r)); }

  @Put('exams/skills') @RequirePermission('exams', 'configure')
  skills(@CurrentUser() u: RequestUser, @Query(new ZodPipe(YearQ)) q: { yearId?: number }, @Body(new ZodPipe(z.object({ skills: z.array(z.object({ id: z.number().int().positive().optional(), group: z.string().trim().min(1).max(60), name: z.string().trim().min(1).max(120), classId: z.number().int().positive().nullable() })).max(200) }))) b: any, @Req() r: AppRequest) {
    return this.ex.saveSkills(u, q.yearId, b.skills, clientMeta(r));
  }

  @Post('exams/co-areas') @RequirePermission('marks', 'view')
  addArea(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ name: z.string().trim().min(2).max(80), classId: z.number().int().positive().nullable() }))) b: any, @Req() r: AppRequest) {
    return this.ex.addCoArea(u, b.name, b.classId, clientMeta(r));
  }

  @Delete('exams/co-areas/:id') @RequirePermission('marks', 'view')
  delArea(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Req() r: AppRequest) { return this.ex.deleteCoArea(u, id, clientMeta(r)); }

  /** Exam list for teachers and families (no setup details). */
  @Get('exams/list') @RequirePermission('marks', 'view')
  async list() {
    const y = await this.ex.yearFor();
    const rows = await this.db.selectFrom('exams').select(['id', 'code', 'name', 'kind', 'term', 'max_marks', 'on_report_card']).where('academic_year_id', '=', y.id).orderBy('position').execute();
    return rows.map((e) => ({ id: e.id, code: e.code, name: e.name, kind: e.kind, term: e.term, maxMarks: Number(e.max_marks), onReportCard: e.on_report_card === 1 }));
  }

  // ---------------- Schedule ----------------
  @Get('exams/:id/schedule') @RequirePermission('marks', 'view')
  schedule(@Param('id', ParseIntPipe) id: number, @Query(new ZodPipe(z.object({ classId: z.coerce.number().int().positive() }))) q: { classId: number }) { return this.ex.schedule(id, q.classId); }

  @Put('exams/:id/schedule') @RequirePermission('exams', 'configure')
  setSchedule(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(z.object({ classId: z.number().int().positive(), rows: z.array(z.object({ subjectId: z.number().int().positive(), date: date.nullable(), start: time, end: time })) }))) b: any, @Req() r: AppRequest) {
    return this.ex.setSchedule(u, id, b.classId, b.rows, clientMeta(r));
  }

  /** Papers in the next 30 days: all classes for staff with full view, own children's classes for families. */
  @Get('exams/upcoming') @RequirePermission('marks', 'view')
  async upcoming(@CurrentUser() u: RequestUser) {
    const y = await this.ex.yearFor();
    const today = await schoolToday(this.db);
    let classIds: number[] | undefined;
    if (u.workspace !== 'staff' || u.permissions.get('marks.view') !== 'all') {
      const f = await studentFilter(this.db, u, 'marks.view', y.id);
      let q = this.db.selectFrom('enrollments as e').innerJoin('students as s', 's.id', 'e.student_id').innerJoin('families as fa', 'fa.id', 's.family_id').select('e.class_id').distinct().where('e.academic_year_id', '=', y.id);
      if (f.kind === 'sections') q = q.where('e.section_id', 'in', f.sectionIds.length ? f.sectionIds : [0]);
      else if (f.kind === 'family') q = q.where('fa.user_id', '=', f.userId);
      else if (f.kind === 'self') q = q.where('s.user_id', '=', f.userId);
      else if (f.kind !== 'all') q = q.where('e.class_id', '=', 0);
      classIds = (await q.execute()).map((r) => r.class_id);
    }
    const rows = await this.ex.upcomingPapers(y.id, today, addDays(today, 30), classIds);
    return rows.map((r) => ({ exam: r.code, examName: r.exam, subject: r.subject, className: r.class_name, classId: r.class_id, date: iso(r.exam_date), start: r.start_time?.slice(0, 5) ?? null, end: r.end_time?.slice(0, 5) ?? null }));
  }

  // ---------------- Marks ----------------
  @Get('marks/sheets') @RequirePermission('marks', 'view')
  sheets(@CurrentUser() u: RequestUser, @Query(new ZodPipe(z.object({ examId: z.coerce.number().int().positive() }))) q: { examId: number }) {
    if (u.workspace !== 'staff') throw Errors.forbidden();
    return this.ex.sheets(u, q.examId);
  }

  @Get('marks/sheet') @RequirePermission('marks', 'view')
  sheet(@CurrentUser() u: RequestUser, @Query(new ZodPipe(SheetKey)) q: z.infer<typeof SheetKey>) {
    if (u.workspace !== 'staff') throw Errors.forbidden();
    return this.ex.sheet(u, q.examId, q.sectionId, q.subjectId);
  }

  @Put('marks/sheet') @RequirePermission('marks', 'enter')
  save(@CurrentUser() u: RequestUser, @Body(new ZodPipe(SheetBody)) b: z.infer<typeof SheetBody>, @Req() r: AppRequest) {
    return this.ex.saveSheet(u, b.examId, b.sectionId, b.subjectId, b.entries, b.submit, clientMeta(r));
  }

  @Post('marks/sheet/decide') @HttpCode(200) @RequirePermission('marks', 'approve')
  decide(@CurrentUser() u: RequestUser, @Body(new ZodPipe(SheetKey.extend({ approve: z.boolean(), note: z.string().trim().max(255).nullish() }))) b: any, @Req() r: AppRequest) {
    return this.ex.decideSheet(u, b.examId, b.sectionId, b.subjectId, b.approve, b.note ?? null, clientMeta(r));
  }

  @Post('exams/:id/publish') @HttpCode(200) @RequirePermission('marks', 'publish')
  publish(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(z.object({ sectionId: z.number().int().positive() }))) b: { sectionId: number }, @Req() r: AppRequest) {
    return this.ex.publish(u, id, b.sectionId, clientMeta(r));
  }

  @Post('marks/corrections') @RequirePermission('marks', 'enter')
  correct(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ examId: z.number().int().positive(), studentId: z.string().length(26), subjectId: z.number().int().positive(), marks: z.number().min(0).nullable(), absent: z.boolean().default(false), reason: z.string().trim().min(5, 'Give the reason for the correction.').max(255) }))) b: any, @Req() r: AppRequest) {
    return this.ex.requestCorrection(u, b, clientMeta(r));
  }

  @Get('marks/corrections') @RequirePermission('marks', 'view')
  corrections(@CurrentUser() u: RequestUser) { if (u.workspace !== 'staff') throw Errors.forbidden(); return this.ex.corrections(u); }

  @Post('marks/corrections/:id/decide') @HttpCode(200) @RequirePermission('marks', 'approve')
  decideCorrection(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(z.object({ approve: z.boolean(), note: z.string().trim().max(255).nullish() }))) b: any, @Req() r: AppRequest) {
    return this.ex.decideCorrection(u, id, b.approve, b.note ?? null, clientMeta(r));
  }

  // ---------------- Class teacher ----------------
  @Get('marks/my-classes') @RequirePermission('marks', 'view')
  async myClasses(@CurrentUser() u: RequestUser) {
    const y = await this.ex.yearFor();
    const all = u.permissions.get('marks.approve') === 'all';
    const staff = await this.db.selectFrom('staff').select('id').where('user_id', '=', u.id).executeTakeFirst();
    let q = this.db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id').leftJoin('class_teachers as ct', (j) => j.onRef('ct.section_id', '=', 's.id').on('ct.academic_year_id', '=', y.id))
      .select(['s.id', 's.name', 'c.id as class_id', 'c.name as class_name', 'c.level_order', 'ct.staff_id']).where('s.is_active', '=', 1);
    if (!all) q = q.where('ct.staff_id', '=', staff?.id ?? 0);
    const rows = await q.orderBy('c.level_order').orderBy('s.name').execute();
    return rows.map((r) => ({ sectionId: r.id, classId: r.class_id, name: `${r.class_name} ${r.name}`, mine: !!staff && r.staff_id === staff.id }));
  }

  @Get('marks/class-teacher') @RequirePermission('marks', 'view')
  ct(@CurrentUser() u: RequestUser, @Query(new ZodPipe(z.object({ sectionId: z.coerce.number().int().positive(), term: z.coerce.number().int().min(1).max(2) }))) q: any) {
    return this.ex.classTeacherSheet(u, q.sectionId, q.term);
  }

  @Put('marks/class-teacher') @RequirePermission('marks', 'view')
  saveCt(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ sectionId: z.number().int().positive(), term: z.number().int().min(1).max(2),
    rows: z.array(z.object({ studentId: z.string().length(26), grades: z.record(z.string().max(6)).optional(), ratings: z.record(z.enum(['excellent', 'good', 'needs_practice'])).optional(), remarks: z.string().max(600).optional() })).max(200) }))) b: any, @Req() r: AppRequest) {
    return this.ex.saveClassTeacherSheet(u, b.sectionId, b.term, b.rows, clientMeta(r));
  }

  // ---------------- Results ----------------
  /** Section result table for staff (preview includes marks not yet published). */
  @Get('exams/results') @RequirePermission('marks', 'view')
  results(@CurrentUser() u: RequestUser, @Query(new ZodPipe(z.object({ sectionId: z.coerce.number().int().positive() }))) q: { sectionId: number }) {
    return this.ex.sectionResults(u, q.sectionId);
  }

  /** One student's marks: families see published exams only. */
  @Get('students/:id/marks') @RequirePermission('marks', 'view')
  async studentMarks(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    const y = await this.ex.yearFor();
    const sid = await visibleStudentId(this.db, u, id, 'marks.view', y.id);
    const d = await reportCardData(this.db, this.ex, y.id, sid, u.workspace !== 'staff');
    const { institution, student, ...rest } = d;
    return { ...rest, student: { ...student, photo: !!student.photo } };
  }

  @Get('students/:id/report-card.pdf') @RequirePermission('marks', 'view')
  async card(@CurrentUser() u: RequestUser, @Param('id') id: string, @Res() res: Response) {
    const y = await this.ex.yearFor();
    const sid = await visibleStudentId(this.db, u, id, 'marks.view', y.id);
    const d = await reportCardData(this.db, this.ex, y.id, sid, u.workspace !== 'staff');
    const pdf = await renderReportCards([d]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="report-card-${d.student.admissionNo}.pdf"`);
    res.send(pdf);
  }

  @Get('sections/:id/report-cards.pdf') @RequirePermission('marks', 'view')
  async cards(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) sectionId: number, @Res() res: Response) {
    const y = await this.ex.yearFor();
    if (u.workspace !== 'staff' || (u.permissions.get('marks.view') !== 'all' && !(await this.ex.isClassTeacher(u, y.id, sectionId)))) throw Errors.forbidden();
    const ids = await this.db.selectFrom('enrollments as e').innerJoin('students as s', 's.id', 'e.student_id').select('s.id').where('e.section_id', '=', sectionId).where('e.academic_year_id', '=', y.id)
      .where('s.status', '=', 'active').orderBy('e.roll_no').orderBy('s.first_name').execute();
    if (!ids.length) throw Errors.badRequest('NO_STUDENTS', 'No students in this section.');
    const cards = [];
    for (const s of ids) cards.push(await reportCardData(this.db, this.ex, y.id, s.id, false));
    const pdf = await renderReportCards(cards);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="report-cards-${sectionId}.pdf"`);
    res.send(pdf);
  }

  // ---------------- Leaving students (agreed E11) ----------------
  @Get('student-exits') @RequirePermission('students', 'view')
  exits(@CurrentUser() u: RequestUser) { return this.ex.exits(u); }

  @Get('students/:id/exit') @RequirePermission('students', 'view')
  async exit(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    const s = await this.db.selectFrom('students').select('id').where('public_id', '=', id).executeTakeFirst();
    if (!s || u.workspace !== 'staff') throw Errors.notFound('Student');
    const x = await this.db.selectFrom('student_exits').selectAll().where('student_id', '=', s.id).executeTakeFirst();
    return x ? { leavingDate: iso(x.leaving_date), reason: x.reason, tcNumber: x.tc_number, tcIssuedOn: iso(x.tc_issued_on), bonafideNumber: x.bonafide_number, bonafideIssuedOn: iso(x.bonafide_issued_on) } : null;
  }

  /** Recording that a student leaves makes them inactive (with the reason); the checklist can be completed later. */
  @Put('students/:id/exit') @RequirePermission('students', 'deactivate')
  async setExit(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ leavingDate: date, reason: z.string().trim().min(3).max(255),
    tcNumber: z.string().trim().max(40).nullish(), tcIssuedOn: date.nullish(), bonafideNumber: z.string().trim().max(40).nullish(), bonafideIssuedOn: date.nullish() }))) b: any, @Req() r: AppRequest) {
    const s = await this.db.selectFrom('students').select(['id', 'status']).where('public_id', '=', id).executeTakeFirst();
    if (!s) throw Errors.notFound('Student');
    if ((b.tcIssuedOn && !b.tcNumber) || (b.bonafideIssuedOn && !b.bonafideNumber)) throw Errors.validation([{ field: 'tcNumber', message: 'Enter the certificate number with its date.' }]);
    const prev = await this.db.selectFrom('student_exits').selectAll().where('student_id', '=', s.id).executeTakeFirst();
    const d = (x?: string | null) => (x ? new Date(`${x}T00:00:00Z`) : null);
    const row = { leaving_date: d(b.leavingDate)!, reason: b.reason, tc_number: b.tcNumber || null, tc_issued_on: d(b.tcIssuedOn), bonafide_number: b.bonafideNumber || null, bonafide_issued_on: d(b.bonafideIssuedOn),
      tc_marked_by: b.tcIssuedOn ? (prev?.tc_issued_on ? prev.tc_marked_by : u.id) : null, bonafide_marked_by: b.bonafideIssuedOn ? (prev?.bonafide_issued_on ? prev.bonafide_marked_by : u.id) : null };
    if (prev) await this.db.updateTable('student_exits').set(row).where('student_id', '=', s.id).execute();
    else await this.db.insertInto('student_exits').values({ ...row, student_id: s.id, created_by: u.id }).execute();
    if (s.status === 'active') await this.students.setStatus(u, id, false, `Left: ${b.reason}`, clientMeta(r));
    await this.audit.log(u, { module: 'students', action: 'exit_checklist', entityType: 'student', entityId: s.id, after: b, ...clientMeta(r) });
    return this.exit(u, id);
  }

  // ---------------- Student photo ----------------
  @Post('students/:id/photo') @RequirePermission('students', 'view')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024 } }))
  async photo(@CurrentUser() u: RequestUser, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    assertImage(file);
    if (file!.mimetype === 'image/webp') throw Errors.badRequest('NOT_AN_IMAGE', 'Use a JPG or PNG photo.');
    const y = await this.ex.yearFor();
    const sid = await photoStudentId(this.db, u, id, y.id);
    const fid = await this.files.save(file!.buffer, file!.originalname, file!.mimetype, 'student_photo', u.id);
    const before = await this.db.selectFrom('students').select('photo_file_id').where('id', '=', sid).executeTakeFirst();
    await this.db.updateTable('students').set({ photo_file_id: fid, updated_by: u.id }).where('id', '=', sid).execute();
    await this.audit.log(u, { module: 'students', action: 'photo', entityType: 'student', entityId: sid, before: { photo: before?.photo_file_id ?? null }, after: { photo: fid } });
    return { ok: true };
  }

  /** "Class photos": the sections whose students this person may photograph, and the students of one of them. */
  @Get('student-photos') @RequirePermission('students', 'view')
  async classPhotos(@CurrentUser() u: RequestUser, @Query('sectionId') sectionId?: string) {
    if (u.workspace !== 'staff' || !(u.permissions.has('students.photo') || u.permissions.has('students.edit'))) throw Errors.forbidden();
    const y = await this.ex.yearFor();
    const all = u.permissions.get('students.photo') === 'all' || u.permissions.get('students.edit') === 'all';
    const ids = all ? null : await teacherSectionIds(this.db, u.id, y.id);
    let sq = this.db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id').select(['s.id', 's.name', 'c.name as class_name'])
      .where('s.is_active', '=', 1).where('c.is_active', '=', 1).orderBy('c.level_order').orderBy('s.name');
    if (ids) sq = ids.length ? sq.where('s.id', 'in', ids) : sq.where('s.id', '=', -1);
    const sections = (await sq.execute()).map((x) => ({ id: x.id, label: `${x.class_name} ${x.name}` }));
    const sid = Number(sectionId) || sections[0]?.id;
    if (!sid || !sections.some((x) => x.id === sid)) return { sections, sectionId: null, students: [] };
    const students = await this.db.selectFrom('enrollments as e').innerJoin('students as st', 'st.id', 'e.student_id')
      .select(['st.public_id', 'st.first_name', 'st.last_name', 'e.roll_no', 'st.photo_file_id'])
      .where('e.section_id', '=', sid).where('e.academic_year_id', '=', y.id).where('st.status', '=', 'active')
      .orderBy(sql`CAST(e.roll_no AS UNSIGNED)`).orderBy('st.first_name').execute();
    return { sections, sectionId: sid, students: students.map((x) => ({ id: x.public_id, name: [x.first_name, x.last_name].filter(Boolean).join(' '), rollNo: x.roll_no, hasPhoto: !!x.photo_file_id })) };
  }

  @Get('students/:id/photo') @RequirePermission('students', 'view')
  async getPhoto(@CurrentUser() u: RequestUser, @Param('id') id: string, @Res() res: Response) {
    const y = await this.ex.yearFor();
    const sid = await visibleStudentId(this.db, u, id, 'students.view', y.id);
    const f = await this.db.selectFrom('students as s').innerJoin('files as f', 'f.id', 's.photo_file_id').select(['f.storage_path', 'f.mime_type']).where('s.id', '=', sid).executeTakeFirst();
    const p = f && join(STORAGE_DIR, f.storage_path);
    if (!f || !p || !existsSync(p)) throw Errors.notFound('Photo');
    res.setHeader('Content-Type', f.mime_type); res.setHeader('Cache-Control', 'private, max-age=300');
    createReadStream(p).pipe(res);
  }
}

