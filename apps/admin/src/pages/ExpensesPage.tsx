import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Plus, Search, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, fieldErrors, uploadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { inr, METHOD_LABEL, todayISO } from '../lib/fees';
import { openProtected } from '../lib/payroll';
import ExportButtons from '../components/ExportButtons';
import { Badge, EmptyState, ErrorState, Field, MobileAction, PageHeader, Sheet, Skeleton, Toggle } from '../components/ui';

interface Category { id: number; name: string; isActive: boolean; isSystem: boolean }
interface Row { id: string; voucherNo: string; date: string; amount: number; paidTo: string; method: string; reference: string | null; description: string | null; hasBill: boolean; source: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'; category: string; createdBy: string; decidedBy: string | null; decisionNote: string | null; canDecide: boolean; canCancel: boolean; canAttach: boolean }
interface ListData { from: string; to: string; rows: Row[]; total: number; pending: number; pendingCount: number; byCategory: Array<{ name: string; amount: number }> }
interface Rules { mode: 'none' | 'all' | 'above'; limit: number }

const err = (e: unknown) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message);
const STATUS: Record<Row['status'], [string, 'brand' | 'attention' | 'danger' | 'neutral']> = { approved: ['Approved', 'brand'], pending: ['Waiting approval', 'attention'], rejected: ['Not approved', 'danger'], cancelled: ['Cancelled', 'neutral'] };
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const useCategories = () => useQuery({ queryKey: ['expense-categories'], queryFn: () => api<Category[]>('/expenses/categories').then((r) => r.data) });

function AddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const cats = useCategories();
  const rules = useQuery({ queryKey: ['expense-rules'], queryFn: () => api<Rules>('/expenses/settings').then((r) => r.data), enabled: open });
  const { can } = useAuth();
  const blank = { date: todayISO(), categoryId: '', amount: '', paidTo: '', method: 'cash', reference: '', description: '' };
  const [f, setF] = useState(blank);
  const [bill, setBill] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const m = useMutation({
    mutationFn: async () => {
      const r = await api<{ publicId: string; voucher: string; status: string }>('/expenses', { method: 'POST', body: { ...f, categoryId: Number(f.categoryId), amount: Number(f.amount), reference: f.reference || null, description: f.description || null } });
      if (bill) await uploadFile(`/expenses/${r.data.publicId}/bill`, bill).catch((e) => toast.error(`Saved, but the bill was not attached: ${(e as Error).message}`));
      return r.data;
    },
    onSuccess: (d) => { toast.success(`${d.voucher} saved${d.status === 'pending' ? ', waiting for approval' : ''}`); qc.invalidateQueries({ queryKey: ['expenses'] }); setF(blank); setBill(null); setErrors({}); onClose(); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(Object.keys(fe).length ? fe : { form: (e as ApiError).message }); },
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const amount = Number(f.amount) || 0;
  const r = rules.data;
  const needs = r && !can('expenses.approve') && (r.mode === 'all' || (r.mode === 'above' && amount > r.limit));
  return (
    <Sheet open={open} onClose={onClose} title="Add expense" footer={<button className="btn-primary w-full" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Saving…' : needs ? 'Save and send for approval' : 'Save expense'}</button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" error={errors.date}><input type="date" className="field" max={todayISO()} value={f.date} onChange={set('date')} /></Field>
          <Field label="Amount (₹)" error={errors.amount}><input className="field" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^0-9.]/g, '') })} /></Field>
        </div>
        <Field label="Category" error={errors.categoryId}><select className="field" value={f.categoryId} onChange={set('categoryId')}><option value="">Choose…</option>{cats.data?.filter((c) => c.isActive && !c.isSystem).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Paid to" error={errors.paidTo} hint="Shop, person or company"><input className="field" value={f.paidTo} onChange={set('paidTo')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="How paid"><select className="field" value={f.method} onChange={set('method')}>{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Reference (optional)" hint="Bill or cheque no."><input className="field" value={f.reference} onChange={set('reference')} /></Field>
        </div>
        <Field label="Details (optional)"><textarea className="field min-h-16" value={f.description} onChange={set('description')} maxLength={500} /></Field>
        <div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" capture="environment" className="hidden" onChange={(e) => setBill(e.target.files?.[0] ?? null)} />
          <button type="button" className="btn-quiet min-h-10 text-sm" onClick={() => fileRef.current?.click()}><Paperclip size={16} aria-hidden />{bill ? bill.name : 'Attach bill photo or PDF (optional)'}</button>
        </div>
        {needs && <p className="rounded-lg bg-tangedu-soft px-3 py-2 text-sm">{r!.mode === 'all' ? 'Every expense needs approval.' : `Amounts above ${inr(r!.limit)} need approval.`} It counts in totals once approved.</p>}
        {errors.form && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger" role="alert">{errors.form}</p>}
      </div>
    </Sheet>
  );
}

