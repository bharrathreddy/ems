import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/academics';
import { inr } from '../lib/fees';
import { ErrorState, Field, PageHeader, Skeleton } from '../components/ui';

const YearCtx = createContext<number | undefined>(undefined);
const useYQ = () => { const y = useContext(YearCtx); return y ? { yearId: y } : undefined; };
interface Setup {
  academicYear: { id: number; name: string; startDate: string; endDate: string; status: string; editable: boolean };
  defaultPlanId: number | null;
  plans: Array<{ id: number; plan_key: string; name: string; installment_count: number; installments: Array<{ installment_no: number; label: string; due_date: string }> }>;
  classFees: Array<{ classId: number; className: string; amount: string | null }>;
  routes: Array<{ id: number; name: string; is_active: number; fee: null | { amount: string; due_date: string | null } }>;
  concessionTypes: Array<{ id: number; name: string }>; oneTimeTypes: Array<{ id: number; name: string }>;
  oneTimeFees: Array<{ id: number; class_id: number; class_name: string; type: string; title: string; amount: string; due_date: string | null }>;
  accounts: { total: number; locked: number };
}
const DEFAULT_LABELS: Record<number, string[]> = { 1: ['Annual'], 2: ['Term 1', 'Term 2'], 4: ['Q1', 'Q2', 'Q3', 'Q4'] };

function Card({ step, title, body, children }: { step: number; title: string; body: string; children: ReactNode }) {
  return (
    <section className="panel p-5">
      <div className="mb-4 flex gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand">{step}</span>
        <div><h2 className="text-lg font-semibold">{title}</h2><p className="text-sm text-ink-muted">{body}</p></div>
      </div>
      {children}
    </section>
  );
}
const iso = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const done = (r: { studentsUpdated?: number; studentsLocked?: number }) =>
  toast.success(`Saved${r.studentsUpdated ? ` · ${r.studentsUpdated} students updated` : ''}${r.studentsLocked ? ` · ${r.studentsLocked} already paying, not changed` : ''}`);

