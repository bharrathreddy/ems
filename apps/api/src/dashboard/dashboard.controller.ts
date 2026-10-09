import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sql } from 'kysely';
import { z } from 'zod';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { resolveYear } from '../common/academic-year';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, type RequestUser } from '../common/request-user';
import { PermissionsService } from '../permissions/permissions.service';
import { studentFilter } from '../students/student-scope';
import { addDays, eachDay, iso, SchoolCalendar, schoolToday } from '../attendance/calendar';
import { LeaveStaffService } from '../attendance/leave-staff.service';

const Q = z.object({ yearId: z.coerce.number().int().positive().optional() });
const num = (v: unknown) => Number(v ?? 0);
const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

/**
 * Staff home analytics for one academic year. Each block appears only for people allowed to see it
 * (and only when its module is switched on); a teacher sees their own students, not school totals.
 */
@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly perms: PermissionsService, private readonly leave: LeaveStaffService) {}

  @Get()
  async get(@CurrentUser() u: RequestUser, @Query(new ZodPipe(Q)) q: z.infer<typeof Q>) {
    if (u.workspace !== 'staff') throw Errors.forbidden();
    const year = await resolveYear(this.db, q.yearId, false);
    const today = await schoolToday(this.db);
    const cal = await SchoolCalendar.load(this.db, year.id);
    // For a past (or future) year, show the period that belongs to that year.
    const ref = today < cal.start ? cal.start : today > cal.end ? cal.end : today;
    const on = async (m: string) => this.perms.isModuleEnabled(m);
    const all = (p: string) => u.permissions.get(p) === 'all';
    const years = await this.db.selectFrom('academic_years').select(['id', 'name', 'status', 'is_current']).orderBy('start_date', 'desc').execute();

    const [counts, attendance, finance, upcoming, birthdays, staffLeave] = await Promise.all([
      this.counts(u, year.id),
      (await on('attendance')) && all('attendance.view') ? this.attendance(year.id, cal, ref, today) : null,
      (await on('fees')) && all('fees.view') ? this.finance(year.id, today) : null,
      this.upcoming(year.id, cal, today, await on('cms'), (await on('exams')) && u.permissions.has('marks.view')),
      this.birthdays(u, year.id, today),
      (await on('attendance')) && u.permissions.has('staff.view') ? this.staffLeave(u, today) : null,
    ]);
    return { year: { id: year.id, name: year.name, status: year.status, start: cal.start, end: cal.end }, years, today, ref, counts, attendance, finance, upcoming, birthdays, staffLeave };
  }

  private async counts(u: RequestUser, yearId: number) {
    const out: Record<string, number | null> = {};
    if (u.permissions.has('students.view')) {
      const f = await studentFilter(this.db, u, 'students.view', yearId);
      let q = this.db.selectFrom('enrollments as e').innerJoin('students as s', 's.id', 'e.student_id')
        .select([sql<number>`COUNT(*)`.as('n'), sql<number>`SUM(s.gender = 'male')`.as('boys'), sql<number>`SUM(s.gender = 'female')`.as('girls'),
          sql<number>`COUNT(DISTINCT s.family_id)`.as('families'), sql<number>`COUNT(DISTINCT e.section_id)`.as('sections'),
          sql<number>`SUM(NOT EXISTS (SELECT 1 FROM enrollments p JOIN academic_years py ON py.id = p.academic_year_id WHERE p.student_id = e.student_id AND py.start_date < (SELECT start_date FROM academic_years WHERE id = ${yearId})))`.as('new_admissions')])
        .where('e.academic_year_id', '=', yearId).where('s.status', '=', 'active');
      if (f.kind === 'sections') q = f.sectionIds.length ? q.where('e.section_id', 'in', f.sectionIds) : q.where(sql<boolean>`1 = 0`);
      if (f.kind !== 'all' && f.kind !== 'sections') q = q.where(sql<boolean>`1 = 0`);
      const r = await q.executeTakeFirst();
      Object.assign(out, { students: num(r?.n), boys: num(r?.boys), girls: num(r?.girls), families: num(r?.families), sections: num(r?.sections), newAdmissions: num(r?.new_admissions) });
    }
    if (u.permissions.has('staff.view')) {
      const r = await this.db.selectFrom('staff as s').innerJoin('users as us', 'us.id', 's.user_id').select((eb) => eb.fn.countAll<number>().as('n'))
        .where('s.status', '=', 'active').where('s.deleted_at', 'is', null).where('us.status', '=', 'active').executeTakeFirst();
      out.staff = num(r?.n);
    }
    if (u.permissions.has('announcements.view')) {
      const y = await this.db.selectFrom('academic_years').select(['start_date', 'end_date']).where('id', '=', yearId).executeTakeFirstOrThrow();
      const r = await this.db.selectFrom('announcements').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'published')
        .where('publish_at', '>=', y.start_date).where('publish_at', '<=', new Date(`${iso(y.end_date)}T23:59:59Z`)).executeTakeFirst();
      out.notices = num(r?.n);
    }
    out.pendingLeave = (await this.leave.list(u, 'pending')).filter((l) => l.canDecide).length;
    return out;
  }

  /** Monday to Saturday of the week containing `ref`. */
  private async attendance(yearId: number, cal: SchoolCalendar, ref: string, today: string) {
    const dow = (new Date(`${ref}T00:00:00Z`).getUTCDay() + 6) % 7;
    const monday = addDays(ref, -dow);
    const days = eachDay(monday, addDays(monday, 5));
    const [rows, marked, sectionTotal, staffRows, staffTotal] = await Promise.all([
      this.db.selectFrom('student_attendance').select(['att_date', 'status', sql<number>`COUNT(*)`.as('n')])
        .where('academic_year_id', '=', yearId).where('att_date', '>=', new Date(`${days[0]}T00:00:00Z`)).where('att_date', '<=', new Date(`${days[5]}T00:00:00Z`))
        .groupBy(['att_date', 'status']).execute(),
      this.db.selectFrom('attendance_days').select(['att_date', sql<number>`COUNT(*)`.as('n')])
        .where('academic_year_id', '=', yearId).where('att_date', '>=', new Date(`${days[0]}T00:00:00Z`)).where('att_date', '<=', new Date(`${days[5]}T00:00:00Z`)).groupBy('att_date').execute(),
      this.db.selectFrom('enrollments as e').innerJoin('students as s', 's.id', 'e.student_id').select(sql<number>`COUNT(DISTINCT e.section_id)`.as('n'))
        .where('e.academic_year_id', '=', yearId).where('s.status', '=', 'active').executeTakeFirst(),
      this.db.selectFrom('staff_attendance').select(['att_date', 'status', sql<number>`COUNT(*)`.as('n')])
        .where('att_date', '>=', new Date(`${days[0]}T00:00:00Z`)).where('att_date', '<=', new Date(`${days[5]}T00:00:00Z`)).groupBy(['att_date', 'status']).execute(),
      this.db.selectFrom('staff').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'active').where('deleted_at', 'is', null).executeTakeFirst(),
    ]);
    const week = days.map((d) => {
      const r = rows.filter((x) => iso(x.att_date) === d);
      const c = (s: string) => num(r.find((x) => x.status === s)?.n);
      const st = staffRows.filter((x) => iso(x.att_date) === d);
      const sc = (s: string) => num(st.find((x) => x.status === s)?.n);
      const present = c('present') + c('late') + c('half_day');
      const total = present + c('absent') + c('leave');
      return { date: d, working: cal.isWorking(d), off: cal.offReason(d), future: d > today,
        present, absent: c('absent'), leave: c('leave'), late: c('late'), halfDay: c('half_day'),
        percentage: total ? Math.round(((c('present') + c('late') + c('half_day') * 0.5) / total) * 1000) / 10 : null,
        sectionsMarked: num(marked.find((m) => iso(m.att_date) === d)?.n), staffPresent: sc('present') + sc('half_day'), staffAbsent: sc('absent'), staffLeave: sc('leave') };
    });
    const sum = (k: 'present' | 'absent' | 'leave') => week.reduce((t, d) => t + d[k], 0);
    return { from: days[0], to: days[5], days: week, totals: { present: sum('present'), absent: sum('absent'), leave: sum('leave') }, sections: num(sectionTotal?.n), staff: num(staffTotal?.n) };
  }

  private async finance(yearId: number, today: string) {
    const month = today.slice(0, 7);
    const [items, pays, byMonth, methods] = await Promise.all([
      this.db.selectFrom('fee_items').select([sql<string>`SUM(amount)`.as('fee'), sql<string>`SUM(paid_amount)`.as('paid'), sql<string>`SUM(waived_amount)`.as('waived'), sql<string>`SUM(balance)`.as('due'),
        sql<string>`SUM(CASE WHEN due_date IS NOT NULL AND due_date <= ${today} THEN balance ELSE 0 END)`.as('overdue'),
        sql<number>`COUNT(DISTINCT CASE WHEN balance > 0 THEN student_id END)`.as('students_due')]).where('academic_year_id', '=', yearId).executeTakeFirst(),
      this.db.selectFrom('payments').select([sql<string>`SUM(CASE WHEN payment_date = ${today} THEN total_amount ELSE 0 END)`.as('today'),
        sql<string>`SUM(CASE WHEN DATE_FORMAT(payment_date, '%Y-%m') = ${month} THEN total_amount ELSE 0 END)`.as('month'),
        sql<string>`SUM(total_amount)`.as('year'), sql<number>`COUNT(*)`.as('receipts')])
        .where('academic_year_id', '=', yearId).where('status', '=', 'valid').where('receipt_type', '=', 'regular').executeTakeFirst(),
      this.db.selectFrom('payments').select([sql<string>`DATE_FORMAT(payment_date, '%Y-%m')`.as('month'), sql<string>`SUM(total_amount)`.as('amount')])
        .where('academic_year_id', '=', yearId).where('status', '=', 'valid').where('receipt_type', '=', 'regular').groupBy(sql`DATE_FORMAT(payment_date, '%Y-%m')`).orderBy(sql`DATE_FORMAT(payment_date, '%Y-%m')`).execute(),
      this.db.selectFrom('payments').select(['method', sql<string>`SUM(total_amount)`.as('amount')])
        .where('academic_year_id', '=', yearId).where('status', '=', 'valid').where('receipt_type', '=', 'regular').groupBy('method').execute(),
    ]);
    const fee = money(items?.fee), paid = money(items?.paid);
    return {
      totalFee: fee, collected: paid, waived: money(items?.waived), outstanding: money(items?.due), overdue: money(items?.overdue), studentsWithDues: num(items?.students_due),
      collectedPct: fee ? Math.round((paid / fee) * 1000) / 10 : null,
      receivedToday: money(pays?.today), receivedThisMonth: money(pays?.month), receivedThisYear: money(pays?.year), receipts: num(pays?.receipts),
      byMonth: byMonth.map((m) => ({ month: m.month, amount: money(m.amount) })), byMethod: methods.map((m) => ({ method: m.method, amount: money(m.amount) })),
    };
  }

  /** Holidays and website events in the next 30 days. */
  private async upcoming(yearId: number, cal: SchoolCalendar, today: string, cmsOn: boolean, examsOn: boolean) {
    const until = addDays(today, 30);
    const [hols, events, papers] = await Promise.all([
      this.db.selectFrom('holidays').select(['name', 'start_date', 'end_date']).where('academic_year_id', '=', yearId)
        .where('end_date', '>=', new Date(`${today}T00:00:00Z`)).where('start_date', '<=', new Date(`${until}T00:00:00Z`)).orderBy('start_date').execute(),
      cmsOn ? this.db.selectFrom('cms_events').select(['title', 'slug', 'event_date', 'end_date', 'location']).where('is_published', '=', 1)
        .where('event_date', '>=', new Date(`${today}T00:00:00Z`)).where('event_date', '<=', new Date(`${until}T00:00:00Z`)).orderBy('event_date').execute() : Promise.resolve([]),
      examsOn ? this.db.selectFrom('exam_schedule as s').innerJoin('exams as e', 'e.id', 's.exam_id')
        .select(['e.code', 'e.name', sql<string>`MIN(s.exam_date)`.as('first'), sql<string>`MAX(s.exam_date)`.as('last'), sql<number>`COUNT(DISTINCT s.class_id)`.as('classes')])
        .where('e.academic_year_id', '=', yearId).where('s.exam_date', '>=', new Date(`${today}T00:00:00Z`)).where('s.exam_date', '<=', new Date(`${until}T00:00:00Z`))
        .groupBy(['e.code', 'e.name']).execute() : Promise.resolve([]),
    ]);
    const items = [
      ...hols.map((h) => ({ kind: 'holiday' as const, title: h.name, date: iso(h.start_date)!, endDate: iso(h.end_date), link: null as string | null, place: null as string | null })),
      ...papers.map((p) => ({ kind: 'exam' as 'holiday', title: `${p.name} (${p.code})`, date: iso(p.first as any)!, endDate: iso(p.last as any), link: null as string | null, place: `${num(p.classes)} class${num(p.classes) > 1 ? 'es' : ''}` })),
      ...events.map((e) => ({ kind: 'event' as const, title: e.title, date: iso(e.event_date)!, endDate: iso(e.end_date), link: `/events/${e.slug}`, place: e.location })),
    ];
    // Upcoming "Saturday off" days are part of the calendar too.
    for (const d of eachDay(addDays(today, 1), addDays(today, 14))) {
      const why = cal.offReason(d);
      if (why && /Saturday holiday/.test(why)) items.push({ kind: 'holiday', title: why, date: d, endDate: d, link: null, place: null });
    }
    return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
  }

  /** Birthdays today and in the next 7 days (students within the user's scope, and staff). */
  private async birthdays(u: RequestUser, yearId: number, today: string) {
    const days = eachDay(today, addDays(today, 7)).map((d) => d.slice(5));
    const out: Array<{ kind: 'student' | 'staff'; id: string; name: string; detail: string | null; date: string; age: number; mobile: string | null }> = [];
    const when = (mmdd: string) => { const y = Number(today.slice(0, 4)); const d = `${y}-${mmdd}`; return d < today ? `${y + 1}-${mmdd}` : d; };
    if (u.permissions.has('students.view')) {
      const f = await studentFilter(this.db, u, 'students.view', yearId);
      let q = this.db.selectFrom('students as s').innerJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 's.id').on('e.academic_year_id', '=', yearId))
        .innerJoin('sections as sec', 'sec.id', 'e.section_id').innerJoin('classes as c', 'c.id', 'sec.class_id').innerJoin('families as fa', 'fa.id', 's.family_id')
        .select(['s.public_id', 's.first_name', 's.last_name', 's.dob', 'c.name as class_name', 'sec.name as section', 'fa.primary_mobile'])
        .where('s.status', '=', 'active').where('s.dob', 'is not', null).where(sql<string>`DATE_FORMAT(s.dob, '%m-%d')`, 'in', days);
      if (f.kind === 'sections') q = f.sectionIds.length ? q.where('e.section_id', 'in', f.sectionIds) : q.where(sql<boolean>`1 = 0`);
      if (f.kind !== 'all' && f.kind !== 'sections') q = q.where(sql<boolean>`1 = 0`);
      for (const s of await q.execute()) {
        const d = when(iso(s.dob)!.slice(5));
        out.push({ kind: 'student', id: s.public_id, name: [s.first_name, s.last_name].filter(Boolean).join(' '), detail: `${s.class_name} ${s.section}`, date: d,
          age: Number(d.slice(0, 4)) - Number(iso(s.dob)!.slice(0, 4)), mobile: s.primary_mobile });
      }
    }
    if (u.permissions.has('staff.view')) {
      const rows = await this.db.selectFrom('staff as s').innerJoin('users as us', 'us.id', 's.user_id')
        .select(['s.public_id', 'us.name', 's.designation', 's.dob', 'us.mobile']).where('s.status', '=', 'active').where('s.deleted_at', 'is', null)
        .where('s.dob', 'is not', null).where(sql<string>`DATE_FORMAT(s.dob, '%m-%d')`, 'in', days).execute();
      for (const s of rows) {
        const d = when(iso(s.dob)!.slice(5));
        out.push({ kind: 'staff', id: s.public_id, name: s.name, detail: s.designation, date: d, age: Number(d.slice(0, 4)) - Number(iso(s.dob)!.slice(0, 4)), mobile: s.mobile });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)).slice(0, 30);
  }

  /** Staff on approved leave today and in the next 14 days, plus requests waiting. */
  private async staffLeave(u: RequestUser, today: string) {
    const until = addDays(today, 14);
    const rows = await this.db.selectFrom('leave_requests as l').innerJoin('staff as st', 'st.id', 'l.staff_id').innerJoin('users as us', 'us.id', 'st.user_id')
      .select(['l.id', 'us.name', 'st.designation', 'l.start_date', 'l.end_date', 'l.reason', 'l.status'])
      .where('l.kind', '=', 'staff').where('l.status', 'in', ['approved', 'pending'])
      .where('l.end_date', '>=', new Date(`${today}T00:00:00Z`)).where('l.start_date', '<=', new Date(`${until}T00:00:00Z`)).orderBy('l.start_date').execute();
    const list = rows.map((r) => ({ id: r.id, name: r.name, designation: r.designation, startDate: iso(r.start_date)!, endDate: iso(r.end_date)!, reason: r.reason, status: r.status,
      onLeaveToday: r.status === 'approved' && iso(r.start_date)! <= today && iso(r.end_date)! >= today }));
    return { today: list.filter((l) => l.onLeaveToday).length, pending: list.filter((l) => l.status === 'pending').length, list };
  }
}