function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const cats = useCategories();
  const rules = useQuery({ queryKey: ['expense-rules'], queryFn: () => api<Rules>('/expenses/settings').then((r) => r.data), enabled: open });
  const [r, setR] = useState<Rules | null>(null);
  const [name, setName] = useState('');
  useEffect(() => { if (rules.data) setR(rules.data); }, [rules.data]);
  const saveRules = useMutation({ mutationFn: () => api('/expenses/settings', { method: 'PUT', body: r }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['expense-rules'] }); toast.success('Approval rule saved'); }, onError: err });
  const cat = useMutation({ mutationFn: (v: { id?: number; name: string; isActive?: boolean }) => api<Category[]>(v.id ? `/expenses/categories/${v.id}` : '/expenses/categories', { method: v.id ? 'PATCH' : 'POST', body: { name: v.name, isActive: v.isActive } }),
    onSuccess: ({ data }) => { qc.setQueryData(['expense-categories'], data); setName(''); }, onError: err });
  return (
    <Sheet open={open} onClose={onClose} title="Expense settings">
      {!r ? <Skeleton /> : (
        <div className="space-y-6">
          <section>
            <h3 className="label">Who must approve</h3>
            <div className="space-y-2">
              {([['none', 'No approval: every entry counts at once'], ['above', 'Approve only amounts above a limit'], ['all', 'Approve every expense']] as const).map(([k, v]) => (
                <label key={k} className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                  <input type="radio" name="mode" className="accent-[var(--color-brand)]" checked={r.mode === k} onChange={() => setR({ ...r, mode: k })} />{v}</label>))}
            </div>
            {r.mode === 'above' && <Field label="Limit (₹)"><input className="field mt-2" inputMode="decimal" value={r.limit} onChange={(e) => setR({ ...r, limit: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} /></Field>}
            <p className="mt-2 text-sm text-ink-muted">Approvers are staff whose role has "Approve expenses" (Institution Admin and Principal by default). Their own entries count as approved.</p>
            <button className="btn-primary mt-3 w-full" disabled={saveRules.isPending} onClick={() => saveRules.mutate()}>Save approval rule</button>
          </section>
          <section>
            <h3 className="label">Categories</h3>
            <ul className="divide-y divide-line rounded-lg border border-line">{cats.data?.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className={c.isActive ? '' : 'text-ink-muted line-through'}>{c.name}{c.isSystem && <span className="text-sm text-ink-muted"> · used by payroll</span>}</span>
                {!c.isSystem && <Toggle checked={c.isActive} label={`Use ${c.name}`} onChange={(v) => cat.mutate({ id: c.id, name: c.name, isActive: v })} />}
              </li>))}</ul>
            <div className="mt-2 flex gap-2"><input className="field" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn-quiet" disabled={name.trim().length < 2} onClick={() => cat.mutate({ name: name.trim() })}>Add</button></div>
          </section>
        </div>
      )}
    </Sheet>
  );
}

