import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, PackageMinus, PackagePlus, Plus, Search, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { api, ApiError, fieldErrors } from '../lib/api';
import { useAuth } from '../lib/auth';
import { inr, METHOD_LABEL, todayISO } from '../lib/fees';
import ExportButtons from '../components/ExportButtons';
import { Badge, EmptyState, ErrorState, Field, MobileAction, PageHeader, Sheet, Skeleton, Toggle } from '../components/ui';

export interface Item { id: number; name: string; category: string; unit: string; salePrice: number | null; trackStock: boolean; stock: number; lowStockAt: number | null; isActive: boolean; isLow: boolean }
interface ItemsData { items: Item[]; categories: string[]; lowCount: number }
export interface ItemSet { id: number; name: string; classId: number | null; className: string | null; price: number; isActive: boolean; itemsValue: number; available: number | null; lines: Array<{ itemId: number; name: string; unit: string; qty: number; stock: number; trackStock: boolean }> }
interface Move { id: number; kind: 'purchase' | 'issue' | 'sale' | 'sale_cancel' | 'adjust'; qty: number; date: string; amount: number | null; party: string | null; note: string | null; balance: number; by: string; voucherNo: string | null; expenseStatus: string | null; receiptNo: string | null }

const err = (e: unknown) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message);
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const num = (v: string) => v.replace(/[^0-9.]/g, '');
const q = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const KIND: Record<Move['kind'], string> = { purchase: 'Bought', issue: 'Given out', sale: 'Sold', sale_cancel: 'Sale cancelled', adjust: 'Count corrected' };
const UNITS = ['pcs', 'box', 'pack', 'set', 'ream', 'kg', 'litre', 'pair', 'dozen'];
export const useItems = (params: Record<string, any> = {}) => useQuery({ queryKey: ['inventory-items', params], queryFn: () => api<ItemsData>('/inventory/items', { query: params }).then((r) => r.data) });

