import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, ChevronRight, Circle } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError } from '../lib/api';
import { Badge, EmptyState, ErrorState, Field, PageHeader, Skeleton } from '../components/ui';

interface Year { id: number; name: string; start_date: string; end_date: string; is_current: number; status: string }
interface Overview { from: { id: number; name: string }; to: { id: number; name: string }; newAdmissions: number;
  sections: Array<{ section_id: number; section: string; class_name: string; total: number; pending: number; promoted: number; detained: number; leaving: number }> }
interface Check { counts: { promoted: number; detained: number; leaving: number; notDecided: number; newAdmissions: number };
  warnings: { notPromoted: Array<{ className: string; section: string; pending: number }>; noClassTeacher: string[]; feesNotSetUp: boolean; classesWithoutFee: string[] }; ready: boolean }

const nextName = (name: string) => { const a = Number(name.slice(0, 4)) + 1; return `${a}-${String(a + 1).slice(2)}`; };
const plusYear = (d: string) => { const x = new Date(d); x.setUTCFullYear(x.getUTCFullYear() + 1); return x.toISOString().slice(0, 10); };

function Step({ n, done, title, body, children }: { n: number; done: boolean; title: string; body: string; children?: React.ReactNode }) {
  return (
    <li className="panel flex gap-4 p-5">
      <span className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold', done ? 'bg-brand text-white' : 'bg-chalk text-ink-muted')}>{done ? <Check size={16} /> : n}</span>
      <div className="min-w-0 flex-1"><h2 className="font-semibold">{title}</h2><p className="text-sm text-ink-muted">{body}</p>{children && <div className="mt-3">{children}</div>}</div>
    </li>
  );
}

export function PlanYear({ years, onCreated }: { years: Year[]; onCreated: (id: number) => void }) {
  const current = years.find((y) => y.is_current);
  const [f, setF] = useState(() => ({ name: current ? nextName(current.name) : '', startDate: current ? plusYear(current.start_date) : '', endDate: current ? plusYear(current.end_date) : '' }));
  const m = useMutation({ mutationFn: () => api<{ id: number }>('/academic-years', { method: 'POST', body: f }), onSuccess: ({ data }) => { toast.success(`${f.name} created as the next year`); onCreated(data.id); }, onError: (e) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message) });
  return (
    <div className="panel max-w-xl p-5">
      <h2 className="font-semibold">Create the next academic year</h2>
      <p className="mb-4 text-sm text-ink-muted">It stays "planned" while {current?.name ?? 'this year'} runs. Nothing changes for anyone until you switch.</p>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Name"><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Starts"><input type="date" className="field" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="Ends"><input type="date" className="field" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
      </div>
      <button className="btn-primary mt-4" disabled={m.isPending} onClick={() => m.mutate()}>Create {f.name}</button>
    </div>
  );
}