export default function ExpensesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const today = todayISO();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState(''); const [term, setTerm] = useState('');
  const [adding, setAdding] = useState(false); const [settings, setSettings] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const cats = useCategories();
  const params = { from, to, status: status || undefined, categoryId: categoryId || undefined, search: term || undefined };
  const q = useQuery({ queryKey: ['expenses', params], queryFn: () => api<ListData>('/expenses', { query: params as any }).then((r) => r.data) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['expenses'] });
  const decide = useMutation({ mutationFn: (v: { id: string; approve: boolean; note?: string }) => api(`/expenses/${v.id}/decide`, { method: 'POST', body: v }), onSuccess: (_d, v) => { toast.success(v.approve ? 'Approved' : 'Not approved'); refresh(); }, onError: err });
  const cancel = useMutation({ mutationFn: (v: { id: string; reason: string }) => api(`/expenses/${v.id}/cancel`, { method: 'POST', body: v }), onSuccess: () => { toast.success('Cancelled'); refresh(); }, onError: err });
  const attach = useMutation({ mutationFn: (v: { id: string; file: File }) => uploadFile(`/expenses/${v.id}/bill`, v.file), onSuccess: () => { toast.success('Bill attached'); refresh(); }, onError: err });
  const pickFor = useRef<string | null>(null); const fileRef = useRef<HTMLInputElement>(null);
  const addBtn = can('expenses.create') && <button className="btn-primary w-full sm:w-auto" onClick={() => setAdding(true)}><Plus size={18} aria-hidden />Add expense</button>;
  const d = q.data;
  return (
    <div>
      <PageHeader title="Expenses" description="School spending with bills, approvals and monthly totals."
        action={<div className="flex flex-wrap gap-2"><ExportButtons list="expenses" params={params} name={`expenses-${from}-to-${to}`} />
          {can('expenses.configure') && <button className="btn-quiet min-h-10 px-3 text-sm" onClick={() => setSettings(true)}><Settings2 size={16} aria-hidden />Settings</button>}{addBtn}</div>} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Field label="From"><input type="date" className="field" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className="field" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Status"><select className="field" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></Field>
        <Field label="Category"><select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">All</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <div className="relative col-span-2 self-end sm:min-w-64 sm:flex-1"><Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input className="field pl-10" placeholder="Paid to, voucher or details" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search expenses" /></div>
      </div>
      <div className="mb-3 flex flex-wrap gap-2 text-sm font-semibold text-brand">
        <button onClick={() => { setFrom(`${today.slice(0, 7)}-01`); setTo(today); }}>This month</button>
        <button onClick={() => { const p = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); p.setUTCDate(0); setFrom(`${p.toISOString().slice(0, 7)}-01`); setTo(p.toISOString().slice(0, 10)); }}>Last month</button>
        <button onClick={() => { setFrom(`${Number(today.slice(5, 7)) >= 4 ? today.slice(0, 4) : Number(today.slice(0, 4)) - 1}-04-01`); setTo(today); }}>Since 1 April</button>
      </div>
      {q.isLoading ? <Skeleton /> : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="panel p-4"><p className="text-sm text-ink-muted">Spent (approved)</p><p className="mt-1 text-2xl font-semibold tabular-nums">{inr(d!.total)}</p><p className="text-sm text-ink-muted">{fmt(d!.from)} to {fmt(d!.to)}</p></div>
            <div className="panel p-4"><p className="text-sm text-ink-muted">Waiting approval</p><p className="mt-1 text-2xl font-semibold tabular-nums">{inr(d!.pending)}</p><p className="text-sm text-ink-muted">{d!.pendingCount} in all</p></div>
            <div className="panel col-span-2 p-4"><p className="mb-1 text-sm text-ink-muted">Biggest categories</p>
              {d!.byCategory.length ? <ul className="space-y-0.5 text-sm">{d!.byCategory.slice(0, 4).map((c) => <li key={c.name} className="flex justify-between gap-3"><span>{c.name}</span><span className="tabular-nums">{inr(c.amount)}</span></li>)}</ul> : <p className="text-sm text-ink-muted">Nothing yet</p>}</div>
          </div>
          {!d!.rows.length ? <EmptyState title="No expenses in these dates" body="Add electricity bills, repairs, stationery and other spending as it happens." action={addBtn} /> : (
            <ul className="panel divide-y divide-line">{d!.rows.map((e) => (
              <li key={e.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{e.paidTo} <span className="font-normal text-ink-muted">· {e.category}</span></p>
                  <p className="font-semibold tabular-nums">{inr(e.amount)}</p>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-ink-muted">{fmt(e.date)} · {e.voucherNo} · {METHOD_LABEL[e.method] ?? e.method}{e.reference ? ` ${e.reference}` : ''} · by {e.createdBy}{e.decidedBy && e.status !== 'approved' ? ` · ${e.decidedBy}: ${e.decisionNote ?? ''}` : ''}</p>
                  <Badge tone={STATUS[e.status][1]}>{STATUS[e.status][0]}</Badge>
                </div>
                {e.description && <p className="text-sm text-ink-muted">{e.description}</p>}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-brand">
                  {e.canDecide && <><button onClick={() => decide.mutate({ id: e.id, approve: true })}>Approve</button>
                    <button onClick={() => { const note = prompt('Why not approved? (shown to the person who added it)'); if (note) decide.mutate({ id: e.id, approve: false, note }); }}>Do not approve</button></>}
                  {e.hasBill && <button onClick={() => openProtected(`/expenses/${e.id}/bill`).catch(err)}>View bill</button>}
                  {!e.hasBill && e.canAttach && <button onClick={() => { pickFor.current = e.id; fileRef.current?.click(); }}>Attach bill</button>}
                  {e.canCancel && <button className="text-danger" onClick={() => { const reason = prompt('Why cancel this entry? The voucher number is kept.'); if (reason) cancel.mutate({ id: e.id, reason }); }}>Cancel</button>}
                </div>
              </li>))}</ul>
          )}
        </>
      )}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={(ev) => { const file = ev.target.files?.[0]; if (file && pickFor.current) attach.mutate({ id: pickFor.current, file }); ev.target.value = ''; }} />
      {addBtn && <MobileAction>{addBtn}</MobileAction>}
      <AddSheet open={adding} onClose={() => setAdding(false)} />
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}
