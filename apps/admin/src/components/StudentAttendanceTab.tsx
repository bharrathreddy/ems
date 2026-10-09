import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ATT_CLASS, ATT_LABEL, ATT_SHORT, todayLocal, type AttStatus, type Summary } from '../lib/attendance';
import { Badge, ErrorState, Sheet, Skeleton } from './ui';
import { LeaveForm, range, STATUS_TONE } from '../pages/LeavePage';

interface Data { month: string; today: string; yearName: string; yearStart: string; yearEnd: string;
  days: Array<{ date: string; working: boolean; off: string | null; status: AttStatus | null; future: boolean }>;
  monthSummary: Summary; yearSummary: Summary; leaves: Array<{ id: number; start_date: string; end_date: string; reason: string; status: string; decision_note: string | null }> }

const shift = (m: string, n: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };

function Pct({ label, s }: { label: string; s: Summary }) {
  return (
    <div className="rounded-xl bg-chalk p-4">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={clsx('text-3xl font-bold tabular-nums', s.percentage != null && s.percentage < 75 ? 'text-danger' : 'text-ink')}>{s.percentage != null ? `${s.percentage}%` : '-'}</p>
      <p className="text-sm text-ink-muted">{s.presentDays} of {s.workingDays} days{s.counts.absent ? ` · ${s.counts.absent} absent` : ''}{s.counts.leave ? ` · ${s.counts.leave} leave` : ''}</p>
    </div>
  );
}

export default function StudentAttendanceTab({ studentId }: { studentId: string }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [apply, setApply] = useState(false);
  const q = useQuery({ queryKey: ['student-att', studentId, month], queryFn: () => api<Data>(`/students/${studentId}/attendance`, { query: { month } }).then((r) => r.data) });
  if (q.isLoading) return <Skeleton rows={5} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const d = q.data!;
  const family = me?.workspace !== 'staff';
  const lead = (new Date(`${d.days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday first
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><Pct label="This month" s={d.monthSummary} /><Pct label={`${d.yearName} so far`} s={d.yearSummary} /></div>
      <section className="panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <button aria-label="Previous month" className="p-2" disabled={`${month}-01` <= d.yearStart} onClick={() => setMonth(shift(month, -1))}><ChevronLeft size={18} /></button>
          <h2 className="font-semibold">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h2>
          <button aria-label="Next month" className="p-2" disabled={month >= d.today.slice(0, 7)} onClick={() => setMonth(shift(month, 1))}><ChevronRight size={18} /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => <span key={w} className="py-1 font-semibold text-ink-muted">{w}</span>)}
          {Array.from({ length: lead }).map((_, i) => <span key={`x${i}`} />)}
          {d.days.map((x) => (
            <span key={x.date} title={x.off ?? (x.status ? ATT_LABEL[x.status] : x.future ? '' : 'Not marked')}
              className={clsx('flex aspect-square flex-col items-center justify-center rounded-lg', x.status ? ATT_CLASS[x.status] : !x.working ? 'text-ink-muted/40' : 'bg-surface ring-1 ring-line')}>
              <span className="text-[13px] font-semibold">{Number(x.date.slice(8))}</span>
              {x.status && <span className="text-[10px] font-bold">{ATT_SHORT[x.status]}</span>}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-muted">P present · A absent · L late · H half day · LV leave. Grey days are holidays; empty boxes were not marked.</p>
      </section>
      <section className="panel p-4">
        <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Leave</h2>{family && <button className="btn-primary min-h-9 text-sm" onClick={() => setApply(true)}>Apply for leave</button>}</div>
        {!d.leaves.length ? <p className="text-sm text-ink-muted">No leave requests.</p> : (
          <ul className="divide-y divide-line">{d.leaves.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-2 py-2"><span className="text-sm"><span className="font-semibold">{range({ startDate: l.start_date, endDate: l.end_date })}</span> · {l.reason}{l.decision_note ? <span className="block text-ink-muted">{l.decision_note}</span> : null}</span>
              <Badge tone={STATUS_TONE[l.status]}>{l.status === 'pending' ? 'Waiting' : l.status === 'rejected' ? 'Not approved' : l.status[0].toUpperCase() + l.status.slice(1)}</Badge></li>))}</ul>
        )}
      </section>
      <Sheet open={apply} onClose={() => setApply(false)} title="Apply for leave">
        <p className="mb-3 text-sm text-ink-muted">The class teacher will review it. You can also apply after an absence (up to 30 days back).</p>
        <LeaveForm path={`/students/${studentId}/leave-requests`} allowPast onDone={() => { setApply(false); qc.invalidateQueries({ queryKey: ['student-att', studentId] }); }} />
      </Sheet>
    </div>
  );
}
