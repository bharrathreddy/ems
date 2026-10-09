import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, fieldErrors } from '../lib/api';
import { useAuth } from '../lib/auth';
import { inr, type StudentFees } from '../lib/fees';
import { EmptyState, ErrorState, Field, Sheet, Skeleton } from './ui';
import { FeeItemsList, FeeTotals, ReceiptList } from './FeeParts';

interface SetupLite { routes: Array<{ id: number; name: string; is_active: number; fee: null | { amount: string } }>; concessionTypes: Array<{ id: number; name: string }> }

function AccountSheet({ studentId, f, open, onClose }: { studentId: string; f: StudentFees; open: boolean; onClose: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const setup = useQuery({ queryKey: ['fee-setup'], enabled: open, queryFn: () => api<SetupLite>('/fees/setup').then((r) => r.data) });
  const a = f.account!;
  const init = () => ({ planKey: a.plan_key, busRouteId: a.bus_route_id ? String(a.bus_route_id) : '', tuitionDiscount: String(Number(a.tuition_discount) || ''),
    tuitionConcessionTypeId: a.tuition_concession_type_id ? String(a.tuition_concession_type_id) : '', busDiscount: String(Number(a.bus_discount) || ''),
    busConcessionTypeId: a.bus_concession_type_id ? String(a.bus_concession_type_id) : '' });
  const [v, setV] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setV(init()); setErrors({}); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (can('fees.configure')) {
        if (a.plan_change_allowed && v.planKey !== a.plan_key) body.planKey = v.planKey;
        body.busRouteId = v.busRouteId ? Number(v.busRouteId) : null;
      }
      if (can('fees.discount')) {
        body.tuitionDiscount = Number(v.tuitionDiscount) || 0; body.busDiscount = v.busRouteId ? Number(v.busDiscount) || 0 : 0;
        body.tuitionConcessionTypeId = v.tuitionConcessionTypeId ? Number(v.tuitionConcessionTypeId) : null;
        body.busConcessionTypeId = v.busConcessionTypeId ? Number(v.busConcessionTypeId) : null;
      }
      return api(`/students/${studentId}/fee-account`, { method: 'PATCH', body });
    },
    onSuccess: () => { toast.success('Fee details saved'); qc.invalidateQueries({ queryKey: ['fees', studentId] }); onClose(); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(Object.keys(fe).length ? fe : { form: (e as ApiError).message }); },
  });
  const set = (k: keyof ReturnType<typeof init>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const net = Number(a.tuition_gross) - (Number(v.tuitionDiscount) || 0);
  return (
    <Sheet open={open} onClose={onClose} title="Fee details" footer={<button className="btn-primary w-full" disabled={m.isPending} onClick={() => { setErrors({}); m.mutate(); }}>{m.isPending ? 'Saving…' : 'Save'}</button>}>
      <div className="space-y-4">
        <p className="rounded-lg bg-tangedu-soft px-3 py-2.5 text-sm text-[#7A5A00]">These details lock after the first payment this year, so check them before collecting.</p>
        <Field label="Plan" hint={a.plan_change_allowed ? undefined : 'Locked: the academic year has started.'}>
          <select className="field" value={v.planKey} onChange={set('planKey')} disabled={!a.plan_change_allowed || !can('fees.configure')}>
            <option value="yearly">Yearly (1 installment)</option><option value="half_yearly">Half-yearly (2)</option><option value="quarterly">Quarterly (4)</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tuition discount (₹)" error={errors.tuitionDiscount} hint={`Fee ${inr(a.tuition_gross)} → ${inr(Math.max(net, 0))}`}>
            <input className="field tabular-nums" inputMode="numeric" value={v.tuitionDiscount} disabled={!can('fees.discount')} onChange={(e) => setV({ ...v, tuitionDiscount: e.target.value.replace(/[^\d]/g, '') })} /></Field>
          <Field label="Concession type">
            <select className="field" value={v.tuitionConcessionTypeId} onChange={set('tuitionConcessionTypeId')} disabled={!can('fees.discount')}>
              <option value="">None</option>{setup.data?.concessionTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></Field>
        </div>
        <Field label="Bus route" error={errors.busRouteId}>
          <select className="field" value={v.busRouteId} onChange={set('busRouteId')} disabled={!can('fees.configure')}>
            <option value="">No bus</option>{setup.data?.routes.filter((r) => r.is_active).map((r) => <option key={r.id} value={r.id}>{r.name}{r.fee ? ` · ${inr(r.fee.amount)}` : ' · fee not set'}</option>)}
          </select></Field>
        {v.busRouteId && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bus discount (₹)" error={errors.busDiscount}><input className="field tabular-nums" inputMode="numeric" value={v.busDiscount} disabled={!can('fees.discount')} onChange={(e) => setV({ ...v, busDiscount: e.target.value.replace(/[^\d]/g, '') })} /></Field>
            <Field label="Concession type">
              <select className="field" value={v.busConcessionTypeId} onChange={set('busConcessionTypeId')} disabled={!can('fees.discount')}>
                <option value="">None</option>{setup.data?.concessionTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></Field>
          </div>
        )}
        {errors.form && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger" role="alert">{errors.form}</p>}
      </div>
    </Sheet>
  );
}

export default function FeesTab({ studentId, studentName }: { studentId: string; studentName: string }) {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const staff = me?.workspace === 'staff';
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['fees', studentId], queryFn: () => api<StudentFees>(`/students/${studentId}/fees`).then((r) => r.data) });
  const voidIt = useMutation({
    mutationFn: (v: { id: string; reason: string }) => api(`/payments/${v.id}/void`, { method: 'POST', body: { reason: v.reason } }),
    onSuccess: () => { toast.success('Receipt voided'); qc.invalidateQueries({ queryKey: ['fees', studentId] }); },
    onError: (e) => toast.error((e as ApiError).message),
  });
  const isAdmin = !!me?.user.isSuperAdmin || me?.permissions['roles.configure'] === 'all';
  const waive = useMutation({
    mutationFn: (v: { academicYearId: number; amount: number; reason: string }) => api(`/students/${studentId}/waivers`, { method: 'POST', body: v }),
    onSuccess: () => { toast.success('Waiver recorded'); qc.invalidateQueries({ queryKey: ['fees', studentId] }); },
    onError: (e) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message),
  });
  const unlock = useMutation({
    mutationFn: () => api(`/students/${studentId}/fee-account/unlock`, { method: 'POST' }),
    onSuccess: () => { toast.success('Fee details unlocked'); qc.invalidateQueries({ queryKey: ['fees', studentId] }); },
    onError: (e) => toast.error((e as ApiError).message),
  });
  if (q.isLoading) return <Skeleton rows={4} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  const f = q.data!;
  if (!f.configured && !f.items.length) return <EmptyState title="Fees not set up" body={staff ? 'Set the default plan and this class\'s tuition fee in Fee setup.' : 'The school has not published fees for this year yet.'}
    action={staff && can('fees.configure') ? <Link to="/fees/setup" className="btn-primary">Open fee setup</Link> : undefined} />;
  const a = f.account;
  const canEdit = staff && a && !a.details_locked && (can('fees.configure') || can('fees.discount'));
  return (
    <div className="space-y-4">
      <FeeTotals fees={f} />
      {staff && can('payments.collect') && f.totals.totalDue > 0 && <Link to={`/fees/collect?student=${studentId}`} className="btn-primary w-full sm:w-auto"><Wallet size={18} aria-hidden />Collect fee</Link>}
      {a && (
        <section className="panel p-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="font-semibold">{a.plan_name} plan · {a.year}</h2>
            {canEdit ? <button className="btn-quiet min-h-9 text-sm" onClick={() => setEditing(true)}><Pencil size={14} aria-hidden />Edit</button>
              : staff && a.details_locked ? <span className="inline-flex items-center gap-1 text-sm text-ink-muted"><Lock size={14} aria-hidden />Locked</span> : null}
          </div>
          <p className="text-[15px] text-ink-muted">
            Tuition {inr(a.tuition_gross)}{Number(a.tuition_discount) > 0 && ` − ${inr(a.tuition_discount)} discount${a.tuition_concession ? ` (${a.tuition_concession})` : ''}`}
            {a.bus_route && <> · Bus {a.bus_route} {inr(Number(a.bus_gross) - Number(a.bus_discount))}{Number(a.bus_discount) > 0 && ` (after ${inr(a.bus_discount)} discount)`}</>}
          </p>
          {staff && a.details_locked && can('fees.configure') && f.payments.every((p) => p.status === 'void' || p.year !== a.year) && (
            <button className="mt-2 text-sm font-semibold text-brand" onClick={() => unlock.mutate()}>All receipts are void. Unlock fee details</button>
          )}
        </section>
      )}
      <section className="panel p-5"><h2 className="mb-1 font-semibold">Fees</h2><FeeItemsList fees={f} onWaive={staff && isAdmin ? (yearId, year, due) => {
        const amt = prompt(`Waive how much of ${year}'s unpaid ₹${due.toLocaleString('en-IN')}?`, String(due)); if (!amt) return;
        const reason = prompt('Reason (who approved it and why):'); if (!reason || reason.trim().length < 5) return toast.error('A reason of at least 5 characters is needed.');
        waive.mutate({ academicYearId: yearId, amount: Number(amt), reason });
      } : undefined} /></section>
      {f.waivers?.length > 0 && <section className="panel p-5"><h2 className="mb-2 font-semibold">Waivers</h2><ul className="divide-y divide-line">{f.waivers.map((w) => (
        <li key={w.id} className="py-2.5"><p className="font-semibold">{inr(w.amount)} <span className="font-normal text-ink-muted">· {w.year}</span></p><p className="text-sm text-ink-muted">{w.reason} · {w.by} · {new Date(w.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</p></li>))}</ul></section>}
      <section className="panel p-5"><h2 className="mb-1 font-semibold">Receipts</h2>
        <ReceiptList fees={f} studentName={studentName} onVoid={staff && can('payments.void') ? (id, no) => { const reason = prompt(`Void receipt ${no}? Enter the reason:`); if (reason && reason.trim().length >= 3) voidIt.mutate({ id, reason }); } : undefined} />
      </section>
      {canEdit && a && <AccountSheet studentId={studentId} f={f} open={editing} onClose={() => setEditing(false)} />}
    </div>
  );
}
