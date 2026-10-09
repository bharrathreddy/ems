import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { currentYear } from '../common/academic-year';
import type { RequestUser } from '../common/request-user';
import { studentFilter, visibleStudentId } from '../students/student-scope';
import { addDays, eachDay, iso, SchoolCalendar, schoolToday, summarise, type AttStatus } from './calendar';

type Meta = { ip: string | null; userAgent: string | null };
const TEACHER_EDIT_DAYS = 3; // agreed A3: teachers up to 3 days back, admins any time
/** Last day of a YYYY-MM month. */
export const monthEnd = (m: string) => addDays(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 1)).toISOString().slice(0, 10), -1);
export const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

@Injectable()
export class AttendanceService {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService) {}

  /** Sections this user may mark today (class teacher's own first, then sections they teach). */
  async markableSections(u: RequestUser, yearId: number) {
    const scope = u.permissions.get('attendance.mark');
    if (!scope) return { all: false, ids: [] as number[], classTeacherOf: [] as number[] };
    const staff = await this.db.selectFrom('staff').select('id').where('user_id', '=', u.id).executeTakeFirst();
    const ct = staff ? (await this.db.selectFrom('class_teachers').select('section_id').where('staff_id', '=', staff.id).where('academic_year_id', '=', yearId).execute()).map((r) => r.section_id) : [];
    if (scope === 'all') return { all: true, ids: [] as number[], classTeacherOf: ct };
    const f = await studentFilter(this.db, u, 'attendance.mark', yearId);
    const ids = f.kind === 'sections' ? f.sectionIds : [];
    // A class teacher may always mark their own section; a subject teacher the sections they teach (agreed A1).
    return { all: false, ids: [...new Set([...ids, ...ct])], classTeacherOf: ct };
  }

  private async assertCanMark(u: RequestUser, sectionId: number, yearId: number) {
    const m = await this.markableSections(u, yearId);
    if (!m.all && !m.ids.includes(sectionId)) throw Errors.forbidden();
    return m.all;
  }

  private assertEditWindow(isAdmin: boolean, date: string, today: string) {
    if (date > today) throw Errors.badRequest('FUTURE_DATE', 'Attendance cannot be marked for a future date.');
    if (!isAdmin && date < addDays(today, -TEACHER_EDIT_DAYS)) {
      throw Errors.badRequest('EDIT_WINDOW_CLOSED', `Teachers can mark or change attendance up to ${TEACHER_EDIT_DAYS} days back. Ask the admin to change older days.`);
    }
  }

  /** Today's overview: sections to mark and whether they are done. */
  async overview(u: RequestUser, date?: string) {
    const year = await currentYear(this.db);
    const today = await schoolToday(this.db);
    const day = date ?? today;
    const cal = await SchoolCalendar.load(this.db, year.id);
    const m = await this.markableSections(u, year.id);
    let q = this.db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id')
      .leftJoin('attendance_days as ad', (j) => j.onRef('ad.section_id', '=', 's.id').on('ad.att_date', '=', new Date(`${day}T00:00:00Z`)))
      .leftJoin('users as mu', 'mu.id', 'ad.marked_by')
      .select(['s.id', 's.name as section', 'c.name as class_name', 'c.level_order', 'ad.marked_at', 'mu.name as marked_by',
        (eb) => eb.selectFrom('enrollments as e').innerJoin('students as st', 'st.id', 'e.student_id').select((e2) => e2.fn.countAll<number>().as('n'))
          .whereRef('e.section_id', '=', 's.id').where('e.academic_year_id', '=', year.id).where('st.status', '=', 'active').as('students'),
        (eb) => eb.selectFrom('student_attendance as a').select((e2) => e2.fn.countAll<number>().as('n'))
          .whereRef('a.section_id', '=', 's.id').where('a.att_date', '=', new Date(`${day}T00:00:00Z`)).where('a.status', '=', 'absent').as('absent')])
      .where('s.is_active', '=', 1);
    if (!m.all) q = m.ids.length ? q.where('s.id', 'in', m.ids) : q.where(sql<boolean>`1 = 0`);
    const rows = (await q.orderBy('c.level_order').orderBy('s.name').execute()).filter((r) => Number(r.students) > 0);
    return {
      date: day, today, working: cal.isWorking(day), offReason: cal.offReason(day), canMarkAll: m.all,
      sections: rows.map((r) => ({ id: r.id, name: `${r.class_name} ${r.section}`, students: Number(r.students), absent: Number(r.absent),
        marked: !!r.marked_at, markedBy: r.marked_by, markedAt: r.marked_at, isClassTeacher: m.classTeacherOf.includes(r.id) }))
        .sort((a, b) => Number(b.isClassTeacher) - Number(a.isClassTeacher)),
    };
  }

  /** One section on one day: every student with today's status (approved leave pre-filled). */
  async sectionDay(u: RequestUser, sectionId: number, date?: string) {
    const year = await currentYear(this.db);
    const today = await schoolToday(this.db);
    const day = date ?? today;
    const isAdmin = await this.assertCanMark(u, sectionId, year.id);
    const cal = await SchoolCalendar.load(this.db, year.id);
    const d = new Date(`${day}T00:00:00Z`);
    const [sec, students, marks, dayRow] = await Promise.all([
      this.db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id').select(['s.id', 's.name', 'c.name as class_name']).where('s.id', '=', sectionId).executeTakeFirst(),
      this.db.selectFrom('enrollments as e').innerJoin('students as s', 's.id', 'e.student_id')
        .select(['s.id', 's.public_id', 's.first_name', 's.last_name', 's.admission_no', 'e.roll_no'])
        .where('e.section_id', '=', sectionId).where('e.academic_year_id', '=', year.id).where('s.status', '=', 'active')
        .orderBy(sql`CAST(e.roll_no AS UNSIGNED)`).orderBy('s.first_name').execute(),
      this.db.selectFrom('student_attendance').select(['student_id', 'status', 'source']).where('section_id', '=', sectionId).where('att_date', '=', d).execute(),
      this.db.selectFrom('attendance_days as ad').leftJoin('users as u', 'u.id', 'ad.marked_by').select(['ad.marked_at', 'u.name']).where('ad.section_id', '=', sectionId).where('ad.att_date', '=', d).executeTakeFirst(),
    ]);
    if (!sec) throw Errors.notFound('Section');
    const byStudent = new Map(marks.map((m) => [m.student_id, m]));
    let editable = cal.isWorking(day);
    let lockReason: string | null = editable ? null : cal.offReason(day);
    try { this.assertEditWindow(isAdmin, day, today); } catch (e: any) { editable = false; lockReason ??= e.response?.message ?? 'Locked'; }
    return {
      date: day, section: { id: sec.id, name: `${sec.class_name} ${sec.name}` }, marked: !!dayRow, markedBy: dayRow?.name ?? null, markedAt: dayRow?.marked_at ?? null,
      editable, lockReason,
      students: students.map((s) => ({ id: s.public_id, name: [s.first_name, s.last_name].filter(Boolean).join(' '), admissionNo: s.admission_no, rollNo: s.roll_no,
        status: (byStudent.get(s.id)?.status ?? null) as AttStatus | null, onLeave: byStudent.get(s.id)?.source === 'leave' })),
    };
  }

  /** Save a section's day. Idempotent (safe to resend from an offline phone). */
  async markSection(u: RequestUser, sectionId: number, date: string, entries: Array<{ studentId: string; status: AttStatus }>, meta: Meta) {
    const year = await currentYear(this.db);
    const today = await schoolToday(this.db);
    const isAdmin = await this.assertCanMark(u, sectionId, year.id);
    this.assertEditWindow(isAdmin, date, today);
    const cal = await SchoolCalendar.load(this.db, year.id);
    if (!cal.isWorking(date)) throw Errors.badRequest('NOT_A_WORKING_DAY', `${fmt(date)} is not a working day (${cal.offReason(date)}).`);
    const d = new Date(`${date}T00:00:00Z`);
    const result = await this.db.transaction().execute(async (trx) => {
      const students = await trx.selectFrom('enrollments as e').innerJoin('students as s', 's.id', 'e.student_id').innerJoin('families as f', 'f.id', 's.family_id')
        .select(['s.id', 's.public_id', 's.first_name', 's.last_name', 's.user_id', 'f.user_id as family_user_id'])
        .where('e.section_id', '=', sectionId).where('e.academic_year_id', '=', year.id).where('s.status', '=', 'active').execute();
      const byPublic = new Map(students.map((s) => [s.public_id, s]));
      const unknown = entries.filter((e) => !byPublic.has(e.studentId));
      if (unknown.length) throw Errors.validation([{ field: 'entries', message: 'Some students are not in this section. Refresh and try again.' }]);
      const before = new Map((await trx.selectFrom('student_attendance').select(['student_id', 'status']).where('section_id', '=', sectionId).where('att_date', '=', d).forUpdate().execute()).map((r) => [r.student_id, r.status]));
      const newlyAbsent: typeof students = [];
      const changes: Array<{ student: string; from: string | null; to: string }> = [];
      for (const e of entries) {
        const s = byPublic.get(e.studentId)!;
        const prev = before.get(s.id) ?? null;
        if (prev === e.status) continue;
        await trx.insertInto('student_attendance').values({ academic_year_id: year.id, student_id: s.id, section_id: sectionId, att_date: d, status: e.status, source: isAdmin ? 'admin' : 'teacher', marked_by: u.id })
          .onDuplicateKeyUpdate({ status: e.status, source: isAdmin ? 'admin' : 'teacher', marked_by: u.id, section_id: sectionId }).execute();
        changes.push({ student: e.studentId, from: prev, to: e.status });
        if (e.status === 'absent') newlyAbsent.push(s);
      }
      const existingDay = await trx.selectFrom('attendance_days').select('section_id').where('section_id', '=', sectionId).where('att_date', '=', d).executeTakeFirst();
      if (existingDay) await trx.updateTable('attendance_days').set({ updated_by: u.id, updated_at: new Date() }).where('section_id', '=', sectionId).where('att_date', '=', d).execute();
      else await trx.insertInto('attendance_days').values({ section_id: sectionId, att_date: d, academic_year_id: year.id, marked_by: u.id }).execute();
      // Agreed A4: in-app alert to the family when a child is marked absent.
      for (const s of newlyAbsent) {
        const name = [s.first_name, s.last_name].filter(Boolean).join(' ');
        const rows = [{ user_id: s.family_user_id, workspace: 'parent' as const }, ...(s.user_id ? [{ user_id: s.user_id, workspace: 'student' as const }] : [])].filter((r) => r.user_id);
        if (rows.length) await trx.insertInto('notifications').values(rows.map((r) => ({ user_id: r.user_id!, workspace: r.workspace, category: 'academic' as const, push_group: 'absence' as const,
          title: `${name} was marked absent on ${fmt(date)}`, body: 'If this is not correct, or your child is unwell, please inform the class teacher.', link_path: `/students/${s.public_id}` }))).execute();
      }
      if (changes.length || !existingDay) await this.audit.log(u, { module: 'attendance', action: existingDay ? 'update' : 'mark', entityType: 'section', entityId: sectionId, after: { date, changes }, ...meta }, trx);
      return { changed: changes.length, alerted: newlyAbsent.length };
    });
    return { ...result, ...(await this.sectionDay(u, sectionId, date)) };
  }

  /** Office list for WhatsApp messages (agreed A4). */
  async absentees(date?: string) {
    const year = await currentYear(this.db);
    const day = date ?? (await schoolToday(this.db));
    const inst = await this.db.selectFrom('institution_settings').select('name').where('id', '=', 1).executeTakeFirstOrThrow();
    const rows = await this.db.selectFrom('student_attendance as a').innerJoin('students as s', 's.id', 'a.student_id').innerJoin('families as f', 'f.id', 's.family_id')
      .innerJoin('sections as sec', 'sec.id', 'a.section_id').innerJoin('classes as c', 'c.id', 'sec.class_id')
      .select(['s.public_id', 's.first_name', 's.last_name', 'c.name as class_name', 'c.level_order', 'sec.name as section', 'f.father_name', 'f.family_name', 'f.primary_mobile'])
      .where('a.academic_year_id', '=', year.id).where('a.att_date', '=', new Date(`${day}T00:00:00Z`)).where('a.status', '=', 'absent')
      .orderBy('c.level_order').orderBy('sec.name').orderBy('s.first_name').execute();
    return { date: day, rows: rows.map((r) => {
      const name = [r.first_name, r.last_name].filter(Boolean).join(' ');
      const message = `Dear Parent, ${name} (${r.class_name} ${r.section}) is absent today, ${fmt(day)}. If your child is unwell, please inform the class teacher. - ${inst.name}`;
      return { studentId: r.public_id, name, className: `${r.class_name} ${r.section}`, parent: r.father_name ?? r.family_name, mobile: r.primary_mobile, message,
        whatsappUrl: `https://wa.me/91${r.primary_mobile}?text=${encodeURIComponent(message)}` };
    }) };
  }

  /** A section's month: student x day grid and each student's month percentage. */
  async sectionMonth(u: RequestUser, sectionId: number, month: string) {
    const year = await currentYear(this.db);
    const scope = u.permissions.get('attendance.view');
    if (scope !== 'all') await this.assertCanMark(u, sectionId, year.id).catch(() => { throw Errors.forbidden(); });
    const cal = await SchoolCalendar.load(this.db, year.id);
    const from = `${month}-01`, to = monthEnd(month);
    const days = eachDay(from, to).map((d) => ({ date: d, working: cal.isWorking(d), off: cal.offReason(d) }));
    const [students, rows, marked] = await Promise.all([
      this.db.selectFrom('enrollments as e').innerJoin('students as s', 's.id', 'e.student_id')
        .select(['s.id', 's.public_id', 's.first_name', 's.last_name', 'e.roll_no']).where('e.section_id', '=', sectionId).where('e.academic_year_id', '=', year.id).where('s.status', '=', 'active')
        .orderBy(sql`CAST(e.roll_no AS UNSIGNED)`).orderBy('s.first_name').execute(),
      this.db.selectFrom('student_attendance').select(['student_id', 'att_date', 'status']).where('section_id', '=', sectionId)
        .where('att_date', '>=', new Date(`${from}T00:00:00Z`)).where('att_date', '<=', new Date(`${to}T00:00:00Z`)).execute(),
      this.db.selectFrom('attendance_days').select('att_date').where('section_id', '=', sectionId)
        .where('att_date', '>=', new Date(`${from}T00:00:00Z`)).where('att_date', '<=', new Date(`${to}T00:00:00Z`)).execute(),
    ]);
    const markedDays = new Set(marked.map((m) => iso(m.att_date)));
    return {
      month, days: days.map((d) => ({ ...d, marked: markedDays.has(d.date) })),
      students: students.map((s) => {
        const mine = rows.filter((r) => r.student_id === s.id).map((r) => ({ date: iso(r.att_date)!, status: r.status as AttStatus }));
        return { id: s.public_id, name: [s.first_name, s.last_name].filter(Boolean).join(' '), rollNo: s.roll_no,
          statuses: Object.fromEntries(mine.map((r) => [r.date, r.status])), ...summarise(mine, cal) };
      }),
    };
  }

  /** One student's month calendar plus month and year percentages (family and staff). */
  async studentAttendance(u: RequestUser, studentPublicId: string, month?: string) {
    const year = await currentYear(this.db);
    const sid = await visibleStudentId(this.db, u, studentPublicId, 'attendance.view', year.id);
    const cal = await SchoolCalendar.load(this.db, year.id);
    const today = await schoolToday(this.db);
    const m = month ?? today.slice(0, 7);
    const from = `${m}-01`;
    const to = monthEnd(m);
    const rows = (await this.db.selectFrom('student_attendance').select(['att_date', 'status']).where('student_id', '=', sid).where('academic_year_id', '=', year.id).execute())
      .map((r) => ({ date: iso(r.att_date)!, status: r.status as AttStatus }));
    const monthRows = rows.filter((r) => r.date >= from && r.date <= to);
    const byDate = new Map(rows.map((r) => [r.date, r.status]));
    const leaves = await this.db.selectFrom('leave_requests').select(['id', 'start_date', 'end_date', 'reason', 'status', 'decision_note', 'created_at'])
      .where('kind', '=', 'student').where('student_id', '=', sid).orderBy('id', 'desc').limit(20).execute();
    return {
      month: m, today, yearName: year.name, yearStart: cal.start, yearEnd: cal.end,
      days: eachDay(from, to).map((d) => ({ date: d, working: cal.isWorking(d), off: cal.offReason(d), status: byDate.get(d) ?? null, future: d > today })),
      monthSummary: summarise(monthRows, cal), yearSummary: summarise(rows.filter((r) => r.date <= today), cal),
      leaves: leaves.map((l) => ({ ...l, start_date: iso(l.start_date), end_date: iso(l.end_date) })),
    };
  }

  // ---------------- Holidays ----------------
  async holidays() {
    const year = await currentYear(this.db);
    const cal = await SchoolCalendar.load(this.db, year.id);
    const today = await schoolToday(this.db);
    const list = await this.db.selectFrom('holidays').select(['id', 'name', 'start_date', 'end_date']).where('academic_year_id', '=', year.id).orderBy('start_date').execute();
    return { year: year.name, start: cal.start, end: cal.end, workingDaysSoFar: cal.workingDays(cal.start, today < cal.end ? today : cal.end).length,
      workingDaysInYear: cal.workingDays(cal.start, cal.end).length, holidays: list.map((h) => ({ ...h, start_date: iso(h.start_date), end_date: iso(h.end_date) })) };
  }

  async addHoliday(u: RequestUser, b: { name: string; startDate: string; endDate?: string | null }, meta: Meta) {
    const year = await currentYear(this.db);
    const end = b.endDate || b.startDate;
    if (end < b.startDate) throw Errors.validation([{ field: 'endDate', message: 'End date is before the start date.' }]);
    const cal = await SchoolCalendar.load(this.db, year.id);
    if (b.startDate < cal.start || end > cal.end) throw Errors.validation([{ field: 'startDate', message: `Choose dates inside ${year.name}.` }]);
    const marked = await this.db.selectFrom('attendance_days').select((eb) => eb.fn.countAll<number>().as('n'))
      .where('att_date', '>=', new Date(`${b.startDate}T00:00:00Z`)).where('att_date', '<=', new Date(`${end}T00:00:00Z`)).executeTakeFirst();
    const r = await this.db.insertInto('holidays').values({ academic_year_id: year.id, name: b.name, start_date: new Date(`${b.startDate}T00:00:00Z`), end_date: new Date(`${end}T00:00:00Z`), created_by: u.id }).executeTakeFirstOrThrow();
    await this.audit.log(u, { module: 'attendance', action: 'add_holiday', entityType: 'holiday', entityId: Number(r.insertId), after: b, ...meta });
    return { id: Number(r.insertId), warning: Number(marked?.n) ? `Attendance was already taken on some of these days; those days no longer count.` : null };
  }

  async deleteHoliday(u: RequestUser, id: number, meta: Meta) {
    await this.db.deleteFrom('holidays').where('id', '=', id).execute();
    await this.audit.log(u, { module: 'attendance', action: 'delete_holiday', entityType: 'holiday', entityId: id, ...meta });
    return { id };
  }
}
