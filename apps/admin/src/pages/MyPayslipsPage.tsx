import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { inr } from '../lib/fees';
import { openProtected } from '../lib/payroll';
import { Badge, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';

interface Payslip { id: string; month: string; label: string; paid: boolean; paidOn: string | null; gross: number; deductions: number; net: number; lopDays: number }

export default function MyPayslipsPage() {
  const q = useQuery({ queryKey: ['my-payslips'], queryFn: () => api<Payslip[]>('/payslips/mine').then((r) => r.data) });
  return (
    <div className="max-w-2xl">
      <PageHeader title="My payslips" description="Your payslip appears here once the office finalises the month." />
      {q.isLoading ? <Skeleton rows={3} /> : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
        : !q.data!.length ? <EmptyState title="No payslips yet" body="When the month's payroll is finalised you will get an alert, and the payslip will be here." /> : (
          <ul className="space-y-2">{q.data!.map((p) => (
            <li key={p.id} className="panel flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-semibold">{p.label} {p.paid && <Badge tone="brand">Paid{p.paidOn ? ` ${new Date(`${p.paidOn}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : ''}</Badge>}</p>
                <p className="text-sm text-ink-muted tabular-nums">Gross {inr(p.gross)} · Deductions {inr(p.deductions)}{p.lopDays ? ` · ${p.lopDays} loss-of-pay day${p.lopDays === 1 ? '' : 's'}` : ''}</p>
              </div>
              <div className="flex items-center gap-4">
                <p className="text-lg font-semibold tabular-nums">{inr(p.net)}</p>
                <button className="btn-quiet min-h-10 text-sm" onClick={() => openProtected(`/payslips/${p.id}/pdf`).catch((e) => toast.error((e as Error).message))}><FileText size={16} aria-hidden />Payslip</button>
              </div>
            </li>))}</ul>
        )}
    </div>
  );
}
