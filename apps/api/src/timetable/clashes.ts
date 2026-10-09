import type { Database } from '../database/database.module';

export interface Clash { teacher: string; day: number; a: string; b: string }
const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const describeClash = (c: Clash) => `${c.teacher} would be in two places on ${DAYS[c.day]}: ${c.a} and ${c.b}.`;

/**
 * A teacher may not teach two slots whose CLOCK TIMES overlap on the same day (rule T4).
 * Comparing times, not period numbers, matters because class groups have different bell schedules.
 * The teacher of a slot always comes from the teaching grid (section + subject).
 */
export async function findClashes(trx: Database, yearId: number, staffIds?: number[]): Promise<Clash[]> {
  if (staffIds && !staffIds.length) return [];
  let q = trx.selectFrom('timetable_slots as t')
    .innerJoin('bell_periods as p', 'p.id', 't.bell_period_id')
    .innerJoin('teacher_assignments as ta', (j) => j.onRef('ta.section_id', '=', 't.section_id').onRef('ta.subject_id', '=', 't.subject_id').onRef('ta.academic_year_id', '=', 't.academic_year_id'))
    .innerJoin('staff as st', 'st.id', 'ta.staff_id').innerJoin('users as u', 'u.id', 'st.user_id')
    .innerJoin('sections as sec', 'sec.id', 't.section_id').innerJoin('classes as c', 'c.id', 'sec.class_id')
    .innerJoin('subjects as sub', 'sub.id', 't.subject_id')
    .select(['t.id', 'ta.staff_id', 'u.name as teacher', 't.day_of_week', 'p.start_time', 'p.end_time', 'c.name as class_name', 'sec.name as section', 'sub.name as subject'])
    .where('t.academic_year_id', '=', yearId);
  if (staffIds) q = q.where('ta.staff_id', 'in', staffIds);
  const rows = await q.orderBy('ta.staff_id').orderBy('t.day_of_week').orderBy('p.start_time').execute();
  const clashes: Clash[] = [];
  const hhmm = (t: string) => t.slice(0, 5);
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (a.staff_id !== b.staff_id || a.day_of_week !== b.day_of_week) break;
      if (b.start_time < a.end_time && a.start_time < b.end_time) {
        clashes.push({ teacher: a.teacher, day: a.day_of_week,
          a: `${a.class_name} ${a.section} ${a.subject} ${hhmm(a.start_time)}-${hhmm(a.end_time)}`,
          b: `${b.class_name} ${b.section} ${b.subject} ${hhmm(b.start_time)}-${hhmm(b.end_time)}` });
      }
    }
  }
  return clashes;
}
