import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorState, PageHeader, Skeleton } from '../components/ui';

interface P { id?: number; kind: 'period' | 'break' | 'lunch' | 'assembly'; label: string; start: string; end: string; slotsUsing?: number }
interface Setup {
  year: { id: number; name: string; editable: boolean }; saturdaysOff: number[];
  classes: Array<{ id: number; name: string; groupId: number | null }>;
  groups: Array<{ id: number; name: string; classIds: number[]; periods: P[] }>;
}
const KIND: Record<P['kind'], string> = { period: 'Period', break: 'Break', lunch: 'Lunch', assembly: 'Assembly' };
const addMinutes = (t: string, m: number) => { const [h, mm] = t.split(':').map(Number); const x = h * 60 + mm + m; return `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

/** Run a request that may need confirmation (the API answers *_IN_USE first, then accepts force). */
async function withConfirm<T>(run: (force: boolean) => Promise<T>) {
  try { return await run(false); } catch (e) {
    const err = e as ApiError;
    if (/_IN_USE$|CLASSES_HAVE_TIMETABLE/.test(err.code) && confirm(err.message)) return run(true);
    throw e;
  }
}

function GroupCard({ g, s, edit, refresh }: { g: Setup['groups'][number]; s: Setup; edit: boolean; refresh: () => void }) {
  const [rows, setRows] = useState<P[]>(g.periods);
  const [name, setName] = useState(g.name);
  useEffect(() => { setRows(g.periods); setName(g.name); }, [g]);
  const dirty = JSON.stringify(rows.map(({ slotsUsing, ...r }) => r)) !== JSON.stringify(g.periods.map(({ slotsUsing, ...r }) => r));
  const savePeriods = useMutation({
    mutationFn: () => withConfirm((force) => api(`/timetable/groups/${g.id}/periods`, { method: 'PUT', body: { force, periods: rows.map(({ slotsUsing, ...r }) => r) } })),
    onSuccess: () => { toast.success(`${g.name}: timings saved`); refresh(); },
    onError: (e) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message, { duration: 8000 }),
  });
  const toggleClass = useMutation({
    mutationFn: (classIds: number[]) => withConfirm((force) => api(`/timetable/groups/${g.id}/classes`, { method: 'PUT', body: { classIds, force } })),
    onSuccess: refresh, onError: (e) => toast.error((e as ApiError).message),
  });
  const rename = useMutation({ mutationFn: () => api(`/timetable/groups/${g.id}`, { method: 'PATCH', body: { name } }), onSuccess: refresh, onError: (e) => toast.error((e as ApiError).message) });
  const remove = useMutation({
    mutationFn: () => withConfirm((force) => api(`/timetable/groups/${g.id}${force ? '?force=1' : ''}`, { method: 'DELETE' })),
    onSuccess: () => { toast.success('Schedule deleted'); refresh(); }, onError: (e) => toast.error((e as ApiError).message),
  });
  const upd = (i: number, patch: Partial<P>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = (kind: P['kind']) => {
    const last = rows[rows.length - 1];
    const start = last ? last.end : '09:00';
    const n = rows.filter((r) => r.kind === 'period').length + 1;
    setRows([...rows, { kind, label: kind === 'period' ? `P${n}` : KIND[kind], start, end: addMinutes(start, kind === 'period' ? 40 : kind === 'lunch' ? 30 : 10) }]);
  };
  return (
    <section className="panel p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="field max-w-xs py-2 font-semibold" aria-label="Schedule name" value={name} disabled={!edit} onChange={(e) => setName(e.target.value)} onBlur={() => name !== g.name && name.trim().length >= 2 && rename.mutate()} />
        {edit && <button className="ml-auto p-2 text-ink-muted hover:text-danger" aria-label={`Delete ${g.name}`} onClick={() => confirm(`Delete the ${g.name} schedule?`) && remove.mutate()}><Trash2 size={18} /></button>}
      </div>
      <p className="label">Classes on this schedule</p>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {s.classes.map((c) => {
          const mine = g.classIds.includes(c.id);
          const other = !mine && c.groupId ? s.groups.find((x) => x.id === c.groupId)?.name : null;
          return (
            <button key={c.id} disabled={!edit || toggleClass.isPending} aria-pressed={mine} title={other ? `Now on ${other}` : undefined}
              onClick={() => toggleClass.mutate(mine ? g.classIds.filter((x) => x !== c.id) : [...g.classIds, c.id])}
              className={clsx('rounded-lg border px-2.5 py-1.5 text-sm font-medium', mine ? 'border-brand bg-brand-soft text-brand' : other ? 'border-line text-ink-muted/60 line-through decoration-1' : 'border-line bg-surface')}>{c.name}</button>
          );
        })}
      </div>
      <p className="label">Periods and breaks (same timings Monday to Saturday)</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className={clsx('grid grid-cols-[96px_1fr_92px_92px_32px] items-center gap-2 rounded-lg p-1', r.kind !== 'period' && 'bg-chalk')}>
            <select className="field px-2 py-1.5 text-sm" aria-label="Type" disabled={!edit} value={r.kind} onChange={(e) => upd(i, { kind: e.target.value as P['kind'] })}>
              {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input className="field px-2 py-1.5 text-sm" aria-label="Label" disabled={!edit} value={r.label} onChange={(e) => upd(i, { label: e.target.value })} />
            <input type="time" className="field px-2 py-1.5 text-sm" aria-label={`${r.label} start`} disabled={!edit} value={r.start} onChange={(e) => upd(i, { start: e.target.value })} />
            <input type="time" className="field px-2 py-1.5 text-sm" aria-label={`${r.label} end`} disabled={!edit} value={r.end} onChange={(e) => upd(i, { end: e.target.value })} />
            {edit ? <button aria-label={`Remove ${r.label}`} className="text-ink-muted hover:text-danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={16} /></button> : <span />}
          </div>
        ))}
      </div>
      {edit && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-quiet min-h-9 text-sm" onClick={() => add('period')}><Plus size={14} aria-hidden />Period</button>
          <button className="btn-quiet min-h-9 text-sm" onClick={() => add('break')}><Plus size={14} aria-hidden />Break</button>
          <button className="btn-quiet min-h-9 text-sm" onClick={() => add('lunch')}><Plus size={14} aria-hidden />Lunch</button>
          <button className="btn-primary ml-auto min-h-9 text-sm" disabled={!dirty || !rows.length || savePeriods.isPending} onClick={() => savePeriods.mutate()}>{savePeriods.isPending ? 'Saving…' : 'Save timings'}</button>
        </div>
      )}
    </section>
  );
}

export default function TimetableSetupPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const yearId = Number(params.get('year')) || undefined;
  const q = useQuery({ queryKey: ['timetable-setup', yearId], queryFn: () => api<Setup>('/timetable/setup', { query: { yearId } }).then((r) => r.data) });
  const years = useQuery({ queryKey: ['years'], queryFn: () => api<Array<{ id: number; name: string; status: string; is_current: number }>>('/academic-years').then((r) => r.data) });
  const current = years.data?.find((y) => y.is_current);
  const copySched = useMutation({ mutationFn: () => api('/timetable/copy-schedules', { method: 'POST', body: { fromYearId: current!.id, toYearId: q.data!.year.id } }), onSuccess: () => { toast.success('Bell schedules copied'); refresh(); }, onError: (e) => toast.error((e as ApiError).message) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['timetable-setup'] }); qc.invalidateQueries({ queryKey: ['timetable'] }); };
  const [newName, setNewName] = useState('');
  const create = useMutation({ mutationFn: () => api('/timetable/groups', { method: 'POST', query: { yearId }, body: { name: newName } }), onSuccess: () => { setNewName(''); refresh(); }, onError: (e) => toast.error((e as ApiError).status === 409 ? 'A schedule with this name exists.' : (e as ApiError).message) });
  const sats = useMutation({ mutationFn: (weeks: number[]) => api('/timetable/saturdays-off', { method: 'PUT', body: { weeks } }), onSuccess: refresh });
  if (q.isLoading) return <Skeleton rows={5} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const s = q.data!;
  const edit = s.year.editable && can('timetable.manage');
  const unassigned = s.classes.filter((c) => !c.groupId);
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Bell schedules · ${s.year.name}`} description="Create a schedule for each group of classes (for example Pre-primary, Primary, High school), then put each class in one group."
        action={<select className="field w-auto" aria-label="Academic year" value={s.year.id} onChange={(e) => setParams({ year: e.target.value })}>
          {years.data?.filter((y) => y.status !== 'closed' || y.id === s.year.id).map((y) => <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' (current)' : y.status === 'closed' ? ' (closed)' : ' (next)'}</option>)}</select>} />
      {edit && !s.groups.length && current && current.id !== s.year.id && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-brand-soft p-4"><p className="flex-1">Use the same bell schedules as {current.name}? (Lessons are not copied.)</p>
          <button className="btn-primary" disabled={copySched.isPending} onClick={() => copySched.mutate()}>Copy from {current.name}</button></div>
      )}
      <section className="panel mb-4 p-5">
        <h2 className="font-semibold">Saturdays off</h2>
        <p className="mb-3 text-sm text-ink-muted">Classes run Monday to Saturday. Tick the Saturdays of each month that are holidays.</p>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5].map((w) => {
            const on = s.saturdaysOff.includes(w);
            return <button key={w} disabled={!edit} aria-pressed={on} onClick={() => sats.mutate(on ? s.saturdaysOff.filter((x) => x !== w) : [...s.saturdaysOff, w])}
              className={clsx('rounded-lg border px-3 py-1.5 text-sm font-semibold', on ? 'border-brand bg-brand-soft text-brand' : 'border-line')}>{['1st', '2nd', '3rd', '4th', '5th'][w - 1]} Saturday</button>;
          })}
        </div>
      </section>
      {unassigned.length > 0 && s.groups.length > 0 && <p className="mb-4 rounded-lg bg-tangedu-soft px-4 py-3 text-sm text-[#7A5A00]">Not on any schedule yet: {unassigned.map((c) => c.name).join(', ')}.</p>}
      <div className="space-y-4">{s.groups.map((g) => <GroupCard key={g.id} g={g} s={s} edit={edit} refresh={refresh} />)}</div>
      {edit && (
        <form className="mt-4 flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); if (newName.trim().length >= 2) create.mutate(); }}>
          <input className="field" placeholder="New schedule, e.g. Primary (1-5)" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New schedule name" />
          <button className="btn-primary" disabled={newName.trim().length < 2}><Plus size={16} aria-hidden />Add</button>
        </form>
      )}
    </div>
  );
}