function ItemSheet({ item, open, onClose, categories }: { item: Item | null; open: boolean; onClose: () => void; categories: string[] }) {
  const qc = useQueryClient();
  const blank = { name: '', category: '', unit: 'pcs', salePrice: '', trackStock: true, lowStockAt: '', openingQty: '', isActive: true, forSale: false };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setErrors({}); setF(item ? { name: item.name, category: item.category, unit: item.unit, salePrice: item.salePrice != null ? String(item.salePrice) : '', trackStock: item.trackStock,
    lowStockAt: item.lowStockAt != null ? String(item.lowStockAt) : '', openingQty: '', isActive: item.isActive, forSale: item.salePrice != null } : blank); } }, [open, item]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({ mutationFn: () => api(item ? `/inventory/items/${item.id}` : '/inventory/items', { method: item ? 'PATCH' : 'POST', body: {
    name: f.name, category: f.category, unit: f.unit, salePrice: f.forSale && f.salePrice !== '' ? Number(f.salePrice) : null, trackStock: f.trackStock,
    lowStockAt: f.trackStock && f.lowStockAt !== '' ? Number(f.lowStockAt) : null, isActive: f.isActive, openingQty: !item && f.trackStock && f.openingQty ? Number(f.openingQty) : null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-items'] }); qc.invalidateQueries({ queryKey: ['inventory-sets'] }); toast.success('Item saved'); onClose(); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(fe); if (!Object.keys(fe).length) err(e); } });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet open={open} onClose={onClose} title={item ? item.name : 'Add item'} footer={<button className="btn-primary w-full" disabled={m.isPending || (f.forSale && !(Number(f.salePrice) > 0))} onClick={() => m.mutate()}>Save item</button>}>
      <div className="space-y-4">
        <Field label="Item name" error={errors.name} hint="e.g. Telugu Reader Class 3, Shirt size 28, Chalk box"><input className="field" value={f.name} onChange={set('name')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" error={errors.category}><input className="field" list="item-cats" value={f.category} onChange={set('category')} placeholder="Books, Uniform…" />
            <datalist id="item-cats">{[...new Set([...categories, 'Books', 'Notebooks', 'Uniform', 'Stationery', 'Cleaning', 'Lab'])].map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="Unit"><select className="field" value={f.unit} onChange={set('unit')}>{[...new Set([f.unit, ...UNITS])].map((u) => <option key={u}>{u}</option>)}</select></Field>
        </div>
        <label className="flex items-center justify-between gap-3"><span><span className="font-medium">Sold to students</span><span className="block text-sm text-ink-muted">Books, uniforms, ID cards and other things parents pay for.</span></span>
          <Toggle checked={f.forSale} label="Sold to students" onChange={(v) => setF({ ...f, forSale: v })} /></label>
        {f.forSale && <Field label="Price (₹)" error={errors.salePrice}><input className="field" inputMode="decimal" value={f.salePrice} onChange={(e) => setF({ ...f, salePrice: num(e.target.value) })} /></Field>}
        <label className="flex items-center justify-between gap-3"><span><span className="font-medium">Count stock</span><span className="block text-sm text-ink-muted">Off for things you don't keep in store (e.g. ID cards printed on order).</span></span>
          <Toggle checked={f.trackStock} label="Count stock" onChange={(v) => setF({ ...f, trackStock: v })} /></label>
        {f.trackStock && <div className="grid grid-cols-2 gap-3">
          {!item && <Field label="Stock now" hint="Counted today"><input className="field" inputMode="decimal" value={f.openingQty} onChange={(e) => setF({ ...f, openingQty: num(e.target.value) })} /></Field>}
          <Field label="Alert when down to" hint="Leave empty for no alert"><input className="field" inputMode="decimal" value={f.lowStockAt} onChange={(e) => setF({ ...f, lowStockAt: num(e.target.value) })} /></Field>
        </div>}
        {item && <label className="flex items-center justify-between gap-3"><span className="font-medium">In use</span><Toggle checked={f.isActive} label="Item in use" onChange={(v) => setF({ ...f, isActive: v })} /></label>}
      </div>
    </Sheet>
  );
}

function MoveSheet({ item, kind, onClose }: { item: Item | null; kind: 'purchase' | 'issue' | 'adjust' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['expense-categories'], enabled: kind === 'purchase', queryFn: () => api<Array<{ id: number; name: string; isActive: boolean; isSystem: boolean }>>('/expenses/categories').then((r) => r.data).catch(() => []) });
  const { me } = useAuth();
  const canExpense = !!me?.features?.expenses && !!me?.permissions['expenses.create'];
  const blank = { qty: '', date: todayISO(), amount: '', party: '', note: '', asExpense: canExpense, categoryId: '', method: 'cash', reference: '' };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (kind) { setErrors({}); setF({ ...blank, qty: kind === 'adjust' && item ? String(item.stock) : '' }); } }, [kind, item]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (cats.data && !f.categoryId) { const c = cats.data.find((x) => x.name === 'Stationery & printing' && x.isActive) ?? cats.data.find((x) => x.isActive && !x.isSystem); if (c) setF((v) => ({ ...v, categoryId: String(c.id) })); } }, [cats.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({ mutationFn: () => api<{ voucherNo: string | null; expenseStatus: string | null }>('/inventory/movements', { method: 'POST', body: {
    itemId: item!.id, kind, qty: Number(f.qty), date: f.date, amount: f.amount ? Number(f.amount) : null, party: f.party || null, note: f.note || null,
    expense: kind === 'purchase' && f.asExpense && f.amount ? { categoryId: Number(f.categoryId), method: f.method, reference: f.reference || null } : null } }),
    onSuccess: ({ data }) => { qc.invalidateQueries({ queryKey: ['inventory-items'] }); qc.invalidateQueries({ queryKey: ['inventory-history'] }); qc.invalidateQueries({ queryKey: ['inventory-sets'] });
      toast.success(data.voucherNo ? `Stock updated, expense ${data.voucherNo}${data.expenseStatus === 'pending' ? ' waiting for approval' : ''}` : 'Stock updated'); onClose(); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(Object.keys(fe).length ? fe : { form: (e as ApiError).message }); } });
  if (!item || !kind) return null;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const title = { purchase: 'Stock in', issue: 'Give out', adjust: 'Correct the count' }[kind];
  return (
    <Sheet open onClose={onClose} title={`${title}: ${item.name}`} footer={<button className="btn-primary w-full" disabled={m.isPending || f.qty === ''} onClick={() => m.mutate()}>Save</button>}>
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">In stock now: <b className="text-ink">{q(item.stock)} {item.unit}</b></p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === 'adjust' ? `Counted (${item.unit})` : `Quantity (${item.unit})`} error={errors.qty}><input className="field" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: num(e.target.value) })} /></Field>
          <Field label="Date" error={errors.date}><input type="date" className="field" max={todayISO()} value={f.date} onChange={set('date')} /></Field>
        </div>
        {kind === 'purchase' && <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Supplier"><input className="field" value={f.party} onChange={set('party')} /></Field>
            <Field label="Amount paid (₹)" error={errors.amount}><input className="field" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: num(e.target.value) })} /></Field>
          </div>
          {canExpense && <label className="flex items-center justify-between gap-3"><span className="font-medium">Also save as an expense</span><Toggle checked={f.asExpense} label="Save as expense" onChange={(v) => setF({ ...f, asExpense: v })} /></label>}
          {canExpense && f.asExpense && <div className="grid grid-cols-2 gap-3">
            <Field label="Expense category" error={errors['expense.categoryId']}><select className="field" value={f.categoryId} onChange={set('categoryId')}>{cats.data?.filter((c) => c.isActive && !c.isSystem).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="How paid"><select className="field" value={f.method} onChange={set('method')}>{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </div>}
        </>}
        {kind === 'issue' && <Field label="Given to" error={errors.party} hint="Teacher, class or department"><input className="field" value={f.party} onChange={set('party')} /></Field>}
        <Field label="Note (optional)"><input className="field" value={f.note} onChange={set('note')} maxLength={255} /></Field>
        {errors.form && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger" role="alert">{errors.form}</p>}
      </div>
    </Sheet>
  );
}

function HistorySheet({ item, onClose, onEdit, onMove }: { item: Item | null; onClose: () => void; onEdit: () => void; onMove: (k: 'purchase' | 'issue' | 'adjust') => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const h = useQuery({ queryKey: ['inventory-history', item?.id], enabled: !!item, queryFn: () => api<Move[]>(`/inventory/items/${item!.id}/history`).then((r) => r.data) });
  const undo = useMutation({ mutationFn: (v: { id: number; reason: string }) => api(`/inventory/movements/${v.id}/undo`, { method: 'POST', body: { reason: v.reason } }),
    onSuccess: () => { toast.success('Purchase undone'); qc.invalidateQueries({ queryKey: ['inventory-items'] }); qc.invalidateQueries({ queryKey: ['inventory-history'] }); }, onError: err });
  if (!item) return null;
  const manage = can('inventory.manage');
  return (
    <Sheet open onClose={onClose} title={item.name}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p><span className="text-2xl font-semibold tabular-nums">{item.trackStock ? q(item.stock) : '-'}</span> <span className="text-ink-muted">{item.trackStock ? `${item.unit} in stock` : 'stock not counted'}</span></p>
          <p className="text-sm text-ink-muted">{item.category}{item.salePrice != null ? ` · sold at ${inr(item.salePrice)}` : ''}</p>
        </div>
        {manage && <div className="flex flex-wrap gap-2">
          {item.trackStock && <><button className="btn-quiet min-h-10 text-sm" onClick={() => onMove('purchase')}><PackagePlus size={16} aria-hidden />Stock in</button>
            <button className="btn-quiet min-h-10 text-sm" onClick={() => onMove('issue')}><PackageMinus size={16} aria-hidden />Give out</button>
            <button className="btn-quiet min-h-10 text-sm" onClick={() => onMove('adjust')}>Correct count</button></>}
          <button className="btn-quiet min-h-10 text-sm" onClick={onEdit}>Edit item</button>
        </div>}
        <section><h3 className="mb-2 font-semibold">History</h3>
          {h.isLoading ? <Skeleton rows={3} /> : !h.data?.length ? <p className="text-sm text-ink-muted">Nothing yet.</p> : (
            <ul className="divide-y divide-line rounded-lg border border-line">{h.data.map((m) => (
              <li key={m.id} className="px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{KIND[m.kind]} <span className={clsx('tabular-nums', m.qty < 0 ? 'text-danger' : 'text-brand')}>{m.qty > 0 ? '+' : ''}{q(m.qty)}</span></p>
                  <p className="text-sm tabular-nums text-ink-muted">left {q(m.balance)}</p>
                </div>
                <p className="text-sm text-ink-muted">{fmt(m.date)}{m.party ? ` · ${m.party}` : ''}{m.amount != null ? ` · ${inr(m.amount)}` : ''}{m.voucherNo ? ` · ${m.voucherNo}${m.expenseStatus === 'cancelled' ? ' (cancelled)' : ''}` : ''}{m.receiptNo ? ` · ${m.receiptNo}` : ''} · {m.by}</p>
                {m.note && <p className="text-sm text-ink-muted">{m.note}</p>}
                {manage && m.kind === 'purchase' && !(m.note ?? '').startsWith('[undone]') && (
                  <button className="mt-1 text-sm font-semibold text-danger" onClick={() => { const reason = prompt('Why undo this purchase? The stock is taken back out and its expense is cancelled.'); if (reason) undo.mutate({ id: m.id, reason }); }}>Undo purchase</button>)}
              </li>))}</ul>
          )}
        </section>
      </div>
    </Sheet>
  );
}

function ItemsTab() {
  const { can } = useAuth();
  const [search, setSearch] = useState(''); const [term, setTerm] = useState('');
  const [category, setCategory] = useState(''); const [low, setLow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const params = { search: term || undefined, category: category || undefined, low: low ? '1' : undefined };
  const r = useItems(params);
  const [open, setOpen] = useState<Item | null>(null);
  const [edit, setEdit] = useState<{ item: Item | null } | null>(null);
  const [move, setMove] = useState<{ item: Item; kind: 'purchase' | 'issue' | 'adjust' } | null>(null);
  const add = can('inventory.manage') && <button className="btn-primary w-full sm:w-auto" onClick={() => setEdit({ item: null })}><Plus size={18} aria-hidden />Add item</button>;
  const d = r.data;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative min-w-0 flex-1 sm:min-w-64"><Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input className="field pl-10" placeholder="Find an item" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find an item" /></div>
        <select className="field w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category"><option value="">All categories</option>{d?.categories.map((c) => <option key={c}>{c}</option>)}</select>
        <button aria-pressed={low} className={clsx('btn-quiet min-h-11 text-sm', low && 'border-brand text-brand')} onClick={() => setLow(!low)}><AlertTriangle size={16} aria-hidden />Low stock{d?.lowCount ? ` (${d.lowCount})` : ''}</button>
        <span className="flex gap-2 sm:ml-auto"><ExportButtons list="stock" params={{ category: category || undefined, low: low || undefined }} name={low ? 'low-stock' : 'stock'} /><span className="hidden sm:inline">{add}</span></span>
      </div>
      {r.isLoading ? <Skeleton /> : r.isError ? <ErrorState message={(r.error as Error).message} onRetry={() => r.refetch()} /> : !d!.items.length ? (
        <EmptyState title={low ? 'Nothing is low on stock' : 'No items yet'} body={low ? 'Items appear here when they fall to their alert level.' : 'Add books, uniforms, stationery, cleaning and lab items. Count today’s stock as you add them.'} action={low ? undefined : add} />
      ) : (
        <ul className="panel divide-y divide-line">{d!.items.map((i) => (
          <li key={i.id}>
            <button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-chalk" onClick={() => setOpen(i)}>
              <span className="min-w-0"><span className="block font-semibold">{i.name}</span>
                <span className="block text-sm text-ink-muted">{i.category}{i.salePrice != null ? ` · ${inr(i.salePrice)}` : ''}</span></span>
              <span className="flex shrink-0 items-center gap-2">
                {i.isLow && <Badge tone="danger">Low</Badge>}
                <span className="text-right"><span className="block font-semibold tabular-nums">{i.trackStock ? q(i.stock) : '-'}</span><span className="block text-xs text-ink-muted">{i.trackStock ? i.unit : 'not counted'}</span></span>
              </span>
            </button>
          </li>))}</ul>
      )}
      {add && <MobileAction>{add}</MobileAction>}
      <HistorySheet item={open ? d?.items.find((x) => x.id === open.id) ?? open : null} onClose={() => setOpen(null)} onEdit={() => { setEdit({ item: open }); setOpen(null); }} onMove={(kind) => { setMove({ item: open!, kind }); setOpen(null); }} />
      <ItemSheet item={edit?.item ?? null} open={!!edit} onClose={() => setEdit(null)} categories={d?.categories ?? []} />
      <MoveSheet item={move?.item ?? null} kind={move?.kind ?? null} onClose={() => setMove(null)} />
    </>
  );
}

function SetSheet({ set, open, onClose }: { set: ItemSet | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const items = useItems();
  const classes = useQuery({ queryKey: ['classes'], enabled: open, queryFn: () => api<Array<{ id: number; name: string }>>('/classes').then((r) => r.data) });
  const [f, setF] = useState({ name: '', classId: '', price: '', isActive: true });
  const [lines, setLines] = useState<Array<{ itemId: number; qty: string }>>([]);
  const [pick, setPick] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setErrors({}); setPick(''); setF(set ? { name: set.name, classId: set.classId ? String(set.classId) : '', price: String(set.price), isActive: set.isActive } : { name: '', classId: '', price: '', isActive: true });
    setLines(set ? set.lines.map((l) => ({ itemId: l.itemId, qty: q(l.qty) })) : []); } }, [open, set]);
  const byId = new Map((items.data?.items ?? []).map((i) => [i.id, i]));
  const value = lines.reduce((t, l) => t + (byId.get(l.itemId)?.salePrice ?? 0) * (Number(l.qty) || 0), 0);
  const m = useMutation({ mutationFn: () => api(set ? `/inventory/sets/${set.id}` : '/inventory/sets', { method: set ? 'PATCH' : 'POST', body: { name: f.name, classId: f.classId ? Number(f.classId) : null, price: Number(f.price), isActive: f.isActive, lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-sets'] }); toast.success('Set saved'); onClose(); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(fe); if (!Object.keys(fe).length) err(e); } });
  return (
    <Sheet open={open} onClose={onClose} title={set ? set.name : 'New book set'} footer={<button className="btn-primary w-full" disabled={m.isPending || !lines.length} onClick={() => m.mutate()}>Save set</button>}>
      <div className="space-y-4">
        <Field label="Set name" error={errors.name} hint="e.g. Class 5 book set"><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Class (optional)"><select className="field" value={f.classId} onChange={(e) => { const c = classes.data?.find((x) => String(x.id) === e.target.value); setF({ ...f, classId: e.target.value, name: f.name || (c ? `${c.name} book set` : '') }); }}>
            <option value="">Any class</option>{classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Set price (₹)" error={errors.price} hint={value ? `Items add up to ${inr(value)}` : undefined}><input className="field" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: num(e.target.value) })} /></Field>
        </div>
        <section>
          <h3 className="label">Items in the set</h3>
          {errors.lines && <p className="mb-2 text-sm text-danger">{errors.lines}</p>}
          <ul className="divide-y divide-line rounded-lg border border-line">{lines.map((l, i) => { const it = byId.get(l.itemId); return (
            <li key={l.itemId} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1"><span className="block truncate">{it?.name ?? `Item ${l.itemId}`}</span><span className="text-xs text-ink-muted">{it?.salePrice != null ? inr(it.salePrice) : 'no price'}{it?.trackStock ? ` · ${q(it.stock)} in stock` : ''}</span></span>
              <input className="field w-20" inputMode="decimal" aria-label={`Quantity of ${it?.name}`} value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: num(e.target.value) } : x)))} />
              <button className="rounded-md p-2 text-danger hover:bg-danger-soft" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={18} /></button>
            </li>); })}
            {!lines.length && <li className="px-3 py-3 text-sm text-ink-muted">Add the textbooks and notebooks for this class.</li>}</ul>
          <select className="field mt-2" value={pick} aria-label="Add an item" onChange={(e) => { const id = Number(e.target.value); if (id && !lines.some((l) => l.itemId === id)) setLines([...lines, { itemId: id, qty: '1' }]); setPick(''); }}>
            <option value="">+ Add an item…</option>{items.data?.items.filter((i) => !lines.some((l) => l.itemId === i.id)).map((i) => <option key={i.id} value={i.id}>{i.name}{i.salePrice != null ? ` · ${inr(i.salePrice)}` : ''}</option>)}</select>
        </section>
        {set && <label className="flex items-center justify-between gap-3"><span className="font-medium">On sale</span><Toggle checked={f.isActive} label="Set on sale" onChange={(v) => setF({ ...f, isActive: v })} /></label>}
      </div>
    </Sheet>
  );
}

function SetsTab() {
  const { can } = useAuth();
  const s = useQuery({ queryKey: ['inventory-sets'], queryFn: () => api<ItemSet[]>('/inventory/sets').then((r) => r.data) });
  const [edit, setEdit] = useState<{ set: ItemSet | null } | null>(null);
  const add = can('inventory.manage') && <button className="btn-primary w-full sm:w-auto" onClick={() => setEdit({ set: null })}><Plus size={18} aria-hidden />New book set</button>;
  if (s.isLoading) return <Skeleton />;
  if (s.isError) return <ErrorState message={(s.error as Error).message} onRetry={() => s.refetch()} />;
  return (
    <>
      <div className="mb-3 hidden items-center justify-between gap-3 sm:flex"><p className="text-sm text-ink-muted">A set is the list of books and notebooks a class buys at the start of the year, sold together at one price.</p>{add}</div>
      {!s.data!.length ? <EmptyState title="No book sets yet" body="Make one set per class with its textbooks and notebooks. Sell it in one tap at the counter." action={add} /> : (
        <ul className="grid gap-3 lg:grid-cols-2">{s.data!.map((x) => (
          <li key={x.id} className="min-w-0">
            <button className={clsx('panel block w-full p-4 text-left hover:border-brand/40', !x.isActive && 'opacity-60')} onClick={() => can('inventory.manage') && setEdit({ set: x })}>
              <div className="flex items-start justify-between gap-3"><p className="font-semibold">{x.name}</p><p className="font-semibold tabular-nums">{inr(x.price)}</p></div>
              <p className="mt-1 text-sm text-ink-muted">{x.lines.length} items{x.className ? ` · ${x.className}` : ''}{x.itemsValue && x.itemsValue !== x.price ? ` · items add up to ${inr(x.itemsValue)}` : ''}</p>
              <div className="mt-2 flex gap-2">{x.available != null && <Badge tone={x.available === 0 ? 'danger' : x.available < 10 ? 'attention' : 'brand'}>{x.available === 0 ? 'Out of stock' : `${x.available} can be made from stock`}</Badge>}{!x.isActive && <Badge>Not on sale</Badge>}</div>
            </button>
          </li>))}</ul>
      )}
      {add && <MobileAction>{add}</MobileAction>}
      <SetSheet set={edit?.set ?? null} open={!!edit} onClose={() => setEdit(null)} />
    </>
  );
}

export default function StockPage() {
  const [tab, setTab] = useState<'items' | 'sets'>('items');
  return (
    <div>
      <PageHeader title="Stock" description="Books, uniforms, stationery, cleaning and lab items: what came in, what went out, and what is running low." />
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-lg border border-line bg-chalk p-0.5 sm:inline-flex">
        {([['items', 'Items'], ['sets', 'Book sets']] as const).map(([k, label]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)} className={clsx('shrink-0 rounded-md px-4 py-2 text-sm font-semibold', tab === k ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted')}>{label}</button>)}
      </div>
      {tab === 'items' ? <ItemsTab /> : <SetsTab />}
    </div>
  );
}
