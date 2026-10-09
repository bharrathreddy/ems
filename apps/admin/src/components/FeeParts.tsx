import { useState } from 'react';
import { Download, Printer, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Badge } from './ui';
import { downloadReceipt, inr, METHOD_LABEL, openReceipt, shareReceipt, type FeeItem, type StudentFees } from '../lib/fees';
import { fmtDate } from '../lib/academics';

export function StatusChip({ item }: { item: FeeItem }) {
  if (item.status === 'paid') return <Badge tone="brand">Paid</Badge>;
  if (item.status === 'waived') return <Badge>Waived</Badge>;
  if (item.overdue) return <Badge tone="danger">Overdue</Badge>;
  if (item.status === 'partial') return <Badge tone="attention">Part paid</Badge>;
  if (item.status === 'due') return <Badge tone="attention">Due</Badge>;
  return <Badge>Upcoming</Badge>;
}

/** Item list grouped: previous years first (F31), then this year's tuition, bus, one-time fees. */
export function FeeItemsList({ fees, onWaive }: { fees: StudentFees; onWaive?: (yearId: number, year: string, due: number) => void }) {
  const prev = fees.items.filter((i) => i.previous_year);
  const now = fees.items.filter((i) => !i.previous_year);
  const Row = ({ i }: { i: FeeItem }) => (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{i.label}{i.previous_year && <span className="text-ink-muted"> · {i.year}</span>}</p>
        <p className="text-sm text-ink-muted">{i.due_date ? `Due ${fmtDate(i.due_date)}` : 'No due date'}{Number(i.paid_amount) > 0 && Number(i.balance) > 0 ? ` · paid ${inr(i.paid_amount)} of ${inr(i.amount)}` : ''}{Number(i.waived_amount) > 0 ? ` · ${inr(i.waived_amount)} waived` : ''}</p>
      </div>
      <div className="text-right">
        <p className={clsx('font-semibold tabular-nums', Number(i.balance) === 0 && 'text-ink-muted line-through decoration-1')}>{inr(Number(i.balance) > 0 ? i.balance : i.amount)}</p>
        <StatusChip item={i} />
      </div>
    </li>
  );
  return (
    <div className="space-y-4">
      {prev.length > 0 && (
        <div className="rounded-xl border border-danger/25 bg-danger-soft/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-danger">Previous year dues · {inr(fees.totals.previousYears)}</p>
            {onWaive && [...new Map(prev.filter((i) => i.year_status === 'closed' && Number(i.balance) > 0).map((i) => [i.academic_year_id, i.year])).entries()].map(([yid, yname]) => (
              <button key={yid} className="text-sm font-semibold text-danger underline" onClick={() => onWaive(yid, yname, prev.filter((i) => i.academic_year_id === yid).reduce((t, i) => t + Number(i.balance), 0))}>Waive {yname} dues</button>))}</div>
          <ul className="divide-y divide-line">{prev.map((i) => <Row key={i.id} i={i} />)}</ul>
        </div>
      )}
      <ul className="divide-y divide-line">{now.map((i) => <Row key={i.id} i={i} />)}</ul>
    </div>
  );
}

export function FeeTotals({ fees }: { fees: StudentFees }) {
  const t = fees.totals;
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="rounded-xl bg-chalk p-3"><p className="text-xs font-medium text-ink-muted">This year</p><p className="text-lg font-semibold tabular-nums">{inr(t.thisYear.amount)}</p></div>
      <div className="rounded-xl bg-brand-soft p-3"><p className="text-xs font-medium text-brand">Paid</p><p className="text-lg font-semibold tabular-nums text-brand">{inr(t.thisYear.paid)}</p></div>
      <div className={clsx('rounded-xl p-3', t.totalDue > 0 ? 'bg-tangedu-soft' : 'bg-chalk')}>
        <p className="text-xs font-medium text-[#7A5A00]">Due{t.previousYears > 0 ? ' (incl. old)' : ''}</p>
        <p className="text-lg font-semibold tabular-nums">{inr(t.totalDue)}</p>
      </div>
    </div>
  );
}

export function ReceiptActions({ publicId, receiptNo, shareText, compact = false }: { publicId: string; receiptNo: string; shareText: string; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const run = (f: () => Promise<unknown>) => async () => {
    setBusy(true);
    try { await f(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const cls = compact ? 'btn-quiet min-h-9 px-3 text-sm' : 'btn-quiet';
  return (
    <div className="flex flex-wrap gap-2">
      <button className={cls} disabled={busy} onClick={run(async () => { const r = await shareReceipt(publicId, receiptNo, shareText); if (r === 'downloaded') toast.info('PDF downloaded. Attach it in WhatsApp.'); })}><Share2 size={16} aria-hidden />Share PDF</button>
      <button className={cls} disabled={busy} onClick={run(() => downloadReceipt(publicId, receiptNo))}><Download size={16} aria-hidden />{compact ? 'PDF' : 'Download'}</button>
      {!compact && <button className={cls} disabled={busy} onClick={run(() => openReceipt(publicId))}><Printer size={16} aria-hidden />Print</button>}
    </div>
  );
}

export function ReceiptList({ fees, studentName, onVoid }: { fees: StudentFees; studentName: string; onVoid?: (publicId: string, receiptNo: string) => void }) {
  if (!fees.payments.length) return <p className="text-ink-muted">No receipts yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {fees.payments.map((p) => (
        <li key={p.public_id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold tabular-nums">{inr(p.total_amount)} <span className="whitespace-nowrap font-normal text-ink-muted">· {METHOD_LABEL[p.method]}</span>
              {p.status === 'void' && <> <Badge tone="danger">Void</Badge></>}{p.receipt_type === 'opening_balance' && <> <Badge>Opening</Badge></>}</p>
            <p className="text-sm text-ink-muted">{p.receipt_no} · {fmtDate(p.payment_date)}{p.status === 'void' && p.void_reason ? ` · ${p.void_reason}` : ''}</p>
          </div>
          <div className="flex items-center gap-3">
          <ReceiptActions compact publicId={p.public_id} receiptNo={p.receipt_no} shareText={`Fee receipt ${p.receipt_no} for ${studentName}: ${inr(p.total_amount)}.`} />
          {onVoid && p.status === 'valid' && p.receipt_type === 'regular' && <button className="text-sm font-semibold text-danger" onClick={() => onVoid(p.public_id, p.receipt_no)}>Void</button>}
          </div>
        </li>
      ))}
    </ul>
  );
}
