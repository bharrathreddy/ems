import { useState } from 'react';
import clsx from 'clsx';

export interface Period { id: number; kind: 'period' | 'break' | 'lunch' | 'assembly'; label: string; start: string; end: string }
export interface Slot { day: number; periodId: number; subjectId: number; subject: string; teacher: string | null }
export interface SectionTT {
  section: { id: number; name: string; classId: number; className: string; classTeacher: string | null } | null;
  group: { id: number; name: string } | null; periods: Period[]; slots: Slot[];
  subjects: Array<{ id: number; name: string; teacher: string | null }>; saturdaysOff: number[];
}
export const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LONG = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ordinal = (n: number) => ['', '1st', '2nd', '3rd', '4th', '5th'][n];
export const saturdayNote = (weeks: number[]) => (weeks.length ? `${weeks.map(ordinal).join(' & ')} Saturday${weeks.length > 1 ? 's' : ''} off` : '');
const today = () => { const d = new Date().getDay(); return d >= 1 && d <= 6 ? d : 1; };

/** Weekly grid on wide screens, one day at a time on phones. */
export default function TimetableGrid({ tt, onCell, busyKey }: { tt: SectionTT; onCell?: (day: number, p: Period, slot?: Slot) => void; busyKey?: string | null }) {
  const [day, setDay] = useState(today());
  const slotAt = (d: number, p: number) => tt.slots.find((s) => s.day === d && s.periodId === p);
  const cell = (d: number, p: Period) => {
    const s = slotAt(d, p.id);
    const busy = busyKey === `${d}:${p.id}`;
    const content = s ? (
      <><span className="block font-semibold leading-tight">{s.subject}</span><span className={clsx('block text-xs', s.teacher ? 'text-ink-muted' : 'font-semibold text-danger')}>{s.teacher ?? 'No teacher assigned'}</span></>
    ) : onCell ? <span className="text-xs text-ink-muted">+ Add</span> : <span className="text-xs text-ink-muted">-</span>;
    return onCell
      ? <button onClick={() => onCell(d, p, s)} disabled={busy} className={clsx('h-full min-h-14 w-full rounded-lg border px-2 py-1.5 text-left text-sm transition-colors', s ? 'border-transparent bg-brand-soft hover:ring-2 hover:ring-brand/30' : 'border-dashed border-line hover:border-brand', busy && 'opacity-50')}>{content}</button>
      : <div className={clsx('min-h-14 rounded-lg px-2 py-1.5 text-sm', s ? 'bg-brand-soft' : 'bg-chalk')}>{content}</div>;
  };
  if (!tt.periods.length) return <p className="panel p-5 text-ink-muted">This class has no bell schedule yet. Set one up in Timetable setup.</p>;
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full table-fixed border-separate border-spacing-1 text-left">
          <thead><tr><th className="w-28 text-xs font-medium text-ink-muted" />{[1, 2, 3, 4, 5, 6].map((d) => <th key={d} className="text-sm font-semibold">{DAY[d]}</th>)}</tr></thead>
          <tbody>
            {tt.periods.map((p) => p.kind !== 'period' ? (
              <tr key={p.id}><td className="text-xs text-ink-muted">{p.start}–{p.end}</td><td colSpan={6} className="rounded-lg bg-chalk py-1 text-center text-xs font-semibold uppercase tracking-wide text-ink-muted">{p.label}</td></tr>
            ) : (
              <tr key={p.id}><td className="align-top text-xs"><span className="block font-semibold">{p.label}</span><span className="text-ink-muted">{p.start}–{p.end}</span></td>
                {[1, 2, 3, 4, 5, 6].map((d) => <td key={d} className="align-top">{cell(d, p)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="md:hidden">
        <div className="mb-3 grid grid-cols-6 gap-1 rounded-lg bg-chalk p-1" role="tablist">
          {[1, 2, 3, 4, 5, 6].map((d) => <button key={d} role="tab" aria-selected={day === d} onClick={() => setDay(d)} className={clsx('rounded-md py-2 text-sm font-semibold', day === d ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted')}>{DAY[d]}</button>)}
        </div>
        <ul className="space-y-1.5">
          {tt.periods.map((p) => (
            <li key={p.id} className="grid grid-cols-[72px_1fr] items-stretch gap-2">
              <span className="pt-1.5 text-xs"><span className="block font-semibold">{p.kind === 'period' ? p.label : ''}</span><span className="text-ink-muted">{p.start}–{p.end}</span></span>
              {p.kind === 'period' ? cell(day, p) : <div className="rounded-lg bg-chalk py-2 text-center text-xs font-semibold uppercase tracking-wide text-ink-muted">{p.label}</div>}
            </li>
          ))}
        </ul>
      </div>
      {tt.saturdaysOff.length > 0 && <p className="mt-3 text-sm text-ink-muted">{saturdayNote(tt.saturdaysOff)}.</p>}
    </>
  );
}
