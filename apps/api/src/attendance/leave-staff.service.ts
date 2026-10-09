import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { currentYear } from '../common/academic-year';
import { readJson } from '../common/json';
import type { RequestUser } from '../common/request-user';
import { visibleStudentId } from '../students/student-scope';
import { eachDay, iso, SchoolCalendar, schoolToday } from './calendar';
import { AttendanceService, fmt, monthEnd } from './attendance.service';
import { PermissionsService } from '../permissions/permissions.service';
import { leaveBalances } from '../hr/leave-balance';

type Meta = { ip: string | null; userAgent: string | null };
export interface SchoolLocation { lat: number; lng: number; radiusM: number }

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

@Injectable()
export class LeaveStaffService {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService, private readonly att: AttendanceService, private readonly perms: PermissionsService) {}

  private async staffOf(u: RequestUser) {
    const s = await this.db.selectFrom('staff').select(['id', 'public_id']).where('user_id', '=', u.id).where('status', '=', 'active').executeTakeFirst();
    if (!s) throw Errors.badRequest('NOT_STAFF', 'Only staff members can do this.');
    return s;
  }
  private notify(trx: Database, userId: number | null, workspace: 'staff' | 'parent', title: string, body: string, link: string | null) {
    if (!userId) return Promise.resolve();
    return trx.insertInto('notifications').values({ user_id: userId, workspace, category: 'academic', title, body, link_path: link }).execute();
  }

  // ---------------- Leave requests ----------------

  /** Agreed A5: a family applies for a child; the class teacher approves. */
  async applyForStudent(u: RequestUser, studentPublicId: string, b: { startDate: string; endDate: string; reason: string }, meta: Meta) {
    if (u.workspace === 'staff') throw Errors.badRequest('FAMILY_ONLY', 'Families apply for leave from the parent view.');
    const year = await currentYear(this.db);
    const sid = await visibleStudentId(this.db, u, studentPublicId, 'attendance.view', year.id);
    await this.checkDates(year.id, b.startDate, b.endDate, true);
    const overlap = await this.db.selectFrom('leave_requests').select('id').where('student_id', '=', sid).where('status', 'in', ['pending', 'approved'])
      .where('start_date', '<=', new Date(`${b.endDate}T00:00:00Z`)).where('end_date', '>=', new Date(`${b.startDate}T00:00:00Z`)).executeTakeFirst();
    if (overlap) throw Errors.badRequest('LEAVE_OVERLAP', 'There is already a leave request for some of these days.');
    const r = await this.db.transaction().execute(async (trx) => {
      const r = await trx.insertInto('leave_requests').values({ kind: 'student', student_id: sid, start_date: new Date(`${b.startDate}T00:00:00Z`), end_date: new Date(`${b.endDate}T00:00:00Z`), reason: b.reason, requested_by: u.id }).executeTakeFirstOrThrow();
      const ct = await trx.selectFrom('enrollments as e').innerJoin('class_teachers as ct', (j) => j.onRef('ct.section_id', '=', 'e.section_id').onRef('ct.academic_year_id', '=', 'e.academic_year_id'))
        .innerJoin('staff as st', 'st.id', 'ct.staff_id').innerJoin('students as s', 's.id', 'e.student_id')
        .select(['st.user_id', 's.first_name', 's.last_name']).where('e.student_id', '=', sid).where('e.academic_year_id', '=', year.id).executeTakeFirst();
      if (ct) await this.notify(trx, ct.user_id, 'staff', `Leave request: ${[ct.first_name, ct.last_name].filter(Boolean).join(' ')}`, `${fmt(b.startDate)}${b.endDate !== b.startDate ? ` to ${fmt(b.endDate)}` : ''}: ${b.reason}`, '/leave');
      await this.audit.log(u, { module: 'attendance', action: 'leave_request', entityType: 'leave_request', entityId: Number(r.insertId), after: b, ...meta }, trx);
      return r;
    });
    return { id: Number(r.insertId), status: 'pending' };
  }

  /** Agreed A9: staff apply for their own leave; the admin approves. */
  async applyForSelf(u: RequestUser, b: { startDate: string; endDate: string; reason: string; leaveTypeId?: number | null }, meta: Meta) {
    const staff = await this.staffOf(u);
    const year = await currentYear(this.db);
    await this.checkDates(year.id, b.startDate, b.endDate, false);
    const overlap = await this.db.selectFrom('leave_requests').select('id').where('staff_id', '=', staff.id).where('status', 'in', ['pending', 'approved'])
      .where('start_date', '<=', new Date(`${b.endDate}T00:00:00Z`)).where('end_date', '>=', new Date(`${b.startDate}T00:00:00Z`)).executeTakeFirst();
    if (overlap) throw Errors.badRequest('LEAVE_OVERLAP', 'You already have a leave request for some of these days.');
    // R6: with HR switched on, staff choose a leave type and cannot go over its yearly allowance.
    let typeId: number | null = null;
    if (await this.perms.isModuleEnabled('hr')) {
      const balances = await leaveBalances(this.db, staff.id, year.id);
      if (balances.length) {
        const t = balances.find((x) => x.id === b.leaveTypeId);
        if (!t) throw Errors.validation([{ field: 'leaveTypeId', message: 'Choose the type of leave.' }]);
        const days = (await SchoolCalendar.load(this.db, year.id)).workingDays(b.startDate, b.endDate).length;
        if (t.left != null && days > t.left) throw Errors.badRequest('LEAVE_BALANCE', `You have ${t.left} ${t.name.toLowerCase()} day${t.left === 1 ? '' : 's'} left this year, and this request is ${days} working day${days === 1 ? '' : 's'}. Choose fewer days or another type of leave.`);
        typeId = t.id;
      }
    }
    const r = await this.db.insertInto('leave_requests').values({ kind: 'staff', staff_id: staff.id, leave_type_id: typeId, start_date: new Date(`${b.startDate}T00:00:00Z`), end_date: new Date(`${b.endDate}T00:00:00Z`), reason: b.reason, requested_by: u.id }).executeTakeFirstOrThrow();
    await this.audit.log(u, { module: 'attendance', action: 'staff_leave_request', entityType: 'leave_request', entityId: Number(r.insertId), after: b, ...meta });
    return { id: Number(r.insertId), status: 'pending' };
  }

  private async checkDates(yearId: number, start: string, end: string, allowPastDays: boolean) {
    if (end < start) throw Errors.validation([{ field: 'endDate', message: 'End date is before the start date.' }]);
    const cal = await SchoolCalendar.load(this.db, yearId);
    const today = await schoolToday(this.db);
    if (start < cal.start || end > cal.end) throw Errors.validation([{ field: 'startDate', message: 'Choose dates in the current academic year.' }]);
    if (!allowPastDays && start < today) throw Errors.validation([{ field: 'startDate', message: 'Leave cannot start in the past.' }]);
    if (allowPastDays && start < eachDay(start, today).slice(-31)[0]) throw Errors.validation([{ field: 'startDate', message: 'Leave can be applied up to 30 days back.' }]);
    if (!cal.workingDays(start, end).length) throw Errors.validation([{ field: 'startDate', message: 'These dates are all holidays.' }]);
  }

  /** Requests this user should see: own (family/staff), or ones they decide. */
  async list(u: RequestUser, status?: string) {
    const year = await currentYear(this.db);
    let q = this.db.selectFrom('leave_requests as l')
      .leftJoin('students as s', 's.id', 'l.student_id').leftJoin('staff as st', 'st.id', 'l.staff_id').leftJoin('users as su', 'su.id', 'st.user_id')
      .leftJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 'l.student_id').on('e.academic_year_id', '=', year.id))
      .leftJoin('sections as sec', 'sec.id', 'e.section_id').leftJoin('classes as c', 'c.id', 'sec.class_id')
      .innerJoin('users as ru', 'ru.id', 'l.requested_by').leftJoin('users as du', 'du.id', 'l.decided_by').leftJoin('leave_types as lt', 'lt.id', 'l.leave_type_id')
      .select(['l.id', 'l.kind', 'l.start_date', 'l.end_date', 'l.reason', 'l.status', 'l.decision_note', 'l.decided_at', 'l.created_at', 'l.requested_by', 'e.section_id',
        's.public_id as student_id', 's.first_name', 's.last_name', 'c.name as class_name', 'sec.name as section', 'su.name as staff_name', 'st.user_id as staff_user_id', 'ru.name as requested_by_name', 'du.name as decided_by_name', 'lt.name as leave_type', 'lt.is_paid as leave_paid']);
    if (status) q = q.where('l.status', '=', status as any);
    const rows = await q.orderBy('l.id', 'desc').limit(200).execute();
    const m = await this.att.markableSections(u, year.id);
    const canStaff = u.permissions.has('staff.edit') && u.workspace === 'staff';
    const out = rows.filter((r) => {
      if (r.requested_by === u.id) return true;
      if (u.workspace !== 'staff') return false;
      if (r.kind === 'student') return u.permissions.get('attendance.mark') === 'all' || (r.section_id != null && (m.classTeacherOf.includes(r.section_id) || m.ids.includes(r.section_id)));
      return canStaff;
    });
    return out.map((r) => ({
      id: r.id, kind: r.kind, startDate: iso(r.start_date), endDate: iso(r.end_date), reason: r.reason, status: r.status, decisionNote: r.decision_note, decidedBy: r.decided_by_name, decidedAt: r.decided_at, createdAt: r.created_at,
      who: r.kind === 'student' ? [r.first_name, r.last_name].filter(Boolean).join(' ') : r.staff_name, studentId: r.student_id,
      className: r.class_name ? `${r.class_name} ${r.section}` : null, requestedBy: r.requested_by_name, mine: r.requested_by === u.id, leaveType: r.leave_type ?? null, unpaid: r.leave_type != null && !r.leave_paid,
      canDecide: r.status === 'pending' && r.requested_by !== u.id && u.workspace === 'staff' && (r.kind === 'staff' ? canStaff : u.permissions.get('attendance.mark') === 'all' || (r.section_id != null && m.classTeacherOf.includes(r.section_id))),
    }));
  }

  async decide(u: RequestUser, id: number, approve: boolean, note: string | null, meta: Meta) {
    const year = await currentYear(this.db);
    const l = await this.db.selectFrom('leave_requests').selectAll().where('id', '=', id).executeTakeFirst();
    if (!l) throw Errors.notFound('Leave request');
    if (l.status !== 'pending') throw Errors.badRequest('ALREADY_DECIDED', 'This request has already been decided.');
    if (l.requested_by === u.id) throw Errors.forbidden();
    const list = await this.list(u);
    if (!list.find((r) => r.id === id)?.canDecide) throw Errors.forbidden();
    const cal = await SchoolCalendar.load(this.db, year.id);
    const days = cal.workingDays(iso(l.start_date)!, iso(l.end_date)!);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('leave_requests').set({ status: approve ? 'approved' : 'rejected', decided_by: u.id, decided_at: new Date(), decision_note: note }).where('id', '=', id).execute();
      if (approve && l.kind === 'student') {
        const enr = await trx.selectFrom('enrollments').select('section_id').where('student_id', '=', l.student_id!).where('academic_year_id', '=', year.id).executeTakeFirstOrThrow();
        for (const d of days) {
          const at = new Date(`${d}T00:00:00Z`);
          const cur = await trx.selectFrom('student_attendance').select(['status']).where('student_id', '=', l.student_id!).where('att_date', '=', at).executeTakeFirst();
          if (cur && cur.status !== 'absent') continue; // never overwrite a day the child attended
          await trx.insertInto('student_attendance').values({ academic_year_id: year.id, student_id: l.student_id!, section_id: enr.section_id, att_date: at, status: 'leave', source: 'leave', marked_by: u.id })
            .onDuplicateKeyUpdate({ status: 'leave', source: 'leave', marked_by: u.id }).execute();
        }
      }
      if (approve && l.kind === 'staff') {
        for (const d of days) {
          await trx.insertInto('staff_attendance').values({ staff_id: l.staff_id!, att_date: new Date(`${d}T00:00:00Z`), status: 'leave', source: 'leave', updated_by: u.id })
            .onDuplicateKeyUpdate({ status: 'leave', source: 'leave', updated_by: u.id }).execute();
        }
      }
      const range = `${fmt(iso(l.start_date)!)}${iso(l.end_date) !== iso(l.start_date) ? ` to ${fmt(iso(l.end_date)!)}` : ''}`;
      await this.notify(trx, l.requested_by, l.kind === 'student' ? 'parent' : 'staff', `Leave ${approve ? 'approved' : 'not approved'}: ${range}`, note ?? '', l.kind === 'student' ? null : '/leave');
      await this.audit.log(u, { module: 'attendance', action: approve ? 'leave_approve' : 'leave_reject', entityType: 'leave_request', entityId: id, after: { note }, ...meta }, trx);
    });
    return { id, status: approve ? 'approved' : 'rejected' };
  }

  async cancel(u: RequestUser, id: number) {
    const l = await this.db.selectFrom('leave_requests').select(['requested_by', 'status']).where('id', '=', id).executeTakeFirst();
    if (!l || l.requested_by !== u.id) throw Errors.notFound('Leave request');
    if (l.status !== 'pending') throw Errors.badRequest('ALREADY_DECIDED', 'Only a pending request can be cancelled.');
    await this.db.updateTable('leave_requests').set({ status: 'cancelled' }).where('id', '=', id).execute();
    return { id, status: 'cancelled' };
  }

  // ---------------- Staff attendance ----------------

  async location(): Promise<SchoolLocation | null> {
    const r = await this.db.selectFrom('settings').select('value').where('setting_group', '=', 'attendance').where('setting_key', '=', 'location').executeTakeFirst();
    return readJson<SchoolLocation>(r?.value);
  }

  async setLocation(u: RequestUser, loc: SchoolLocation, meta: Meta) {
    await this.db.insertInto('settings').values({ setting_group: 'attendance', setting_key: 'location', value: JSON.stringify(loc), updated_by: u.id })
      .onDuplicateKeyUpdate({ value: JSON.stringify(loc), updated_by: u.id }).execute();
    await this.audit.log(u, { module: 'attendance', action: 'set_location', after: loc, ...meta });
    return loc;
  }

  /** Agreed A6 to A8: check in on the phone, only on school premises; time kept, no Late rule. */
  async checkIn(u: RequestUser, pos: { lat: number; lng: number; accuracy: number }, meta: Meta) {
    const staff = await this.staffOf(u);
    const loc = await this.location();
    if (!loc) throw Errors.badRequest('LOCATION_NOT_SET', 'The school location for check-in is not set. Ask the admin to set it in School settings.');
    const year = await currentYear(this.db);
    const today = await schoolToday(this.db);
    const cal = await SchoolCalendar.load(this.db, year.id);
    if (!cal.isWorking(today)) throw Errors.badRequest('NOT_A_WORKING_DAY', `Today is not a working day (${cal.offReason(today)}).`);
    if (pos.accuracy > 500) throw Errors.badRequest('LOCATION_IMPRECISE', 'Your phone location is not precise enough. Turn on location (GPS), step outside or near a window, and try again.');
    const distance = distanceM(loc, pos);
    if (distance > loc.radiusM + Math.min(pos.accuracy, 50)) {
      throw Errors.badRequest('OFF_PREMISES', `You appear to be ${distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${distance} m`} from school. Check in when you are on the school premises.`);
    }
    const d = new Date(`${today}T00:00:00Z`);
    const existing = await this.db.selectFrom('staff_attendance').select(['status', 'check_in_at', 'source']).where('staff_id', '=', staff.id).where('att_date', '=', d).executeTakeFirst();
    if (existing?.check_in_at) return { date: today, status: existing.status, checkInAt: existing.check_in_at, already: true };
    await this.db.insertInto('staff_attendance').values({ staff_id: staff.id, att_date: d, status: 'present', source: 'self', check_in_at: new Date(), distance_m: distance, accuracy_m: Math.round(pos.accuracy), updated_by: u.id })
      .onDuplicateKeyUpdate({ status: 'present', source: 'self', check_in_at: new Date(), distance_m: distance, accuracy_m: Math.round(pos.accuracy), updated_by: u.id }).execute();
    await this.audit.log(u, { module: 'attendance', action: 'staff_check_in', entityType: 'staff', entityId: staff.id, after: { distance, accuracy: pos.accuracy }, ...meta });
    return { date: today, status: 'present', checkInAt: new Date(), already: false, distance };
  }

  async mine(u: RequestUser, month?: string) {
    const staff = await this.staffOf(u);
    const year = await currentYear(this.db);
    const today = await schoolToday(this.db);
    const cal = await SchoolCalendar.load(this.db, year.id);
    const m = month ?? today.slice(0, 7);
    const rows = await this.db.selectFrom('staff_attendance').select(['att_date', 'status', 'check_in_at']).where('staff_id', '=', staff.id)
      .where('att_date', '>=', new Date(`${m}-01T00:00:00Z`)).where('att_date', '<=', new Date(`${monthEnd(m)}T00:00:00Z`)).execute();
    const byDate = new Map(rows.map((r) => [iso(r.att_date), r]));
    const todayRow = byDate.get(today) ?? (await this.db.selectFrom('staff_attendance').select(['att_date', 'status', 'check_in_at']).where('staff_id', '=', staff.id).where('att_date', '=', new Date(`${today}T00:00:00Z`)).executeTakeFirst());
    return {
      today, workingToday: cal.isWorking(today), offReason: cal.offReason(today), locationSet: !!(await this.location()),
      todayStatus: todayRow ? { status: todayRow.status, checkInAt: todayRow.check_in_at } : null,
      month: m, days: eachDay(`${m}-01`, monthEnd(m)).map((d) => ({ date: d, working: cal.isWorking(d), off: cal.offReason(d), status: byDate.get(d)?.status ?? null, checkInAt: byDate.get(d)?.check_in_at ?? null, future: d > today })),
    };
  }

  /** Admin view of all staff for a day. */
  async day(date?: string) {
    const year = await currentYear(this.db);
    const day = date ?? (await schoolToday(this.db));
    const cal = await SchoolCalendar.load(this.db, year.id);
    const rows = await this.db.selectFrom('staff as s').innerJoin('users as u', 'u.id', 's.user_id')
      .leftJoin('staff_attendance as a', (j) => j.onRef('a.staff_id', '=', 's.id').on('a.att_date', '=', new Date(`${day}T00:00:00Z`)))
      .select(['s.public_id', 'u.name', 's.designation', 'a.status', 'a.source', 'a.check_in_at', 'a.distance_m'])
      .where('s.status', '=', 'active').where('s.deleted_at', 'is', null).where('u.status', '=', 'active').orderBy('u.name').execute();
    return { date: day, working: cal.isWorking(day), offReason: cal.offReason(day), staff: rows.map((r) => ({ id: r.public_id, name: r.name, designation: r.designation, status: r.status, source: r.source, checkInAt: r.check_in_at, distanceM: r.distance_m })) };
  }

  async correct(u: RequestUser, date: string, entries: Array<{ staffId: string; status: 'present' | 'absent' | 'half_day' | 'leave' | null }>, meta: Meta) {
    const today = await schoolToday(this.db);
    if (date > today) throw Errors.badRequest('FUTURE_DATE', 'Cannot set attendance for a future date.');
    const ids = new Map((await this.db.selectFrom('staff').select(['id', 'public_id']).execute()).map((s) => [s.public_id, s.id]));
    await this.db.transaction().execute(async (trx) => {
      for (const e of entries) {
        const sid = ids.get(e.staffId);
        if (!sid) throw Errors.notFound('Staff member');
        const d = new Date(`${date}T00:00:00Z`);
        if (e.status === null) await trx.deleteFrom('staff_attendance').where('staff_id', '=', sid).where('att_date', '=', d).execute();
        else await trx.insertInto('staff_attendance').values({ staff_id: sid, att_date: d, status: e.status, source: 'admin', updated_by: u.id })
          .onDuplicateKeyUpdate({ status: e.status, source: 'admin', updated_by: u.id }).execute();
      }
      await this.audit.log(u, { module: 'attendance', action: 'staff_correct', after: { date, entries }, ...meta }, trx);
    });
    return this.day(date);
  }
}
