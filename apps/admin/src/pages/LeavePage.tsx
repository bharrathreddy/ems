import { useState } from 'react';
import ExportButtons from '../components/ExportButtons';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { todayLocal } from '../lib/attendance';
import { Badge, EmptyState, Field, PageHeader, Skeleton } from '../components/ui';

export interface Leave { id: number; kind: 'student' | 'staff'; startDate: string; endDate: string; reason: string; status: string; decisionNote: string | null; decidedBy: string | null;
  who: string; studentId: string | null; className: string | null; requestedBy: string; mine: boolean; canDecide: boolean; leaveType?: string | null; unpaid?: boolean }
interface Balance { id: number; code: string; name: string; isPaid: boolean; allowed: number | null; used: number; pending: number; left: number | null }
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const range = (l: { startDate: string; endDate: string }) => `${fmt(l.startDate)}${l.endDate !== l.startDate ? ` to ${fmt(l.endDate)}` : ''}`;
export const STATUS_TONE: Record<string, 'brand' | 'attention' | 'danger' | 'neutral'> = { approved: 'brand', pending: 'attention', rejected: 'danger', cancelled: 'neutral' };
const STATUS_LABEL: Record<string, string> = { approved: 'Approved', pending: 'Waiting', rejected: 'Not approved', cancelled: 'Cancelled' };

export function LeaveForm({ path, onDone, allowPast, withTypes }: { path: string; onDone: () => void; allowPast?: boolean; withTypes?: boolean }) {
  const [f, setF] = useState({ startDate: todayLocal(), endDate: todayLocal(), reason: '', leaveTypeId: '' });
  const bal = useQuery({ queryKey: ['my-leave-balances'], enabled: !!withTypes, queryFn: () => api<{ enabled: boolean; year?: string; types: Balance[] }>('/leave-balances/mine').then((r) => r.data) });
  const types = bal.data?.enabled ? bal.data.types : [];
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => api(path, { method: 'POST', body: { startDate: f.startDate, endDate: f.endDate, reason: f.reason, ...(types.length ? { leaveTypeId: Number(f.leaveTypeId) || null } : {}) } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['my-leave-balances'] }), onSuccess: () => { toast.success('Leave request sent'); setF({ ...f, reason: '' }); onDone(); },
    onError: (e) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message) });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="From"><input type="date" className="field" min={allowPast ? undefined : todayLocal()} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate })} /></Field>
        <Field label="To"><input type="date" className="field" min={f.startDate} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
      </div>
      {types.length > 0 && <Field label="Type of leave"><select className="field" value={f.leaveTypeId} onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })}>
        <option value="">Choose…</option>{types.map((t) => <option key={t.id} value={t.id} disabled={t.left === 0}>{t.name}{t.left != null ? ` (${t.left} left)` : ''}{!t.isPaid ? ' · unpaid' : ''}</option>)}</select></Field>}
      <Field label="Reason"><textarea className="field min-h-20" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <button className="btn-primary w-full" disabled={m.isPending || f.reason.trim().length < 3 || (types.length > 0 && !f.leaveTypeId)} onClick={() => m.mutate()}>{m.isPending ? 'Sending…' : 'Send leave request'}</button>
    </div>
  );
}

