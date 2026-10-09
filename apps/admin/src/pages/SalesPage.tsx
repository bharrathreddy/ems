import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Minus, Plus, Search, ShoppingBag, X } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fullName } from '../lib/academics';
import { inr, METHOD_LABEL, todayISO } from '../lib/fees';
import { openProtected } from '../lib/payroll';
import ExportButtons from '../components/ExportButtons';
import { Badge, EmptyState, ErrorState, Field, PageHeader, Skeleton } from '../components/ui';
import { StudentPicker } from './CollectPage';
import { useItems, type ItemSet } from './StockPage';
import type { StudentRow } from './StudentsPage';

interface SaleRow { id: string; receiptNo: string; date: string; total: number; method: string; reference: string | null; status: 'active' | 'cancelled'; cancelReason: string | null; buyer: string; admissionNo: string | null; className: string | null; by: string; items: string }
interface SalesData { from: string; to: string; rows: SaleRow[]; total: number; count: number; byMethod: Array<{ method: string; amount: number }> }
type Line = { key: string; itemId?: number; setId?: number; label: string; price: number; qty: number; stock: number | null };

const err = (e: unknown) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message);
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function NewSale({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [student, setStudent] = useState<StudentRow | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const [buyer, setBuyer] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [method, setMethod] = useState('cash');
  const [ref, setRef] = useState('');
  const [date, setDate] = useState(todayISO());
  const [find, setFind] = useState('');
  const [done, setDone] = useState<{ id: string; receiptNo: string; total: number } | null>(null);
  const items = useItems({ forSale: '1' });
  const sets = useQuery({ queryKey: ['inventory-sets'], queryFn: () => api<ItemSet[]>('/inventory/sets').then((r) => r.data) });
  const activeSets = (sets.data ?? []).filter((s) => s.isActive);
  // The student's own class set first.
  const classSets = useMemo(() => activeSets.filter((s) => student && s.className && student.class_name === s.className), [activeSets, student]);
  const add = (l: Omit<Line, 'qty'>) => setLines((ls) => (ls.some((x) => x.key === l.key) ? ls.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)) : [...ls, { ...l, qty: 1 }]));
  const addSet = (s: ItemSet) => add({ key: `s${s.id}`, setId: s.id, label: s.name, price: s.price, stock: s.available });
  const total = lines.reduce((t, l) => t + l.price * l.qty, 0);
  const term = find.trim().toLowerCase();
  const matches = term.length >= 1 ? (items.data?.items ?? []).filter((i) => i.name.toLowerCase().includes(term) || i.category.toLowerCase().includes(term)).slice(0, 8) : [];
  const reset = () => { setStudent(null); setWalkIn(false); setBuyer(''); setLines([]); setRef(''); setMethod('cash'); setFind(''); };
  const m = useMutation({ mutationFn: () => api<{ id: string; receiptNo: string; total: number }>('/sales', { method: 'POST', body: {
    studentId: student?.public_id ?? null, buyerName: student ? null : buyer.trim() || null, date, method, reference: ref || null, lines: lines.map((l) => ({ itemId: l.itemId ?? null, setId: l.setId ?? null, qty: l.qty })) } }),
    onSuccess: ({ data }) => { setDone(data); reset(); qc.invalidateQueries({ queryKey: ['sales'] }); qc.invalidateQueries({ queryKey: ['inventory-items'] }); qc.invalidateQueries({ queryKey: ['inventory-sets'] }); onDone(); }, onError: err });

  if (done) return (
    <div className="panel mx-auto max-w-lg p-6 text-center">
      <CheckCircle2 size={40} className="mx-auto text-brand" aria-hidden />
      <p className="mt-3 text-lg font-semibold">{inr(done.total)} received</p>
      <p className="text-ink-muted">Receipt {done.receiptNo}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button className="btn-quiet" onClick={() => openProtected(`/sales/${done.id}/pdf`).catch(err)}>Open receipt</button>
        <button className="btn-primary" onClick={() => setDone(null)}>Next sale</button>
      </div>
    </div>
  );
  const who = student || (walkIn && buyer.trim().length >= 2);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <section className="panel p-4">
          <h2 className="mb-3 font-semibold">1. Who is buying</h2>
          {student ? (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-brand-soft px-3 py-2.5">
              <span><span className="block font-semibold">{fullName(student)}</span><span className="text-sm text-ink-muted">{student.class_name} {student.section_name} · Adm {student.admission_no}</span></span>
              <button className="rounded-md p-2 text-ink-muted hover:bg-surface" onClick={() => setStudent(null)} aria-label="Change student"><X size={18} /></button>
            </div>
          ) : walkIn ? (
            <div className="flex gap-2"><input className="field" autoFocus placeholder="Buyer's name" value={buyer} onChange={(e) => setBuyer(e.target.value)} aria-label="Buyer's name" />
              <button className="btn-quiet" onClick={() => setWalkIn(false)}>Student</button></div>
          ) : (
            <><StudentPicker onPick={(_id, row) => setStudent(row)} placeholder="Student name, admission no or parent mobile" />
              <button className="mt-2 text-sm font-semibold text-brand" onClick={() => setWalkIn(true)}>Not a current student? Type a name</button></>
          )}
        </section>
        <section className="panel p-4">
          <h2 className="mb-3 font-semibold">2. What they are buying</h2>
          {activeSets.length > 0 && <div className="mb-4">
            <p className="label">Book sets</p>
            <div className="flex flex-wrap gap-2">{[...classSets, ...activeSets.filter((s) => !classSets.includes(s))].map((s) => (
              <button key={s.id} className={clsx('rounded-lg border px-3 py-2 text-left text-sm', classSets.includes(s) ? 'border-brand bg-brand-soft' : 'border-line hover:bg-chalk', s.available === 0 && 'opacity-50')} disabled={s.available === 0} onClick={() => addSet(s)}>
                <span className="block font-semibold">{s.name}</span><span className="text-ink-muted">{inr(s.price)}{s.available === 0 ? ' · out of stock' : ''}</span></button>))}</div>
          </div>}
          <p className="label">Single items</p>
          <div className="relative"><Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />
            <input className="field pl-10" placeholder="Type a book, uniform or item name" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find an item" /></div>
          {matches.length > 0 && <ul className="mt-2 divide-y divide-line rounded-lg border border-line">{matches.map((i) => (
            <li key={i.id}><button className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-chalk disabled:opacity-50" disabled={i.trackStock && i.stock <= 0}
              onClick={() => { add({ key: `i${i.id}`, itemId: i.id, label: i.name, price: i.salePrice ?? 0, stock: i.trackStock ? i.stock : null }); setFind(''); }}>
              <span><span className="block font-medium">{i.name}</span><span className="text-sm text-ink-muted">{i.category}{i.trackStock ? ` · ${i.stock} in stock` : ''}</span></span>
              <span className="font-semibold tabular-nums">{inr(i.salePrice)}</span></button></li>))}</ul>}
          {term && !matches.length && items.isSuccess && <p className="mt-2 text-sm text-ink-muted">No item for sale matches. Add it in Stock with a price.</p>}
        </section>
      </div>
      <aside className="panel h-fit p-4 lg:sticky lg:top-4">
        <h2 className="mb-3 font-semibold">3. Bill</h2>
        {!lines.length ? <p className="text-sm text-ink-muted">Nothing added yet.</p> : (
          <ul className="divide-y divide-line">{lines.map((l) => (
            <li key={l.key} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{l.label}</span><span className="text-sm text-ink-muted">{inr(l.price)} each</span></span>
              <span className="flex items-center gap-1">
                <button className="rounded-md border border-line p-1.5" aria-label={`One less ${l.label}`} onClick={() => setLines(lines.flatMap((x) => (x.key !== l.key ? [x] : x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : [])))}><Minus size={14} /></button>
                <span className="w-7 text-center tabular-nums">{l.qty}</span>
                <button className="rounded-md border border-line p-1.5 disabled:opacity-40" disabled={l.stock != null && l.qty >= l.stock} aria-label={`One more ${l.label}`} onClick={() => setLines(lines.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)))}><Plus size={14} /></button>
              </span>
              <span className="w-20 text-right font-semibold tabular-nums">{inr(l.price * l.qty)}</span>
            </li>))}</ul>
        )}
        <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3"><span className="font-semibold">Total</span><span className="text-2xl font-semibold tabular-nums">{inr(total)}</span></div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Paid by"><select className="field" value={method} onChange={(e) => setMethod(e.target.value)}>{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Date"><input type="date" className="field" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {method !== 'cash' && <div className="mt-3"><Field label="Reference (UPI / cheque no)"><input className="field" value={ref} onChange={(e) => setRef(e.target.value)} /></Field></div>}
        <button className="btn-primary mt-4 w-full" disabled={!who || !lines.length || m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Saving…' : `Receive ${inr(total)}`}</button>
        {!who && lines.length > 0 && <p className="mt-2 text-center text-sm text-ink-muted">Choose the student first.</p>}
      </aside>
    </div>
  );
}

