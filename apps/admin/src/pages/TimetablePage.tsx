import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, X } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useClasses } from '../lib/academics';
import { EmptyState, ErrorState, PageHeader, Sheet, Skeleton } from '../components/ui';
import TimetableGrid, { DAY, DAY_LONG, saturdayNote, type Period, type SectionTT, type Slot } from '../components/TimetableGrid';

interface Lesson { day: number; period: string; start: string; end: string; className: string; section: string; subject: string }

function MyWeek() {
  const q = useQuery({ queryKey: ['timetable', 'mine'], queryFn: () => api<{ year: { name: string }; lessons: Lesson[]; saturdaysOff: number[] }>('/timetable/mine').then((r) => r.data) });
  const [day, setDay] = useState(() => { const d = new Date().getDay(); return d >= 1 && d <= 6 ? d : 1; });
  if (q.isLoading) return <Skeleton rows={4} />;
  if (!q.data?.lessons.length) return <EmptyState title="No lessons yet" body="Your lessons appear here once the timetable is set up." />;
  const ofDay = (d: number) => q.data!.lessons.filter((l) => l.day === d);
  return (
    <div>
      <div className="mb-3 grid grid-cols-6 gap-1 rounded-lg bg-chalk p-1 md:hidden">
        {[1, 2, 3, 4, 5, 6].map((d) => <button key={d} aria-pressed={day === d} onClick={() => setDay(d)} className={clsx('rounded-md py-2 text-sm font-semibold', day === d ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted')}>{DAY[d]}</button>)}
      </div>
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        {[1, 2, 3, 4, 5, 6].map((d) => (
          <section key={d} className={clsx('panel p-3', d !== day && 'hidden md:block')}>
            <h3 className="mb-2 font-semibold">{DAY_LONG[d]}</h3>
            {ofDay(d).length === 0 ? <p className="text-sm text-ink-muted">Free</p> : (
              <ul className="space-y-1.5">{ofDay(d).map((l, i) => (
                <li key={i} className="rounded-lg bg-brand-soft px-2.5 py-2 text-sm"><span className="block text-xs text-ink-muted">{l.start}–{l.end}</span>
                  <span className="font-semibold">{l.className} {l.section}</span> · {l.subject}</li>
              ))}</ul>
            )}
          </section>
        ))}
      </div>
      {q.data.saturdaysOff.length > 0 && <p className="mt-3 text-sm text-ink-muted">{saturdayNote(q.data.saturdaysOff)}.</p>}
    </div>
  );
}

function SectionEditor({ sectionId, manage }: { sectionId: number; manage: boolean }) {
  const qc = useQueryClient();
  const key = ['timetable', 'section', sectionId];
  const q = useQuery({ queryKey: key, queryFn: () => api<SectionTT & { year: { editable: boolean } }>(`/timetable/sections/${sectionId}`).then((r) => r.data) });
  const [pick, setPick] = useState<{ day: number; p: Period; slot?: Slot } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const set = useMutation({
    mutationFn: (v: { day: number; periodId: number; subjectId: number | null }) => api<SectionTT>(`/timetable/sections/${sectionId}/slots`, { method: 'PUT', body: v }),
    onMutate: (v) => setBusy(`${v.day}:${v.periodId}`),
    onSuccess: ({ data }) => { qc.setQueryData(key, (old: any) => ({ ...old, ...data })); setPick(null); },
    onError: (e) => toast.error((e as ApiError).message, { duration: 8000 }),
    onSettled: () => setBusy(null),
  });
  const copy = useMutation({
    mutationFn: (fromDay: number) => api<SectionTT>(`/timetable/sections/${sectionId}/copy-day`, { method: 'POST', body: { fromDay, toDays: [1, 2, 3, 4, 5, 6].filter((d) => d !== fromDay) } }),
    onSuccess: ({ data }) => { qc.setQueryData(key, (old: any) => ({ ...old, ...data })); toast.success('Copied to all other days'); },
    onError: (e) => toast.error((e as ApiError).message, { duration: 8000 }),
  });
  if (q.isLoading) return <Skeleton rows={6} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const tt = q.data!;
  const editable = manage && tt.year.editable;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        <span>{tt.group ? `Bell schedule: ${tt.group.name}` : 'No bell schedule'}</span>
        {tt.section?.classTeacher && <span>· Class teacher: <strong className="text-ink">{tt.section.classTeacher}</strong></span>}
        {editable && tt.slots.length > 0 && (
          <button className="btn-quiet ml-auto min-h-9 text-sm" disabled={copy.isPending}
            onClick={() => { const from = tt.slots.reduce((a, s) => (tt.slots.filter((x) => x.day === s.day).length > tt.slots.filter((x) => x.day === a).length ? s.day : a), tt.slots[0].day);
              if (confirm(`Copy ${DAY_LONG[from]}'s timetable to all other days? Their current lessons will be replaced.`)) copy.mutate(from); }}>
            <Copy size={14} aria-hidden />Copy fullest day to all days</button>
        )}
      </div>
      {editable && tt.subjects.length === 0 && <p className="mb-3 rounded-lg bg-tangedu-soft px-3 py-2 text-sm text-[#7A5A00]">Choose this class's subjects in the <Link className="font-semibold underline" to="/teaching">Teaching grid</Link> first.</p>}
      <TimetableGrid tt={tt} busyKey={busy} onCell={editable ? (day, p, slot) => setPick({ day, p, slot }) : undefined} />
      <Sheet open={!!pick} onClose={() => setPick(null)} title={pick ? `${DAY_LONG[pick.day]} · ${pick.p.label} (${pick.p.start}–${pick.p.end})` : ''}>
        {pick && (
          <ul className="space-y-1.5">
            {tt.subjects.map((s) => (
              <li key={s.id}>
                <button onClick={() => set.mutate({ day: pick.day, periodId: pick.p.id, subjectId: s.id })} disabled={set.isPending}
                  className={clsx('flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left', pick.slot?.subjectId === s.id ? 'border-brand bg-brand-soft' : 'border-line hover:border-brand')}>
                  <span className="font-semibold">{s.name}</span><span className={clsx('text-sm', s.teacher ? 'text-ink-muted' : 'text-danger')}>{s.teacher ?? 'No teacher assigned'}</span>
                </button>
              </li>
            ))}
            {pick.slot && <li><button className="btn-danger mt-2 w-full" onClick={() => set.mutate({ day: pick.day, periodId: pick.p.id, subjectId: null })}><X size={16} aria-hidden />Clear this period</button></li>}
          </ul>
        )}
      </Sheet>
    </div>
  );
}

export default function TimetablePage() {
  const { can, me } = useAuth();
  const all = me?.permissions['timetable.view'] === 'all';
  const manage = can('timetable.manage');
  const classes = useClasses(all);
  const [tab, setTab] = useState<'mine' | 'sections'>(manage ? 'sections' : 'mine');
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const sections = classes.data?.find((c) => String(c.id) === classId)?.sections ?? [];
  useEffect(() => { if (sections.length === 1) setSectionId(String(sections[0].id)); }, [classId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <PageHeader title="Timetable" description={manage ? 'Tap a period to choose the subject. The teacher comes from the Teaching grid; clashes are blocked.' : undefined}
        action={manage ? <Link to="/timetable/setup" className="btn-quiet">Bell schedules</Link> : undefined} />
      {all && (
        <div className="mb-4 inline-flex rounded-lg border border-line bg-chalk p-0.5">
          {(['mine', 'sections'] as const).map((t) => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)} className={clsx('rounded-md px-4 py-2 text-sm font-semibold', tab === t ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted')}>{t === 'mine' ? 'My week' : 'Class timetables'}</button>)}
        </div>
      )}
      {tab === 'mine' || !all ? <MyWeek /> : (
        <>
          <div className="mb-4 grid max-w-md grid-cols-2 gap-2">
            <select className="field" aria-label="Class" value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }}>
              <option value="">Choose class</option>{classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="field" aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!classId}>
              <option value="">Section</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {sectionId ? <SectionEditor key={sectionId} sectionId={Number(sectionId)} manage={manage} /> : <EmptyState title="Choose a class and section" body="Its weekly timetable will appear here." />}
        </>
      )}
    </div>
  );
}