export function LeaveList({ rows, onChange }: { rows: Leave[]; onChange: () => void }) {
  const decide = useMutation({ mutationFn: (v: { id: number; approve: boolean; note?: string }) => api(`/leave-requests/${v.id}/decide`, { method: 'POST', body: v }), onSuccess: (_, v) => { toast.success(v.approve ? 'Approved' : 'Not approved'); onChange(); }, onError: (e) => toast.error((e as ApiError).message) });
  const cancel = useMutation({ mutationFn: (id: number) => api(`/leave-requests/${id}/cancel`, { method: 'POST' }), onSuccess: onChange });
  if (!rows.length) return <EmptyState title="No leave requests" body="" />;
  return (
    <ul className="panel divide-y divide-line">{rows.map((l) => (
      <li key={l.id} className="px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">{l.studentId ? <Link to={`/students/${l.studentId}`}>{l.who}</Link> : l.who}{l.className && <span className="font-normal text-ink-muted"> · {l.className}</span>}</p>
          <span className="flex gap-1.5">{l.unpaid && <Badge tone="danger">Unpaid</Badge>}<Badge tone={STATUS_TONE[l.status]}>{STATUS_LABEL[l.status]}</Badge></span>
        </div>
        <p className="text-sm text-ink-muted">{range(l)}{l.leaveType ? ` · ${l.leaveType}` : ''} · {l.reason}{!l.mine ? ` · asked by ${l.requestedBy}` : ''}</p>
        {l.decisionNote && <p className="text-sm text-ink-muted">{l.decidedBy}: {l.decisionNote}</p>}
        {(l.canDecide || (l.mine && l.status === 'pending')) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {l.canDecide && <><button className="btn-primary min-h-9 text-sm" onClick={() => decide.mutate({ id: l.id, approve: true })}>Approve</button>
              <button className="btn-quiet min-h-9 text-sm" onClick={() => { const note = prompt('Reason for not approving (shown to them):'); if (note !== null) decide.mutate({ id: l.id, approve: false, note }); }}>Do not approve</button></>}
            {l.mine && l.status === 'pending' && <button className="btn-quiet min-h-9 text-sm" onClick={() => cancel.mutate(l.id)}>Cancel request</button>}
          </div>
        )}
      </li>))}</ul>
  );
}

export default function LeavePage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['leave'], queryFn: () => api<Leave[]>('/leave-requests').then((r) => r.data) });
  const { can } = useAuth();
  const [tab, setTab] = useState<'decide' | 'mine' | 'balances'>('decide');
  const refresh = () => qc.invalidateQueries({ queryKey: ['leave'] });
  if (q.isLoading) return <Skeleton rows={4} />;
  const toDecide = q.data!.filter((l) => !l.mine);
  const mine = q.data!.filter((l) => l.mine);
  const isStaffMember = me?.workspace === 'staff';
  return (
    <div className="max-w-3xl">
      <PageHeader title="Leave requests" action={<ExportButtons list="leave" name="leave-requests" />} />
      <div className="mb-4 inline-flex rounded-lg border border-line bg-chalk p-0.5">
        {([['decide', `To review${toDecide.filter((l) => l.canDecide).length ? ` (${toDecide.filter((l) => l.canDecide).length})` : ''}`], ['mine', 'My leave'], ...(can('hr.view') ? [['balances', 'Balances & types']] : [])] as Array<[typeof tab, string]>).map(([k, label]) =>
          <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)} className={clsx('rounded-md px-4 py-2 text-sm font-semibold', tab === k ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted')}>{label}</button>)}
      </div>
      {tab === 'balances' ? <BalancesTab /> : tab === 'decide' ? <LeaveList rows={toDecide} onChange={refresh} /> : (
        <div className="space-y-4">
          {isStaffMember && <section className="panel p-5"><h2 className="mb-3 font-semibold">Apply for leave</h2><LeaveForm path="/leave-requests/mine" onDone={refresh} withTypes /></section>}
          <LeaveList rows={mine} onChange={refresh} />
        </div>
      )}
    </div>
  );
}

interface LeaveType { id: number; code: string; name: string; daysPerYear: number | null; isPaid: boolean; isActive: boolean; sortOrder: number; inUse: boolean }

function TypeRow({ t, onSaved }: { t: LeaveType | null; onSaved: (rows: LeaveType[]) => void }) {
  const [f, setF] = useState({ code: t?.code ?? '', name: t?.name ?? '', days: t?.daysPerYear == null ? '' : String(t.daysPerYear), isPaid: t?.isPaid ?? true, isActive: t?.isActive ?? true });
  const m = useMutation({ mutationFn: () => api<LeaveType[]>(t ? `/hr/leave-types/${t.id}` : '/hr/leave-types', { method: t ? 'PATCH' : 'POST', body: { code: f.code, name: f.name, daysPerYear: f.days === '' ? null : Number(f.days), isPaid: f.isPaid, isActive: f.isActive, sortOrder: t?.sortOrder ?? 50 } }),
    onSuccess: ({ data }) => { toast.success('Saved'); onSaved(data); if (!t) setF({ code: '', name: '', days: '', isPaid: true, isActive: true }); }, onError: (e) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message) });
  return (
    <li className="grid grid-cols-[4.5rem_1fr_5.5rem] items-end gap-2 px-3 py-3 sm:grid-cols-[4.5rem_1fr_6rem_auto_auto_auto]">
      <Field label="Code"><input className="field uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
      <Field label="Name"><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Earned leave" /></Field>
      <Field label="Days a year"><input className="field" inputMode="decimal" placeholder="No limit" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value.replace(/[^0-9.]/g, '') })} /></Field>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--color-brand)]" checked={f.isPaid} onChange={(e) => setF({ ...f, isPaid: e.target.checked })} />Paid</label>
      {t && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--color-brand)]" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />In use</label>}
      <button className="btn-quiet min-h-11 text-sm" disabled={m.isPending || f.code.trim().length < 1 || f.name.trim().length < 2} onClick={() => m.mutate()}>{t ? 'Save' : 'Add'}</button>
    </li>
  );
}

function BalancesTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const b = useQuery({ queryKey: ['leave-balances-all'], queryFn: () => api<{ year: string; types: LeaveType[]; staff: Array<{ id: string; code: string; name: string; designation: string | null; balances: Balance[] }> }>('/hr/leave-balances').then((r) => r.data) });
  const types = useQuery({ queryKey: ['leave-types'], queryFn: () => api<LeaveType[]>('/hr/leave-types').then((r) => r.data) });
  const saved = (rows: LeaveType[]) => { qc.setQueryData(['leave-types'], rows); qc.invalidateQueries({ queryKey: ['leave-balances-all'] }); };
  if (b.isLoading) return <Skeleton rows={4} />;
  const d = b.data!;
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 font-semibold">Leave taken in {d.year}</h2>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[15px]">
            <thead className="border-b border-line text-sm text-ink-muted"><tr><th className="px-4 py-3 font-medium">Staff</th>{d.types.map((t) => <th key={t.id} className="px-3 py-3 text-right font-medium">{t.name}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{d.staff.map((s) => (
              <tr key={s.id}><td className="px-4 py-2.5"><span className="font-semibold">{s.name}</span><span className="block text-sm text-ink-muted">{s.code}{s.designation ? ` · ${s.designation}` : ''}</span></td>
                {d.types.map((t) => { const x = s.balances.find((y) => y.id === t.id); return <td key={t.id} className="px-3 py-2.5 text-right tabular-nums">{x ? `${x.used}${x.allowed != null ? ` / ${x.allowed}` : ''}` : '-'}{x?.pending ? <span className="block text-xs text-ink-muted">{x.pending} waiting</span> : null}</td>; })}</tr>))}</tbody>
          </table>
        </div>
        <p className="mt-2 text-sm text-ink-muted">Used / allowed this academic year, in working days. Allowances start fresh every year.</p>
      </section>
      {can('hr.manage') && (
        <section>
          <h2 className="mb-2 font-semibold">Leave types</h2>
          <ul className="panel divide-y divide-line">
            {types.data?.map((t) => <TypeRow key={t.id} t={t} onSaved={saved} />)}
            <TypeRow t={null} onSaved={saved} />
          </ul>
          <p className="mt-2 text-sm text-ink-muted">Leave a "Days a year" box empty for no limit. Unpaid leave days are suggested as loss of pay in payroll.</p>
        </section>
      )}
    </div>
  );
}