export default function YearEndPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const years = useQuery({ queryKey: ['years'], queryFn: () => api<Year[]>('/academic-years').then((r) => r.data) });
  const current = years.data?.find((y) => y.is_current);
  const planned = years.data?.filter((y) => !y.is_current && y.status !== 'closed' && current && y.start_date > current.start_date) ?? [];
  const toYearId = Number(params.get('to')) || planned[planned.length - 1]?.id;
  const ov = useQuery({ queryKey: ['ye-overview', toYearId], enabled: !!toYearId, queryFn: () => api<Overview>('/year-end/overview', { query: { toYearId } }).then((r) => r.data) });
  const chk = useQuery({ queryKey: ['ye-check', toYearId], enabled: !!toYearId, queryFn: () => api<Check>('/year-end/switch-check', { query: { toYearId } }).then((r) => r.data) });
  const [confirmText, setConfirmText] = useState('');
  const sw = useMutation({
    mutationFn: () => api<{ current: string; closed: string; studentsMadeInactive: number; feeAccountsCreated: number }>('/year-end/switch', { method: 'POST', body: { toYearId, acceptWarnings: true } }),
    onSuccess: ({ data }) => { toast.success(`${data.current} is now the current year. ${data.closed} is closed.`, { duration: 10000 }); qc.invalidateQueries(); },
    onError: (e) => toast.error((e as ApiError).message),
  });
  if (years.isLoading) return <Skeleton rows={5} />;
  if (!current) return <EmptyState title="No current academic year" body="Set one up in Classes & years first." />;
  if (!toYearId) return <div><PageHeader title="Year end" description="Prepare next year while this one runs, then switch in June." /><PlanYear years={years.data!} onCreated={(id) => { qc.invalidateQueries({ queryKey: ['years'] }); setParams({ to: String(id) }); }} /></div>;
  const to = years.data!.find((y) => y.id === toYearId);
  if (!to) return <Skeleton rows={5} />;
  const c = chk.data;
  const promotedAll = !!c && c.counts.notDecided === 0;
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Year end · ${current.name} → ${to.name}`} description={`Everything here prepares ${to.name}. ${current.name} keeps running normally until you switch.`} />
      <ol className="space-y-3">
        <Step n={1} done={!!c && !c.warnings.feesNotSetUp && !c.warnings.classesWithoutFee.length} title="Fee setup for next year" body="Copy this year's setup exactly, then change what is different.">
          <Link className="btn-quiet min-h-9 text-sm" to={`/fees/setup?year=${toYearId}`}>Open fee setup for {to.name}<ChevronRight size={16} aria-hidden /></Link>
        </Step>
        <Step n={2} done={!!c && c.counts.notDecided === 0 && c.counts.promoted + c.counts.detained > 0 && !c.warnings.noClassTeacher.length} title="Teachers for next year" body="Class teachers and subject teachers are assigned fresh each year.">
          <div className="flex flex-wrap gap-2"><Link className="btn-quiet min-h-9 text-sm" to={`/teaching?year=${toYearId}`}>Teaching grid for {to.name}<ChevronRight size={16} aria-hidden /></Link>
            <Link className="btn-quiet min-h-9 text-sm" to={`/timetable/setup?year=${toYearId}`}>Bell schedules<ChevronRight size={16} aria-hidden /></Link></div>
        </Step>
        <Step n={3} done={promotedAll} title="Promote students" body="Open each section. Everyone is set to move up; change only the exceptions.">
          {ov.isLoading ? <Skeleton rows={3} /> : ov.isError ? <ErrorState message={(ov.error as Error).message} /> : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {ov.data!.sections.map((s) => (
                <li key={s.section_id}>
                  <Link to={`/year-end/section/${s.section_id}?to=${toYearId}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-chalk">
                    {s.pending === 0 ? <Check size={16} className="text-brand" aria-label="Done" /> : <Circle size={16} className="text-ink-muted" aria-label="To do" />}
                    <span className="flex-1 font-medium">{s.class_name} {s.section}</span>
                    <span className="text-sm text-ink-muted">{s.pending ? `${s.pending} of ${s.total} to decide` : `${s.promoted} up${s.detained ? ` · ${s.detained} kept` : ''}${s.leaving ? ` · ${s.leaving} leaving` : ''}`}</span>
                    <ChevronRight size={16} className="text-ink-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {ov.data && ov.data.newAdmissions > 0 && <p className="mt-2 text-sm text-ink-muted">{ov.data.newAdmissions} new admissions already in {to.name}.</p>}
        </Step>
        <Step n={4} done={false} title="Roll numbers" body="After promotion, number each new section: alphabetically, by admission number, or by hand.">
          <Link className="btn-quiet min-h-9 text-sm" to={`/year-end/rolls?year=${toYearId}`}>Roll numbers for {to.name}<ChevronRight size={16} aria-hidden /></Link>
        </Step>
        <Step n={5} done={false} title={`Switch to ${to.name}`} body={`Usually done on the first day of the new year. ${current.name} becomes read-only, but its unpaid fees can still be collected.`}>
          {c && (
            <div className="space-y-3">
              <p className="text-sm">{c.counts.promoted} promoted · {c.counts.detained} kept in class · {c.counts.leaving} leaving (will become inactive) · {c.counts.newAdmissions} new admissions</p>
              {!c.ready && (
                <div className="rounded-lg bg-tangedu-soft p-3 text-sm text-[#7A5A00]">
                  <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} aria-hidden />Not finished yet</p>
                  <ul className="mt-1 list-disc pl-5">
                    {c.warnings.notPromoted.length > 0 && <li>Not decided: {c.warnings.notPromoted.map((s) => `${s.className} ${s.section} (${s.pending})`).join(', ')}. They stay active but will have no class in {to.name}.</li>}
                    {c.warnings.noClassTeacher.length > 0 && <li>No class teacher: {c.warnings.noClassTeacher.join(', ')}</li>}
                    {c.warnings.feesNotSetUp && <li>Fees for {to.name} are not set up.</li>}
                    {c.warnings.classesWithoutFee.length > 0 && <li>No tuition fee for: {c.warnings.classesWithoutFee.join(', ')}</li>}
                  </ul>
                </div>
              )}
              <Field label={`Type ${to.name} to confirm`}><input className="field max-w-40" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></Field>
              <button className="btn-primary" disabled={confirmText !== to.name || sw.isPending} onClick={() => sw.mutate()}>{sw.isPending ? 'Switching…' : `Switch to ${to.name}${c.ready ? '' : ' anyway'}`}</button>
            </div>
          )}
        </Step>
      </ol>
    </div>
  );
}

