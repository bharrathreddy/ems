import type { Database } from '../database/database.module';
import { iso, SchoolCalendar } from '../attendance/calendar';

export interface LeaveBalance { id: number; code: string; name: string; isPaid: boolean; allowed: number | null; used: number; pending: number; left: number | null }

/**
 * Leave balance per type for one staff member in one academic year.
 * Used = approved working days; pending requests are shown separately but also held back,
 * so two requests cannot together go over the allowance.
 */
export async function leaveBalances(db: Database, staffId: number, yearId: number): Promise<LeaveBalance[]> {
  const [types, reqs, cal] = await Promise.all([
    db.selectFrom('leave_types').selectAll().where('is_active', '=', 1).orderBy('sort_order').orderBy('id').execute(),
    db.selectFrom('leave_requests').select(['leave_type_id', 'start_date', 'end_date', 'status'])
      .where('kind', '=', 'staff').where('staff_id', '=', staffId).where('status', 'in', ['approved', 'pending']).where('leave_type_id', 'is not', null).execute(),
    SchoolCalendar.load(db, yearId),
  ]);
  return types.map((t) => {
    let used = 0, pending = 0;
    for (const r of reqs.filter((x) => x.leave_type_id === t.id)) {
      const n = cal.workingDays(iso(r.start_date)!, iso(r.end_date)!).length;
      if (r.status === 'approved') used += n; else pending += n;
    }
    const allowed = t.days_per_year == null ? null : Number(t.days_per_year);
    return { id: t.id, code: t.code, name: t.name, isPaid: !!t.is_paid, allowed, used, pending, left: allowed == null ? null : Math.max(0, allowed - used - pending) };
  });
}
