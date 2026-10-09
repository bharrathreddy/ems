import type { Database } from '../database/database.module';
import { readJson } from '../common/json';

/** "Today" in the school's time zone (default Asia/Kolkata), as YYYY-MM-DD. */
export async function schoolToday(db: Database) {
  const s = await db.selectFrom('institution_settings').select('timezone').where('id', '=', 1).executeTakeFirst();
  return new Intl.DateTimeFormat('en-CA', { timeZone: s?.timezone || 'Asia/Kolkata' }).format(new Date());
}
export const iso = (d: Date | string | null | undefined) => (d ? (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)) : null);
export const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export function eachDay(from: string, to: string) { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }

/**
 * Working days for a year: Monday to Saturday, minus holidays and the "Saturdays off" setting
 * (for example the 2nd Saturday of each month). Sundays are never working days.
 */
export class SchoolCalendar {
  constructor(public readonly start: string, public readonly end: string, private holidays: Map<string, string>, private saturdaysOff: number[]) {}

  static async load(db: Database, yearId: number) {
    const [y, hols, sat] = await Promise.all([
      db.selectFrom('academic_years').select(['start_date', 'end_date']).where('id', '=', yearId).executeTakeFirstOrThrow(),
      db.selectFrom('holidays').select(['name', 'start_date', 'end_date']).where('academic_year_id', '=', yearId).execute(),
      db.selectFrom('settings').select('value').where('setting_group', '=', 'calendar').where('setting_key', '=', 'saturdays_off').executeTakeFirst(),
    ]);
    const map = new Map<string, string>();
    for (const h of hols) for (const d of eachDay(iso(h.start_date)!, iso(h.end_date)!)) map.set(d, h.name);
    return new SchoolCalendar(iso(y.start_date)!, iso(y.end_date)!, map, readJson<number[]>(sat?.value) ?? []);
  }

  /** Why a date is not a working day, or null when it is one. */
  offReason(d: string): string | null {
    if (d < this.start || d > this.end) return 'Outside the academic year';
    const dt = new Date(`${d}T00:00:00Z`);
    const dow = dt.getUTCDay();
    if (dow === 0) return 'Sunday';
    if (this.holidays.has(d)) return this.holidays.get(d)!;
    if (dow === 6) {
      const nth = Math.ceil(dt.getUTCDate() / 7);
      if (this.saturdaysOff.includes(nth)) return `${['', '1st', '2nd', '3rd', '4th', '5th'][nth]} Saturday holiday`;
    }
    return null;
  }
  isWorking(d: string) { return this.offReason(d) === null; }
  workingDays(from: string, to: string) { return eachDay(from < this.start ? this.start : from, to > this.end ? this.end : to).filter((d) => this.isWorking(d)); }
}

export type AttStatus = 'present' | 'absent' | 'late' | 'half_day' | 'leave';
/** Agreed A10: Late = present, Half day = half a day, Leave and Absent = not present. */
export const PRESENT_VALUE: Record<AttStatus, number> = { present: 1, late: 1, half_day: 0.5, absent: 0, leave: 0 };

/** Percentage = present days / marked working days x 100 (holidays excluded; unmarked days left out). */
export function summarise(rows: Array<{ date: string; status: AttStatus }>, cal: SchoolCalendar) {
  const counted = rows.filter((r) => cal.isWorking(r.date));
  const present = counted.reduce((t, r) => t + PRESENT_VALUE[r.status], 0);
  const counts = { present: 0, absent: 0, late: 0, half_day: 0, leave: 0 } as Record<AttStatus, number>;
  for (const r of counted) counts[r.status]++;
  return { workingDays: counted.length, presentDays: present, percentage: counted.length ? Math.round((present / counted.length) * 1000) / 10 : null, counts };
}