// ---------------- One section's promotion ----------------
interface SectionData {
  from: { name: string }; to: { id: number; name: string };
  section: { id: number; name: string; classId: number; className: string; isTopClass: boolean };
  defaultAction: 'promote' | 'complete'; defaultTarget: { classId: number; sectionId: number | null } | null;
  classes: Array<{ id: number; name: string; sections: Array<{ id: number; name: string }> }>;
  students: Array<{ id: string; name: string; admissionNo: string; rollNo: string | null; remarks: string | null; decided: boolean; action: string | null; classId: number | null; sectionId: number | null }>;
}
type Row = { action: 'promote' | 'detain' | 'leave' | 'complete'; classId: number | null; sectionId: number | null; remarks: string };
const ACTION_LABEL = { promote: 'Promote', detain: 'Keep in class', leave: 'Leaving (TC)', complete: 'Completed' };

export function PromoteSectionPage({ sectionId }: { sectionId: number }) {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const toYearId = Number(params.get('to'));
  const q = useQuery({ queryKey: ['ye-section', sectionId, toYearId], queryFn: () => api<SectionData>(`/year-end/sections/${sectionId}`, { query: { toYearId } }).then((r) => r.data) });
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!q.data) return;
    const d = q.data;
    setRows(Object.fromEntries(d.students.map((s) => [s.id, s.decided
      ? { action: s.action as Row['action'], classId: s.classId, sectionId: s.sectionId, remarks: s.remarks ?? '' }
      : { action: d.defaultAction, classId: d.defaultTarget?.classId ?? null, sectionId: d.defaultTarget?.sectionId ?? null, remarks: '' }])));
    setPicked(new Set());
  }, [q.data]);
  const d = q.data;
  const sectionsOf = (classId: number | null) => d?.classes.find((c) => c.id === classId)?.sections ?? [];
  const setRow = (id: string, p: Partial<Row>) => setRows((r) => {
    const cur = { ...r[id], ...p };
    if (p.action === 'detain') { cur.classId = d!.section.classId; cur.sectionId = d!.section.id; }
    if (p.action === 'promote' && (!cur.classId || cur.classId === d!.section.classId)) { cur.classId = d!.defaultTarget?.classId ?? null; cur.sectionId = d!.defaultTarget?.sectionId ?? null; }
    if (p.classId !== undefined) cur.sectionId = sectionsOf(p.classId)[0]?.id ?? null;
    return { ...r, [id]: cur };
  });
  const bulk = (p: Partial<Row>) => { picked.forEach((id) => setRow(id, p)); };
  const save = useMutation({
    mutationFn: () => api('/year-end/apply', { method: 'POST', body: { toYearId, decisions: Object.entries(rows).map(([studentId, r]) => ({ studentId, action: r.action, classId: r.classId ?? undefined, sectionId: r.sectionId ?? undefined, remarks: r.remarks || null })) } }),
    onSuccess: () => { toast.success('Saved. You can still change this until the switch.'); qc.invalidateQueries({ queryKey: ['ye-overview'] }); qc.invalidateQueries({ queryKey: ['ye-check'] }); qc.invalidateQueries({ queryKey: ['ye-section'] }); },
    onError: (e) => {
      const det = (e as ApiError).details ?? [];
      const ids = Object.keys(rows);
      setErrors(Object.fromEntries(det.map((x) => [ids[Number(/decisions\.(\d+)/.exec(x.field)?.[1])], x.message])));
      toast.error(det.length ? `${det.length} student${det.length > 1 ? 's need' : ' needs'} attention` : (e as ApiError).message);
    },
  });
  const counts = useMemo(() => Object.values(rows).reduce((m, r) => ({ ...m, [r.action]: (m[r.action] ?? 0) + 1 }), {} as Record<string, number>), [rows]);
  if (q.isLoading) return <Skeleton rows={6} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const all = picked.size === d!.students.length && d!.students.length > 0;
  return (
    <div className="pb-28">
      <Link to={`/year-end?to=${toYearId}`} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink"><ArrowLeft size={16} aria-hidden />Year end</Link>
      <PageHeader title={`${d!.section.className} ${d!.section.name} → ${d!.to.name}`} description={d!.section.isTopClass ? 'Final class: students are marked Completed. Tick any kept for re-exam or leaving.' : 'Everyone is set to move up to the same section. Tick students to change several at once.'} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-muted">{Object.entries(counts).map(([k, v]) => `${v} ${ACTION_LABEL[k as Row['action']].toLowerCase()}`).join(' · ')}</span>
        {picked.size > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-2 rounded-lg bg-brand-soft px-3 py-2">
            <span className="text-sm font-semibold text-brand">{picked.size} ticked:</span>
            {!d!.section.isTopClass && <button className="btn-quiet min-h-8 px-2.5 text-xs" onClick={() => bulk({ action: 'promote' })}>Promote</button>}
            {d!.section.isTopClass && <button className="btn-quiet min-h-8 px-2.5 text-xs" onClick={() => bulk({ action: 'complete' })}>Completed</button>}
            <button className="btn-quiet min-h-8 px-2.5 text-xs" onClick={() => { const reason = prompt('Reason for keeping in the same class:'); if (reason) bulk({ action: 'detain', remarks: reason }); }}>Keep in class</button>
            <button className="btn-quiet min-h-8 px-2.5 text-xs" onClick={() => bulk({ action: 'leave', remarks: 'Left with TC' })}>Leaving (TC)</button>
            {!d!.section.isTopClass && sectionsOf(d!.defaultTarget?.classId ?? null).length > 1 && (
              <select className="field min-h-8 w-auto py-0.5 text-xs" aria-label="Move ticked to section" defaultValue="" onChange={(e) => { if (e.target.value) bulk({ action: 'promote', classId: d!.defaultTarget!.classId, sectionId: Number(e.target.value) } as any); e.target.value = ''; }}>
                <option value="">Section…</option>{sectionsOf(d!.defaultTarget?.classId ?? null).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>
        )}
      </div>
      {d!.students.length === 0 ? <EmptyState title="No students" body="No active students in this section this year." /> : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead className="border-b border-line text-sm text-ink-muted"><tr>
              <th className="w-10 px-3 py-3"><input type="checkbox" aria-label="Tick all" checked={all} onChange={() => setPicked(all ? new Set() : new Set(d!.students.map((s) => s.id)))} /></th>
              <th className="px-2 py-3 font-medium">Student</th><th className="px-2 py-3 font-medium">Decision</th><th className="px-2 py-3 font-medium">{d!.to.name} class</th><th className="px-2 py-3 font-medium">Reason</th></tr></thead>
            <tbody className="divide-y divide-line">
              {d!.students.map((s) => {
                const r = rows[s.id]; if (!r) return null;
                return (
                  <tr key={s.id} className={clsx(picked.has(s.id) && 'bg-brand-soft/40')}>
                    <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Tick ${s.name}`} checked={picked.has(s.id)} onChange={() => { const n = new Set(picked); n.has(s.id) ? n.delete(s.id) : n.add(s.id); setPicked(n); }} /></td>
                    <td className="px-2 py-2.5"><p className="font-semibold">{s.name}</p><p className="text-xs text-ink-muted">Adm {s.admissionNo}{s.rollNo ? ` · Roll ${s.rollNo}` : ''}{s.decided ? '' : ' · not saved yet'}</p></td>
                    <td className="px-2 py-2.5">
                      <select className="field py-1.5 text-sm" aria-label={`Decision for ${s.name}`} value={r.action} onChange={(e) => setRow(s.id, { action: e.target.value as Row['action'] })}>
                        {(d!.section.isTopClass ? ['complete', 'detain', 'leave'] : ['promote', 'detain', 'leave']).map((a) => <option key={a} value={a}>{ACTION_LABEL[a as Row['action']]}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2.5">
                      {r.action === 'promote' ? (
                        <div className="flex gap-1">
                          <select className="field py-1.5 text-sm" aria-label={`Class for ${s.name}`} value={r.classId ?? ''} onChange={(e) => setRow(s.id, { classId: Number(e.target.value) })}>
                            {d!.classes.filter((c) => c.id !== d!.section.classId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                          <select className="field w-20 py-1.5 text-sm" aria-label={`Section for ${s.name}`} value={r.sectionId ?? ''} onChange={(e) => setRow(s.id, { sectionId: Number(e.target.value) })}>
                            {sectionsOf(r.classId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                        </div>
                      ) : r.action === 'detain' ? (
                        <select className="field w-28 py-1.5 text-sm" aria-label={`Section for ${s.name}`} value={r.sectionId ?? ''} onChange={(e) => setRow(s.id, { sectionId: Number(e.target.value) })}>
                          {sectionsOf(d!.section.classId).map((x) => <option key={x.id} value={x.id}>{d!.section.className} {x.name}</option>)}</select>
                      ) : <Badge tone={r.action === 'leave' ? 'danger' : 'neutral'}>{r.action === 'leave' ? 'Becomes inactive' : 'Becomes alumni'}</Badge>}
                    </td>
                    <td className="px-2 py-2.5">
                      {r.action !== 'promote' && <input className={clsx('field py-1.5 text-sm', errors[s.id] && 'border-danger')} aria-label={`Reason for ${s.name}`} placeholder={r.action === 'detain' ? 'Required' : 'Optional'} value={r.remarks} onChange={(e) => setRow(s.id, { remarks: e.target.value })} />}
                      {errors[s.id] && <p className="mt-1 text-xs text-danger">{errors[s.id]}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 p-3 backdrop-blur lg:bottom-0 lg:left-[264px]">
        <div className="mx-auto flex max-w-6xl justify-end"><button className="btn-primary" disabled={save.isPending || !d!.students.length} onClick={() => { setErrors({}); save.mutate(); }}>{save.isPending ? 'Saving…' : `Save ${d!.students.length} decisions`}</button></div>
      </div>
    </div>
  );
}

// ---------------- Roll numbers ----------------
export function RollsPage() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const yearId = Number(params.get('year'));
  const grid = useQuery({ queryKey: ['teaching-grid', yearId], queryFn: () => api<any>('/teaching/grid', { query: { yearId } }).then((r) => r.data) });
  const [sectionId, setSectionId] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['rolls', yearId, sectionId], enabled: !!sectionId, queryFn: () => api<Array<{ studentId: string; name: string; admissionNo: string; rollNo: string | null }>>('/year-end/rolls', { query: { yearId, sectionId: sectionId! } }).then((r) => r.data) });
  const [edit, setEdit] = useState<Record<string, string>>({});
  useEffect(() => setEdit(Object.fromEntries((q.data ?? []).map((r) => [r.studentId, r.rollNo ?? '']))), [q.data]);
  const auto = useMutation({ mutationFn: (mode: 'alpha' | 'admission') => api('/year-end/rolls/auto', { method: 'POST', body: { yearId, sectionId, mode } }), onSuccess: () => { toast.success('Roll numbers given'); qc.invalidateQueries({ queryKey: ['rolls'] }); } });
  const save = useMutation({ mutationFn: () => api('/year-end/rolls', { method: 'PUT', body: { yearId, sectionId, rolls: Object.entries(edit).map(([studentId, rollNo]) => ({ studentId, rollNo: rollNo || null })) } }),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['rolls'] }); }, onError: (e) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message) });
  const sections = (grid.data?.classes ?? []).flatMap((c: any) => c.sections.map((s: any) => ({ id: s.id, label: `${c.name} ${s.name}` })));
  return (
    <div className="max-w-2xl">
      <Link to={`/year-end?to=${yearId}`} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink"><ArrowLeft size={16} aria-hidden />Year end</Link>
      <PageHeader title={`Roll numbers · ${grid.data?.year.name ?? ''}`} />
      <select className="field mb-4 max-w-xs" aria-label="Section" value={sectionId ?? ''} onChange={(e) => setSectionId(Number(e.target.value) || null)}>
        <option value="">Choose a section</option>{sections.map((s: any) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      {sectionId && (q.isLoading ? <Skeleton rows={4} /> : !q.data?.length ? <EmptyState title="No students yet" body="Promote students into this section first." /> : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <button className="btn-quiet min-h-9 text-sm" onClick={() => auto.mutate('alpha')}>Number alphabetically</button>
            <button className="btn-quiet min-h-9 text-sm" onClick={() => auto.mutate('admission')}>Number by admission number</button>
          </div>
          <ul className="panel divide-y divide-line">{q.data.map((r) => (
            <li key={r.studentId} className="flex items-center gap-3 px-4 py-2">
              <input className="field w-20 py-1.5 text-center tabular-nums" aria-label={`Roll for ${r.name}`} value={edit[r.studentId] ?? ''} onChange={(e) => setEdit({ ...edit, [r.studentId]: e.target.value.replace(/[^\w-]/g, '') })} />
              <span className="flex-1 font-medium">{r.name}</span><span className="text-sm text-ink-muted">Adm {r.admissionNo}</span>
            </li>))}</ul>
          <button className="btn-primary mt-3" disabled={save.isPending} onClick={() => save.mutate()}>Save roll numbers</button>
        </>
      ))}
    </div>
  );
}