function SalesList() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const today = todayISO();
  const [from, setFrom] = useState(today); const [to, setTo] = useState(today);
  const [search, setSearch] = useState(''); const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const params = { from, to, search: term || undefined };
  const q = useQuery({ queryKey: ['sales', params], queryFn: () => api<SalesData>('/sales', { query: params as any }).then((r) => r.data) });
  const cancel = useMutation({ mutationFn: (v: { id: string; reason: string }) => api(`/sales/${v.id}/cancel`, { method: 'POST', body: { reason: v.reason } }),
    onSuccess: () => { toast.success('Sale cancelled, stock put back'); qc.invalidateQueries({ queryKey: ['sales'] }); qc.invalidateQueries({ queryKey: ['inventory-items'] }); }, onError: err });
  const d = q.data;
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        <Field label="From"><input type="date" className="field" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className="field" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="relative col-span-2 sm:min-w-64 sm:flex-1"><Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input className="field pl-10" placeholder="Receipt no, student or admission no" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search sales" /></div>
        <span className="col-span-2"><ExportButtons list="sales" params={params} name={`sales-${from}-to-${to}`} /></span>
      </div>
      {q.isLoading ? <Skeleton /> : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="panel p-4"><p className="text-sm text-ink-muted">Received</p><p className="mt-1 text-2xl font-semibold tabular-nums">{inr(d!.total)}</p><p className="text-sm text-ink-muted">{d!.count} receipt{d!.count === 1 ? '' : 's'}</p></div>
            <div className="panel p-4"><p className="mb-1 text-sm text-ink-muted">By method</p>{d!.byMethod.length ? <ul className="space-y-0.5 text-sm">{d!.byMethod.map((x) => <li key={x.method} className="flex justify-between gap-2"><span>{METHOD_LABEL[x.method] ?? x.method}</span><span className="tabular-nums">{inr(x.amount)}</span></li>)}</ul> : <p className="text-sm text-ink-muted">Nothing yet</p>}</div>
          </div>
          {!d!.rows.length ? <EmptyState title="No sales in these dates" body="Sales of books, uniforms and other items appear here with their receipts." /> : (
            <ul className="panel divide-y divide-line">{d!.rows.map((s) => (
              <li key={s.id} className={clsx('px-4 py-3', s.status === 'cancelled' && 'opacity-60')}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{s.buyer}{s.className ? <span className="font-normal text-ink-muted"> · {s.className}</span> : ''}</p>
                  <p className="font-semibold tabular-nums">{inr(s.total)}</p>
                </div>
                <p className="text-sm text-ink-muted">{s.items}</p>
                <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-ink-muted">{fmt(s.date)} · {s.receiptNo} · {METHOD_LABEL[s.method] ?? s.method}{s.reference ? ` ${s.reference}` : ''} · by {s.by}</p>
                  {s.status === 'cancelled' && <Badge>Cancelled</Badge>}
                </div>
                {s.status === 'cancelled' && s.cancelReason && <p className="text-sm text-ink-muted">Cancelled: {s.cancelReason}</p>}
                <div className="mt-1.5 flex gap-4 text-sm font-semibold text-brand">
                  <button onClick={() => openProtected(`/sales/${s.id}/pdf`).catch(err)}>Receipt</button>
                  {s.status === 'active' && can('inventory.manage') && <button className="text-danger" onClick={() => { const reason = prompt('Why cancel this sale? The receipt number is kept and the stock is put back.'); if (reason) cancel.mutate({ id: s.id, reason }); }}>Cancel sale</button>}
                </div>
              </li>))}</ul>
          )}
        </>
      )}
    </>
  );
}

export default function SalesPage() {
  const [tab, setTab] = useState<'new' | 'list'>('new');
  return (
    <div>
      <PageHeader title="Sales counter" description="Sell book sets, uniforms and other items. Paid at the counter with a receipt; stock goes down by itself." />
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-lg border border-line bg-chalk p-0.5 sm:inline-flex">
        {([['new', 'New sale', ShoppingBag], ['list', 'Sales and receipts', null]] as const).map(([k, label]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)} className={clsx('shrink-0 rounded-md px-4 py-2 text-sm font-semibold', tab === k ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted')}>{label}</button>)}
      </div>
      {tab === 'new' ? <NewSale onDone={() => undefined} /> : <SalesList />}
    </div>
  );
}
