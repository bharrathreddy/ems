import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CloudOff, MoreHorizontal, Lock } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError } from '../lib/api';
import { cacheRoster, cachedRoster, enqueue, isOffline, queued } from '../lib/offline';
import { ATT_CLASS, ATT_LABEL, dayLabel, todayLocal, type AttStatus } from '../lib/attendance';
import { ErrorState, Sheet, Skeleton } from '../components/ui';

interface Day { date: string; section: { id: number; name: string }; marked: boolean; markedBy: string | null; editable: boolean; lockReason: string | null;
  students: Array<{ id: string; name: string; admissionNo: string; rollNo: string | null; status: AttStatus | null; onLeave: boolean }> }

export default function MarkAttendancePage() {
  const { id } = useParams();
  const sectionId = Number(id);
  const [params] = useSearchParams();
  const date = params.get('date') ?? todayLocal();
  const qc = useQueryClient();
  const q = useQuery({
    networkMode: 'always', // offline: fall back to the class list saved on this phone
    queryKey: ['att-section', sectionId, date],
    queryFn: async () => {
      // A sheet saved on this phone and not yet sent is newer than anything else: show it.
      const withPending = (d: Day) => {
        const p = queued().find((x) => x.sectionId === sectionId && x.date === date);
        if (!p) return { ...d, pending: false };
        const st = new Map(p.entries.map((e) => [e.studentId, e.status as AttStatus]));
        return { ...d, pending: true, students: d.students.map((s) => (st.has(s.id) ? { ...s, status: st.get(s.id)! } : s)) };
      };
      try { const d = (await api<Day>(`/attendance/sections/${sectionId}`, { query: { date } })).data; cacheRoster(sectionId, date, d); return { ...withPending(d), fromCache: false }; }
      catch (e) { const c = cachedRoster<Day>(sectionId, date); if (c && isOffline(e)) return { ...withPending(c), fromCache: true }; throw e; }
    },
  });
  const [marks, setMarks] = useState<Record<string, AttStatus>>({});
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => {
    // Agreed: everyone starts Present; approved leave and earlier marks are kept.
    if (q.data) setMarks(Object.fromEntries(q.data.students.map((s) => [s.id, s.status ?? 'present'])));
  }, [q.data]);
  const counts = useMemo(() => Object.values(marks).reduce((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {} as Record<string, number>), [marks]);
  const save = useMutation({
    networkMode: 'always', // offline: keep the sheet on the phone instead of waiting
    mutationFn: async () => {
      const entries = Object.entries(marks).map(([studentId, status]) => ({ studentId, status }));
      try { return { online: true, r: await api<{ changed: number; alerted: number }>(`/attendance/sections/${sectionId}`, { method: 'PUT', body: { date, entries } }) }; }
      catch (e) {
        if (!isOffline(e)) throw e;
        enqueue({ sectionId, sectionName: q.data!.section.name, date, entries, savedAt: new Date().toISOString() });
        return { online: false, r: null };
      }
    },
    onSuccess: ({ online, r }) => {
      if (!online) { toast.info('No connection. Saved on this phone; it will be sent automatically when you are back online.', { duration: 8000 }); return; }
      toast.success(`Attendance saved${r!.data.alerted ? ` · ${r!.data.alerted} famil${r!.data.alerted > 1 ? 'ies' : 'y'} alerted` : ''}`);
      qc.invalidateQueries({ queryKey: ['att-overview'] }); qc.invalidateQueries({ queryKey: ['att-section', sectionId, date] });
    },
    onError: (e) => toast.error((e as ApiError).message),
  });
  if (q.isLoading) return <Skeleton rows={8} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const toggle = (sid: string) => d.editable && setMarks((m) => ({ ...m, [sid]: m[sid] === 'absent' ? 'present' : 'absent' }));
  return (
    <div className="pb-32">
      <Link to={`/attendance?date=${date}`} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink"><ArrowLeft size={16} aria-hidden />Attendance</Link>
      <h1 className="text-2xl font-semibold">{d.section.name}</h1>
      <p className="text-ink-muted">{dayLabel(date)}{d.marked ? ` · marked by ${d.markedBy}` : ' · not marked yet'}</p>
      {d.pending && <p className="mt-2 flex items-center gap-2 rounded-lg bg-tangedu-soft px-3 py-2 text-sm text-[#7A5A00]"><CloudOff size={16} aria-hidden />Saved on this phone, waiting for a connection. Changes you save now replace it.</p>}
      {d.fromCache && <p className="mt-2 flex items-center gap-2 rounded-lg bg-tangedu-soft px-3 py-2 text-sm text-[#7A5A00]"><CloudOff size={16} aria-hidden />Offline: showing the class list saved on this phone.</p>}
      {!d.editable && <p className="mt-2 flex items-center gap-2 rounded-lg bg-chalk px-3 py-2 text-sm text-ink-muted"><Lock size={16} aria-hidden />{d.lockReason}</p>}
      {d.editable && <p className="mt-3 text-sm text-ink-muted">Everyone is Present. Tap a student to mark Absent; use ⋯ for Late, Half day or Leave.</p>}
      <ul className="mt-3 space-y-1.5">
        {d.students.map((s) => {
          const st = marks[s.id] ?? 'present';
          return (
            <li key={s.id} className="flex items-stretch gap-1.5">
              <button onClick={() => toggle(s.id)} disabled={!d.editable} aria-pressed={st === 'absent'}
                className={clsx('flex min-h-14 flex-1 items-center gap-3 rounded-xl border px-3 text-left transition-colors', st === 'absent' ? 'border-danger/40 bg-danger-soft' : 'border-line bg-surface', d.editable && 'active:scale-[0.99]')}>
                <span className="w-7 text-sm tabular-nums text-ink-muted">{s.rollNo ?? '-'}</span>
                <span className="flex-1 font-medium">{s.name}</span>
                <span className={clsx('rounded-md px-2 py-1 text-xs font-bold', ATT_CLASS[st])}>{ATT_LABEL[st]}</span>
              </button>
              {d.editable && <button aria-label={`More options for ${s.name}`} onClick={() => setMenu(s.id)} className="grid w-11 place-items-center rounded-xl border border-line bg-surface text-ink-muted"><MoreHorizontal size={18} /></button>}
            </li>
          );
        })}
      </ul>
      {d.editable && (
        <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 p-3 backdrop-blur lg:bottom-0 lg:left-[264px]">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <p className="flex-1 text-sm"><strong className="text-brand">{(counts.present ?? 0) + (counts.late ?? 0)}</strong> present{counts.absent ? <> · <strong className="text-danger">{counts.absent}</strong> absent</> : ''}{counts.late ? ` · ${counts.late} late` : ''}{counts.half_day ? ` · ${counts.half_day} half day` : ''}{counts.leave ? ` · ${counts.leave} leave` : ''}</p>
            <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : d.marked ? 'Save changes' : 'Save attendance'}</button>
          </div>
        </div>
      )}
      <Sheet open={!!menu} onClose={() => setMenu(null)} title={d.students.find((s) => s.id === menu)?.name ?? ''}>
        <div className="grid gap-2">
          {(['present', 'absent', 'late', 'half_day', 'leave'] as AttStatus[]).map((st) => (
            <button key={st} onClick={() => { setMarks((m) => ({ ...m, [menu!]: st })); setMenu(null); }}
              className={clsx('flex min-h-12 items-center justify-between rounded-xl border px-4 font-semibold', marks[menu ?? ''] === st ? 'border-brand bg-brand-soft text-brand' : 'border-line')}>{ATT_LABEL[st]}</button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
