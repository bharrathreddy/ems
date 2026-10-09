import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError } from '../lib/api';
import ExportButtons from '../components/ExportButtons';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/academics';
import { inr, METHOD_LABEL, todayISO } from '../lib/fees';
import { Badge, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { ReceiptActions } from '../components/FeeParts';

interface Row { public_id: string; receipt_no: string; receipt_type: string; payment_date: string; total_amount: string; method: string; reference_no: string | null; status: string; void_reason: string | null;
  collected_by: string; student_id: string; first_name: string; last_name: string | null; admission_no: string; class_name: string | null; section_name: string | null }
interface Report { from: string; to: string; total: number; count: number; byMethod: Record<string, number>; byCollector: Record<string, number>; voided: number; receipts: Row[] }

const shift = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const PRESETS: Array<[string, () => [string, string]]> = [
  ['Today', () => [todayISO(), todayISO()]], ['Yesterday', () => [shift(-1), shift(-1)]],
  ['Last 7 days', () => [shift(-6), todayISO()]], ['This month', () => [`${todayISO().slice(0, 7)}-01`, todayISO()]],
];

export default function ReceiptsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [[from, to], setRange] = useState<[string, string]>([todayISO(), todayISO()]);
  const q = useQuery({ queryKey: ['collection', from, to], queryFn: () => api<Report>('/fees/reports/collection', { query: { from, to } }).then((r) => r.data) });
  const voidIt = useMutation({
    mutationFn: (v: { id: string; reason: string }) => api(`/payments/${v.id}/void`, { method: 'POST', body: { reason: v.reason } }),
    onSuccess: () => { toast.success('Receipt voided. The amounts are due again.'); qc.invalidateQueries(); },
    onError: (e) => toast.error((e as ApiError).message),
  });
  const r = q.data;
  return (
    <div>
      <PageHeader title="Receipts" description="Money received, by day. Void a wrong receipt here; its number is kept." action={
        <ExportButtons list="fee-collection" name={`fee-collection-${from}-to-${to}`} params={{ from, to }} />} />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {PRESETS.map(([label, fn]) => {
          const [f, t] = fn();
          return <button key={label} onClick={() => setRange([f, t])} aria-pressed={from === f && to === t}
            className={clsx('min-h-10 rounded-lg border px-3 text-sm font-semibold', from === f && to === t ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface')}>{label}</button>;
        })}
        <input type="date" className="field w-auto" aria-label="From" value={from} max={to} onChange={(e) => setRange([e.target.value, to])} />
        <input type="date" className="field w-auto" aria-label="To" value={to} min={from} max={todayISO()} onChange={(e) => setRange([from, e.target.value])} />
      </div>
      {q.isLoading ? <Skeleton /> : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="panel p-4"><p className="text-sm text-ink-muted">Total received</p><p className="text-2xl font-semibold tabular-nums">{inr(r!.total)}</p><p className="text-sm text-ink-muted">{r!.count} receipts</p></div>
            {Object.entries(r!.byMethod).map(([m, v]) => <div key={m} className="panel p-4"><p className="text-sm text-ink-muted">{METHOD_LABEL[m]}</p><p className="text-xl font-semibold tabular-nums">{inr(v)}</p></div>)}
          </div>
          {!r!.receipts.length ? <EmptyState title="No receipts" body="Nothing was collected in this period." /> : (
            <ul className="panel divide-y divide-line">
              {r!.receipts.map((x) => {
                const name = [x.first_name, x.last_name].filter(Boolean).join(' ');
                return (
                  <li key={x.public_id} className={clsx('flex flex-wrap items-center gap-3 px-4 py-3', x.status === 'void' && 'opacity-60')}>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold"><Link to={`/students/${x.student_id}`}>{name}</Link> <span className="font-normal text-ink-muted">· {x.class_name} {x.section_name}</span>
                        {x.status === 'void' && <> <Badge tone="danger">Void</Badge></>}{x.receipt_type === 'opening_balance' && <> <Badge>Opening</Badge></>}</p>
                      <p className="text-sm text-ink-muted">{x.receipt_no} · {fmtDate(x.payment_date)} · {METHOD_LABEL[x.method]}{x.reference_no ? ` ${x.reference_no}` : ''} · {x.collected_by}{x.void_reason ? ` · Void: ${x.void_reason}` : ''}</p>
                    </div>
                    <p className={clsx('w-24 text-right font-semibold tabular-nums', x.status === 'void' && 'line-through')}>{inr(x.total_amount)}</p>
                    <ReceiptActions compact publicId={x.public_id} receiptNo={x.receipt_no} shareText={`Fee receipt ${x.receipt_no} for ${name}: ${inr(x.total_amount)}.`} />
                    {can('payments.void') && x.status === 'valid' && x.receipt_type === 'regular' && (
                      <button className="text-sm font-semibold text-danger" onClick={() => { const reason = prompt(`Void receipt ${x.receipt_no}? Enter the reason:`); if (reason && reason.trim().length >= 3) voidIt.mutate({ id: x.public_id, reason }); }}>Void</button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
