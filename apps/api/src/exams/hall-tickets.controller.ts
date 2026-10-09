import { Body, Controller, Get, Inject, Param, ParseIntPipe, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { teacherSectionIds, visibleStudentId } from '../students/student-scope';
import { iso, schoolToday } from '../attendance/calendar';
import { ExamsService } from './exams.service';
import { classPapers, DEFAULT_HALL_TICKET_NOTE, hallTicketData, renderHallTickets } from './hall-ticket';

const Q = z.object({ examId: z.coerce.number().int().positive(), sectionId: z.coerce.number().int().positive() });
const ExamQ = z.object({ examId: z.coerce.number().int().positive() });
const Note = z.object({ text: z.string().max(2000).nullable() });

/**
 * Hall tickets: two per A4 page with the class's exam timetable. Printed class-wise by the office or any teacher
 * of the section; parents download their own child's. Fees never block a hall ticket.
 */
@ApiTags('Exams')
@ApiBearerAuth()
@Controller()
export class HallTicketsController {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly ex: ExamsService, private readonly audit: AuditService) {}

  /** Office (marks or exams for everyone) prints any section; other staff the sections they teach or are class teacher of. */
  private async printable(u: RequestUser, yearId: number): Promise<number[] | null> {
    if (u.workspace !== 'staff') throw Errors.forbidden();
    if (u.permissions.get('marks.view') === 'all' || u.permissions.get('exams.view') === 'all') return null;
    return teacherSectionIds(this.db, u.id, yearId);
  }

  private async exam(examId: number, yearId: number) {
    const e = await this.db.selectFrom('exams').select(['id', 'code', 'name', 'hall_ticket_note']).where('id', '=', examId).where('academic_year_id', '=', yearId).executeTakeFirst();
    if (!e) throw Errors.notFound('Exam');
    return e;
  }

  private async section(sectionId: number, ids: number[] | null) {
    if (ids && !ids.includes(sectionId)) throw Errors.badRequest('NOT_YOUR_SECTION', 'You can print hall tickets only for sections you teach or are the class teacher of.');
    const s = await this.db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id').select(['s.id', 's.name', 's.class_id', 'c.name as class_name']).where('s.id', '=', sectionId).executeTakeFirst();
    if (!s) throw Errors.notFound('Section');
    return s;
  }

  private async sectionStudents(sectionId: number, yearId: number) {
    return this.db.selectFrom('enrollments as e').innerJoin('students as st', 'st.id', 'e.student_id')
      .select(['st.id', 'st.first_name', 'st.last_name', 'st.photo_file_id', 'e.roll_no']).where('e.section_id', '=', sectionId).where('e.academic_year_id', '=', yearId)
      .where('st.status', '=', 'active').execute();
  }

  /** What the Hall tickets screen offers: exams that have a timetable, and the sections this person may print. */
  @Get('hall-tickets/options') @RequirePermission('marks', 'view')
  async options(@CurrentUser() u: RequestUser) {
    const y = await this.ex.yearFor();
    const ids = await this.printable(u, y.id);
    const exams = await this.db.selectFrom('exams as e').innerJoin('exam_schedule as s', 's.exam_id', 'e.id')
      .select(['e.id', 'e.code', 'e.name', 'e.hall_ticket_note', (eb) => eb.fn.min('s.exam_date').as('first'), (eb) => eb.fn.max('s.exam_date').as('last')])
      .where('e.academic_year_id', '=', y.id).groupBy(['e.id', 'e.code', 'e.name', 'e.hall_ticket_note', 'e.position']).orderBy('e.position').execute();
    const classes = await this.db.selectFrom('exam_schedule').select(['exam_id', 'class_id']).distinct().where('exam_id', 'in', exams.length ? exams.map((e) => e.id) : [0]).execute();
    let sq = this.db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id').select(['s.id', 's.name', 's.class_id', 'c.name as class_name'])
      .where('s.is_active', '=', 1).where('c.is_active', '=', 1).orderBy('c.level_order').orderBy('s.name');
    if (ids) sq = ids.length ? sq.where('s.id', 'in', ids) : sq.where('s.id', '=', -1);
    return {
      today: await schoolToday(this.db), defaultNote: DEFAULT_HALL_TICKET_NOTE, canEditNote: u.permissions.has('exams.configure'),
      exams: exams.map((e) => ({ id: e.id, code: e.code, name: e.name, first: iso(e.first as any), last: iso(e.last as any), note: e.hall_ticket_note ?? DEFAULT_HALL_TICKET_NOTE,
        customNote: e.hall_ticket_note != null, classIds: classes.filter((c) => c.exam_id === e.id).map((c) => c.class_id) })),
      sections: (await sq.execute()).map((s) => ({ id: s.id, classId: s.class_id, label: `${s.class_name} ${s.name}` })),
    };
  }

  /** Before printing: the timetable, and who has no photo or roll number yet. */
  @Get('hall-tickets/check') @RequirePermission('marks', 'view')
  async check(@CurrentUser() u: RequestUser, @Query(new ZodPipe(Q)) q: z.infer<typeof Q>) {
    const y = await this.ex.yearFor();
    await this.exam(q.examId, y.id);
    const sec = await this.section(q.sectionId, await this.printable(u, y.id));
    const st = await this.sectionStudents(sec.id, y.id);
    const name = (s: { first_name: string; last_name: string | null }) => [s.first_name, s.last_name].filter(Boolean).join(' ');
    return { students: st.length, noPhoto: st.filter((s) => !s.photo_file_id).map(name), noRoll: st.filter((s) => !s.roll_no).map(name), papers: await classPapers(this.db, q.examId, sec.class_id) };
  }

  @Get('hall-tickets/section.pdf') @RequirePermission('marks', 'view')
  async sectionPdf(@CurrentUser() u: RequestUser, @Query(new ZodPipe(Q)) q: z.infer<typeof Q>, @Res() res: Response, @Req() req: AppRequest) {
    const y = await this.ex.yearFor();
    const e = await this.exam(q.examId, y.id);
    const sec = await this.section(q.sectionId, await this.printable(u, y.id));
    if (!(await classPapers(this.db, e.id, sec.class_id)).length) throw Errors.badRequest('NO_TIMETABLE', `Set the ${e.name} timetable for ${sec.class_name} first (Exams → Exams & schedule).`);
    const st = await this.sectionStudents(sec.id, y.id);
    if (!st.length) throw Errors.badRequest('NO_STUDENTS', 'No students in this section.');
    const pdf = await renderHallTickets(await hallTicketData(this.db, e.id, st.map((s) => s.id)));
    await this.audit.log(u, { module: 'exams', action: 'hall_tickets', entityType: 'section', entityId: sec.id, after: { exam: e.code, students: st.length }, ...clientMeta(req) });
    res.setHeader('Content-Type', 'application/pdf');
    const fname = `hall-tickets-${e.code}-${sec.class_name}-${sec.name}`.replace(/[^\w-]+/g, '-');
    res.setHeader('Content-Disposition', `inline; filename="${fname}.pdf"`);
    res.send(pdf);
  }

  /** Instructions printed on this exam's hall tickets (null = the standard text). */
  @Put('exams/:id/hall-ticket-note') @RequirePermission('exams', 'configure')
  async note(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(Note)) b: { text: string | null }, @Req() req: AppRequest) {
    const y = await this.ex.yearFor();
    const e = await this.exam(id, y.id);
    const text = b.text?.trim() || null;
    await this.db.updateTable('exams').set({ hall_ticket_note: text }).where('id', '=', id).execute();
    await this.audit.log(u, { module: 'exams', action: 'hall_ticket_note', entityType: 'exam', entityId: id, before: { text: e.hall_ticket_note }, after: { text }, ...clientMeta(req) });
    return { note: text ?? DEFAULT_HALL_TICKET_NOTE, customNote: text != null };
  }

  /** Hall tickets a parent (or anyone who can see the student) can download: exams with a timetable that are not over. */
  @Get('students/:id/hall-tickets') @RequirePermission('marks', 'view')
  async forStudent(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    const y = await this.ex.yearFor();
    const sid = await visibleStudentId(this.db, u, id, 'marks.view', y.id);
    const en = await this.db.selectFrom('enrollments').select('class_id').where('student_id', '=', sid).where('academic_year_id', '=', y.id).executeTakeFirst();
    if (!en) return [];
    const today = await schoolToday(this.db);
    const rows = await this.db.selectFrom('exams as e').innerJoin('exam_schedule as s', 's.exam_id', 'e.id')
      .select(['e.id', 'e.code', 'e.name', (eb) => eb.fn.min('s.exam_date').as('first'), (eb) => eb.fn.max('s.exam_date').as('last')])
      .where('e.academic_year_id', '=', y.id).where('s.class_id', '=', en.class_id).groupBy(['e.id', 'e.code', 'e.name', 'e.position']).orderBy('e.position').execute();
    return rows.map((r) => ({ examId: r.id, code: r.code, name: r.name, first: iso(r.first as any), last: iso(r.last as any) })).filter((r) => r.last! >= today);
  }

  @Get('students/:id/hall-ticket.pdf') @RequirePermission('marks', 'view')
  async studentPdf(@CurrentUser() u: RequestUser, @Param('id') id: string, @Query(new ZodPipe(ExamQ)) q: { examId: number }, @Res() res: Response) {
    const y = await this.ex.yearFor();
    const sid = await visibleStudentId(this.db, u, id, 'marks.view', y.id);
    const e = await this.exam(q.examId, y.id);
    const d = await hallTicketData(this.db, e.id, [sid]);
    if (!d.students.length) throw Errors.badRequest('NOT_ENROLLED', 'This student is not in a class this year.');
    if (!d.students[0].papers.length) throw Errors.badRequest('NO_TIMETABLE', 'The timetable for this exam is not ready yet.');
    const pdf = await renderHallTickets(d);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="hall-ticket-${e.code}-${d.students[0].admissionNo}.pdf"`);
    res.send(pdf);
  }
}