function PlansCard({ s, refresh, edit }: { s: Setup; refresh: () => void; edit: boolean }) {
  const yq = useYQ();
  const [rows, setRows] = useState<Record<string, Array<{ label: string; dueDate: string }>>>({});
  useEffect(() => setRows(Object.fromEntries(s.plans.map((p) => [p.plan_key, Array.from({ length: p.installment_count }, (_, i) => {
    const x = p.installments.find((r) => r.installment_no === i + 1);
    return { label: x?.label ?? DEFAULT_LABELS[p.installment_count][i], dueDate: iso(x?.due_date) };
  })]))), [s]);
  const setDefault = useMutation({
    mutationFn: (planKey: string) => api<{ studentsMoved: number }>('/fees/setup/default-plan', { method: 'PUT', query: yq, body: { planKey } }),
    onSuccess: ({ data }) => { toast.success(`Default plan saved${data.studentsMoved ? ` · ${data.studentsMoved} students moved` : ''}`); refresh(); },
    onError: (e) => toast.error((e as ApiError).message),
  });
  const save = useMutation({
    mutationFn: (key: string) => api('/fees/setup/installments', { method: 'PUT', query: yq, body: { planKey: key, items: rows[key].map((r, i) => ({ installmentNo: i + 1, ...r })) } }),
    onSuccess: () => { toast.success('Due dates saved'); refresh(); },
    onError: (e) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message),
  });
  return (
    <Card step={1} title="Plan and due dates" body="Students get the default plan. Tuition is split equally in whole hundreds; the first installment takes any remainder.">
      <div className="mb-5 inline-flex rounded-lg border border-line bg-chalk p-0.5" role="radiogroup" aria-label="Default plan">
        {s.plans.map((p) => (
          <button key={p.id} role="radio" aria-checked={s.defaultPlanId === p.id} disabled={!edit || setDefault.isPending} onClick={() => setDefault.mutate(p.plan_key)}
            className={clsx('rounded-md px-4 py-2 text-sm font-semibold', s.defaultPlanId === p.id ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted')}>{p.name}</button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {s.plans.map((p) => (
          <div key={p.id} className={clsx('rounded-xl border p-3', s.defaultPlanId === p.id ? 'border-brand' : 'border-line')}>
            <p className="mb-2 font-semibold">{p.name} {s.defaultPlanId === p.id && <span className="text-sm font-medium text-brand">· default</span>}</p>
            <div className="space-y-2">
              {(rows[p.plan_key] ?? []).map((r, i) => (
                <div key={i} className="grid grid-cols-[72px_1fr] gap-2">
                  <input className="field px-2 py-2 text-sm" aria-label={`${p.name} installment ${i + 1} name`} disabled={!edit} value={r.label}
                    onChange={(e) => setRows({ ...rows, [p.plan_key]: rows[p.plan_key].map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <input type="date" className="field px-2 py-2 text-sm" aria-label={`${p.name} installment ${i + 1} due date`} disabled={!edit} value={r.dueDate}
                    onChange={(e) => setRows({ ...rows, [p.plan_key]: rows[p.plan_key].map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)) })} />
                </div>
              ))}
            </div>
            {edit && <button className="btn-quiet mt-3 min-h-9 w-full text-sm" disabled={save.isPending || rows[p.plan_key]?.some((r) => !r.dueDate)} onClick={() => save.mutate(p.plan_key)}>Save due dates</button>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ClassFeesCard({ s, refresh, edit }: { s: Setup; refresh: () => void; edit: boolean }) {
  const yq = useYQ();
  const [vals, setVals] = useState<Record<number, string>>({});
  useEffect(() => setVals(Object.fromEntries(s.classFees.map((c) => [c.classId, c.amount ? String(Number(c.amount)) : '']))), [s]);
  const save = useMutation({
    mutationFn: () => api<any>('/fees/setup/class-fees', { method: 'PUT', query: yq, body: { items: s.classFees.filter((c) => vals[c.classId] !== '' && vals[c.classId] !== undefined).map((c) => ({ classId: c.classId, amount: Number(vals[c.classId]) })) } }),
    onSuccess: ({ data }) => { done(data); refresh(); },
    onError: (e) => toast.error((e as ApiError).message),
  });
  return (
    <Card step={2} title="Tuition fee by class" body="Full-year tuition (term) fee. Changes apply to students who have not paid anything yet this year.">
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {s.classFees.map((c) => (
          <label key={c.classId} className="flex items-center justify-between gap-3">
            <span className="text-[15px]">{c.className}</span>
            <span className="relative w-36"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">₹</span>
              <input className="field py-2 pl-7 text-right tabular-nums" inputMode="numeric" disabled={!edit} value={vals[c.classId] ?? ''} placeholder="Not set"
                onChange={(e) => setVals({ ...vals, [c.classId]: e.target.value.replace(/[^\d]/g, '') })} /></span>
          </label>
        ))}
      </div>
      {edit && <button className="btn-primary mt-4" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save class fees'}</button>}
    </Card>
  );
}

function RoutesCard({ s, refresh, edit }: { s: Setup; refresh: () => void; edit: boolean }) {
  const yq = useYQ();
  const [vals, setVals] = useState<Record<number, { amount: string; dueDate: string }>>({});
  const [name, setName] = useState('');
  useEffect(() => setVals(Object.fromEntries(s.routes.map((r) => [r.id, { amount: r.fee ? String(Number(r.fee.amount)) : '', dueDate: iso(r.fee?.due_date) }]))), [s]);
  const add = useMutation({ mutationFn: () => api('/fees/routes', { method: 'POST', body: { name } }), onSuccess: () => { setName(''); refresh(); }, onError: (e) => toast.error((e as ApiError).status === 409 ? 'That route already exists.' : (e as ApiError).message) });
  const save = useMutation({
    mutationFn: () => api<any>('/fees/setup/route-fees', { method: 'PUT', query: yq, body: { items: s.routes.filter((r) => vals[r.id]?.amount).map((r) => ({ routeId: r.id, amount: Number(vals[r.id].amount), dueDate: vals[r.id].dueDate || null })) } }),
    onSuccess: ({ data }) => { done(data); refresh(); }, onError: (e) => toast.error((e as ApiError).message),
  });
  return (
    <Card step={3} title="Bus routes" body="One bus fee per route for the year, not split into installments. Assign a route on each student's Fees tab.">
      {s.routes.length > 0 && (
        <div className="mb-4 space-y-2">
          {s.routes.map((r) => (
            <div key={r.id} className="grid grid-cols-[1fr_130px_150px] items-center gap-2">
              <span className="truncate font-medium">{r.name}</span>
              <span className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">₹</span>
                <input className="field py-2 pl-7 text-right tabular-nums" inputMode="numeric" aria-label={`${r.name} fee`} disabled={!edit} value={vals[r.id]?.amount ?? ''} placeholder="Fee"
                  onChange={(e) => setVals({ ...vals, [r.id]: { ...vals[r.id], amount: e.target.value.replace(/[^\d]/g, '') } })} /></span>
              <input type="date" className="field py-2 text-sm" aria-label={`${r.name} due date`} disabled={!edit} value={vals[r.id]?.dueDate ?? ''}
                onChange={(e) => setVals({ ...vals, [r.id]: { ...vals[r.id], dueDate: e.target.value } })} />
            </div>
          ))}
          {edit && <button className="btn-primary mt-2" disabled={save.isPending} onClick={() => save.mutate()}>Save bus fees</button>}
        </div>
      )}
      {edit && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) add.mutate(); }}>
          <input className="field" placeholder="New route, e.g. Route 1 - Mokila" value={name} onChange={(e) => setName(e.target.value)} aria-label="New route name" />
          <button className="btn-quiet" disabled={add.isPending || name.trim().length < 2}><Plus size={16} aria-hidden />Add route</button>
        </form>
      )}
    </Card>
  );
}

function OneTimeCard({ s, refresh, edit }: { s: Setup; refresh: () => void; edit: boolean }) {
  const yq = useYQ();
  const [f, setF] = useState({ classIds: [] as number[], typeId: '', newType: '', title: '', amount: '', dueDate: '' });
  const create = useMutation({
    mutationFn: async () => {
      let typeId = Number(f.typeId);
      if (f.typeId === 'new') typeId = (await api<{ id: number }>('/fees/one-time-types', { method: 'POST', body: { name: f.newType } })).data.id;
      for (const classId of f.classIds) await api('/fees/one-time', { method: 'POST', query: yq, body: { classId, typeId, title: f.title, amount: Number(f.amount), dueDate: f.dueDate || null } });
    },
    onSuccess: () => { toast.success(`Added to ${f.classIds.length} class${f.classIds.length > 1 ? 'es' : ''}`); setF({ classIds: [], typeId: '', newType: '', title: '', amount: '', dueDate: '' }); refresh(); },
    onError: (e) => toast.error((e as ApiError).message),
  });
  const remove = useMutation({ mutationFn: (id: number) => api(`/fees/one-time/${id}`, { method: 'DELETE' }), onSuccess: () => { toast.success('Removed'); refresh(); }, onError: (e) => toast.error((e as ApiError).message) });
  return (
    <Card step={4} title="One-time fees" body="Exam fee, books, uniform and so on. Same amount for every student in the class; new students in the class get it too.">
      {s.oneTimeFees.length > 0 && (
        <ul className="mb-4 divide-y divide-line rounded-lg border border-line">
          {s.oneTimeFees.map((o) => (
            <li key={o.id} className="flex items-center gap-3 px-3 py-2.5 text-[15px]">
              <span className="flex-1"><span className="font-medium">{o.title}</span> <span className="text-ink-muted">· {o.class_name}{o.due_date ? ` · due ${fmtDate(o.due_date)}` : ''}</span></span>
              <span className="font-semibold tabular-nums">{inr(o.amount)}</span>
              {edit && <button aria-label={`Remove ${o.title} for ${o.class_name}`} className="p-1 text-ink-muted hover:text-danger" onClick={() => confirm(`Remove ${o.title} for ${o.class_name}?`) && remove.mutate(o.id)}><Trash2 size={16} /></button>}
            </li>
          ))}
        </ul>
      )}
      {edit && (
        <div className="space-y-3 rounded-xl bg-chalk p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <select className="field" value={f.typeId} onChange={(e) => setF({ ...f, typeId: e.target.value })}>
                <option value="">Choose</option>{s.oneTimeTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}<option value="new">+ New type…</option>
              </select>
            </Field>
            {f.typeId === 'new' ? <Field label="New type name"><input className="field" value={f.newType} onChange={(e) => setF({ ...f, newType: e.target.value })} placeholder="e.g. Exam fee" /></Field>
              : <Field label="Title on receipt"><input className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. SA1 Exam fee" /></Field>}
          </div>
          {f.typeId === 'new' && <Field label="Title on receipt"><input className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. SA1 Exam fee" /></Field>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)"><input className="field tabular-nums" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d]/g, '') })} /></Field>
            <Field label="Due date (optional)"><input type="date" className="field" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          </div>
          <div>
            <p className="label">Classes</p>
            <div className="flex flex-wrap gap-1.5">{s.classFees.map((c) => (
              <button key={c.classId} type="button" aria-pressed={f.classIds.includes(c.classId)} onClick={() => setF({ ...f, classIds: f.classIds.includes(c.classId) ? f.classIds.filter((x) => x !== c.classId) : [...f.classIds, c.classId] })}
                className={clsx('rounded-lg border px-2.5 py-1.5 text-sm font-medium', f.classIds.includes(c.classId) ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface')}>{c.className}</button>
            ))}</div>
          </div>
          <button className="btn-primary" disabled={create.isPending || !f.classIds.length || !f.typeId || (f.typeId === 'new' && f.newType.trim().length < 2) || f.title.trim().length < 2 || !Number(f.amount)} onClick={() => create.mutate()}>
            {create.isPending ? 'Adding…' : 'Add one-time fee'}</button>
        </div>
      )}
    </Card>
  );
}

function ConcessionsCard({ s, refresh, edit }: { s: Setup; refresh: () => void; edit: boolean }) {
  const [name, setName] = useState('');
  const add = useMutation({ mutationFn: () => api('/fees/concession-types', { method: 'POST', body: { name } }), onSuccess: () => { setName(''); refresh(); }, onError: (e) => toast.error((e as ApiError).status === 409 ? 'Already exists.' : (e as ApiError).message) });
  return (
    <Card step={5} title="Concession types (optional)" body="Labels for discounts, such as Sibling or Staff child. Discount amounts are set per student on their Fees tab.">
      <div className="flex flex-wrap gap-2">{s.concessionTypes.length ? s.concessionTypes.map((c) => <span key={c.id} className="rounded-md bg-chalk px-2.5 py-1 text-sm font-medium">{c.name}</span>) : <p className="text-sm text-ink-muted">None yet.</p>}</div>
      {edit && <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) add.mutate(); }}>
        <input className="field" placeholder="e.g. Sibling" value={name} onChange={(e) => setName(e.target.value)} aria-label="New concession type" /><button className="btn-quiet" disabled={name.trim().length < 2}>Add</button></form>}
    </Card>
  );
}

export default function FeeSetupPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const yearId = Number(params.get('year')) || undefined;
  const q = useQuery({ queryKey: ['fee-setup', yearId], queryFn: () => api<Setup>('/fees/setup', { query: { yearId } }).then((r) => r.data) });
  const years = useQuery({ queryKey: ['years'], queryFn: () => api<Array<{ id: number; name: string; status: string; is_current: number }>>('/academic-years').then((r) => r.data) });
  const current = years.data?.find((y) => y.is_current);
  const copy = useMutation({ mutationFn: () => api('/fees/setup/copy', { method: 'POST', body: { fromYearId: current!.id, toYearId: q.data!.academicYear.id } }),
    onSuccess: () => { toast.success(`Copied from ${current!.name}. Change what is different.`); qc.invalidateQueries({ queryKey: ['fee-setup'] }); }, onError: (e) => toast.error((e as ApiError).message) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['fee-setup'] }); qc.invalidateQueries({ queryKey: ['fees'] }); };
  if (q.isLoading) return <Skeleton rows={6} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const edit = can('fees.configure') && s.academicYear.editable;
  const empty = !s.defaultPlanId && s.classFees.every((c) => !c.amount);
  return (
    <YearCtx.Provider value={yearId}>
    <div className="max-w-5xl">
      <PageHeader title={`Fee setup · ${s.academicYear.name}`} description={s.academicYear.status === 'planned' ? 'Next year. Nothing here affects students until the year starts.' : `${s.accounts.total} students have fee accounts; ${s.accounts.locked} have started paying (their fee details are locked).`}
        action={<select className="field w-auto" aria-label="Academic year" value={s.academicYear.id} onChange={(e) => setParams({ year: e.target.value })}>
          {years.data?.map((y) => <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' (current)' : y.status === 'closed' ? ' (closed)' : ' (next)'}</option>)}</select>} />
      {!s.academicYear.editable && <p className="mb-4 rounded-lg bg-chalk px-4 py-3 text-sm text-ink-muted">{s.academicYear.name} is closed. This is a read-only record.</p>}
      {edit && empty && current && current.id !== s.academicYear.id && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-brand-soft p-4">
          <p className="flex-1 text-[15px]">Start from <strong>{current.name}</strong>: plans, due dates (moved forward a year), class fees, bus fees and one-time fees are copied exactly.</p>
          <button className="btn-primary" disabled={copy.isPending} onClick={() => copy.mutate()}>Copy from {current.name}</button>
        </div>
      )}
      <div className="space-y-4">
        <PlansCard s={s} refresh={refresh} edit={edit} />
        <ClassFeesCard s={s} refresh={refresh} edit={edit} />
        <RoutesCard s={s} refresh={refresh} edit={edit} />
        <OneTimeCard s={s} refresh={refresh} edit={edit} />
        <ConcessionsCard s={s} refresh={refresh} edit={edit} />
      </div>
    </div>
    </YearCtx.Provider>
  );
}
