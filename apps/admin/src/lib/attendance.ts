export type AttStatus = 'present' | 'absent' | 'late' | 'half_day' | 'leave';
export const ATT_LABEL: Record<AttStatus, string> = { present: 'Present', absent: 'Absent', late: 'Late', half_day: 'Half day', leave: 'Leave' };
export const ATT_SHORT: Record<AttStatus, string> = { present: 'P', absent: 'A', late: 'L', half_day: 'H', leave: 'LV' };
export const ATT_CLASS: Record<AttStatus, string> = {
  present: 'bg-brand-soft text-brand', absent: 'bg-danger-soft text-danger', late: 'bg-tangedu-soft text-[#7A5A00]', half_day: 'bg-tangedu-soft text-[#7A5A00]', leave: 'bg-chalk text-ink-muted',
};
export const todayLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
export const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
export interface Summary { workingDays: number; presentDays: number; percentage: number | null; counts: Record<AttStatus, number> }
