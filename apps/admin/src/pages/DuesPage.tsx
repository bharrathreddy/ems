import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MessageCircle, Search } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError } from '../lib/api';
import ExportButtons from '../components/ExportButtons';
import ReminderSettings from '../components/ReminderSettings';
import { useAuth } from '../lib/auth';
import { useClasses } from '../lib/academics';
import { inr, whatsappLink } from '../lib/fees';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';

interface Summary { academicYear: string; today: { amount: number; receipts: number }; thisMonth: number; outstanding: number; overdue: number; overdueStudents: number }
interface DueRow { public_id: string; first_name: string; last_name: string | null; admission_no: string; class_name: string | null; section_name: string | null; roll_no: string | null;
  father_name: string | null; family_name: string; primary_mobile: string; tuition: number; bus: number; one_time: number; previous: number; overdue: number; total: number }

export function FeeSummaryCards() {
  const q = useQuery({ queryKey: ['fees-summary'], queryFn: () => api<Summary>('/fees/summary').then((r) => r.data) });
  if (!q.data) return <Skeleton rows={1} />;
  const s = q.data;
  const card = (label: string, value: string, note?: string, tone?: string) => (
    <div className={clsx('panel p-4', tone)}><p className="text-sm font-medium text-ink-muted">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>{note && <p className="text-sm text-ink-muted">{note}</p>}</div>
  );
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {card('Collected today', inr(s.today.amount), `${s.today.receipts} receipt${s.today.receipts === 1 ? '' : 's'}`)}
      {card('This month', inr(s.thisMonth))}
      {card('Total due', inr(s.outstanding), s.academicYear)}
      {card('Overdue', inr(s.overdue), `${s.overdueStudents} students`, s.overdue > 0 ? 'border-danger/30' : undefined)}
    </div>
  );
}

export default function DuesPage() {
  const { can, branding } = useAuth();
  const classes = useClasses();
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const query = { classId, sectionId, overdueOnly: overdueOnly ? '1' : undefined, search: term };
  const q = useQuery({ queryKey: ['dues', query], queryFn: () => api<{ academicYear: string; students: number; total: number; rows: DueRow[] }>('/fees/reports/outstanding', { query }).then((r) => r.data) });
  const sections = classes.data?.find((c) => String(c.id) === classId)?.sections ?? [];
  const email = useMutation({ mutationFn: (id: string) => api<{ sentTo: string }>(`/students/${id}/fee-reminder`, { method: 'POST' }),
    onSuccess: ({ data }) => toast.success(`Reminder emailed to ${data.sentTo}`), onError: (e) => toast.error((e as ApiError).message, { duration: 7000 }) });
  const remind = (r: DueRow) => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ');
    const text = `Dear Parent, this is a gentle reminder from ${branding?.name ?? 'the school'}. Fees of ${inr(r.total)} are due for ${name} (${r.class_name ?? ''} ${r.section_name ?? ''})${r.overdue > 0 ? `, of which ${inr(r.overdue)} is past the due date` : ''}. Please pay at the school office. Thank you.`;
    return whatsappLink(r.primary_mobile, text);
  };
  return (
    <div>
      <PageHeader title="Fee dues" description="Who still owes fees. Remind a parent on WhatsApp or collect right away." action={
        <div className="flex flex-wrap gap-2"><ReminderSettings /><ExportButtons list="fee-dues" name="fee-dues" params={query} /></div>} />
      <FeeSummaryCards />
      <div className="my-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input className="field pl-10" placeholder="Name, admission no or mobile" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search dues" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:contents">
          <select className="field sm:w-36" aria-label="Class" value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }}>
            <option value="">All classes</option>{classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="field sm:w-28" aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!classId}>
            <option value="">All sections</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />Overdue only
        </label>
      </div>
      {q.isLoading ? <Skeleton /> : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /> : !q.data!.rows.length ? (
        <EmptyState title="No dues" body={overdueOnly ? 'Nobody is past a due date.' : 'Everyone in this selection has paid.'} />
      ) : (
        <>
          <p className="mb-2 text-sm text-ink-muted">{q.data!.students} students owe {inr(q.data!.total)}</p>
          <ul className="space-y-2 md:hidden">
            {q.data!.rows.map((r) => (
              <li key={r.public_id} className="panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><Link to={`/students/${r.public_id}`} className="font-semibold">{[r.first_name, r.last_name].filter(Boolean).join(' ')}</Link>
                    <p className="text-sm text-ink-muted">{r.class_name} {r.section_name} · {r.father_name ?? r.family_name}</p></div>
                  <div className="text-right"><p className="font-semibold tabular-nums">{inr(r.total)}</p>{r.overdue > 0 && <p className="text-xs font-semibold text-danger">{inr(r.overdue)} overdue</p>}</div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <a href={remind(r)} target="_blank" rel="noreferrer" className="btn-quiet min-h-10 text-sm"><MessageCircle size={16} aria-hidden />Remind</a>
                  <button type="button" className="btn-quiet min-h-10 text-sm" disabled={email.isPending} onClick={() => email.mutate(r.public_id)}>Email</button>
                  {can('payments.collect') && <Link to={`/fees/collect?student=${r.public_id}`} className="btn-primary min-h-10 text-sm">Collect</Link>}
                </div>
              </li>
            ))}
          </ul>
          <div className="panel hidden overflow-x-auto md:block">
            <table className="w-full text-left text-[15px]">
              <thead className="border-b border-line text-sm text-ink-muted"><tr>
                <th className="px-4 py-3 font-medium">Student</th><th className="px-4 py-3 font-medium">Class</th>
                <th className="px-3 py-3 text-right font-medium">Tuition</th><th className="px-3 py-3 text-right font-medium">Bus</th><th className="px-3 py-3 text-right font-medium">Other</th>
                <th className="px-3 py-3 text-right font-medium">Old years</th><th className="px-3 py-3 text-right font-medium">Total</th><th className="px-4 py-3" /></tr></thead>
              <tbody className="divide-y divide-line">
                {q.data!.rows.map((r) => (
                  <tr key={r.public_id} className="hover:bg-chalk">
                    <td className="px-4 py-3"><Link to={`/students/${r.public_id}`} className="font-semibold">{[r.first_name, r.last_name].filter(Boolean).join(' ')}</Link><p className="text-sm text-ink-muted">{r.father_name ?? r.family_name} · {r.primary_mobile}</p></td>
                    <td className="px-4 py-3">{r.class_name} {r.section_name}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.tuition ? inr(r.tuition) : '-'}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.bus ? inr(r.bus) : '-'}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.one_time ? inr(r.one_time) : '-'}</td>
                    <td className={clsx('px-3 py-3 text-right tabular-nums', r.previous > 0 && 'font-semibold text-danger')}>{r.previous ? inr(r.previous) : '-'}</td>
                    <td className="px-3 py-3 text-right"><span className="font-semibold tabular-nums">{inr(r.total)}</span>{r.overdue > 0 && <p className="text-xs font-semibold text-danger">{inr(r.overdue)} overdue</p>}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <a href={remind(r)} target="_blank" rel="noreferrer" className="mr-3 text-sm font-semibold text-brand">Remind</a>
                      <button type="button" className="mr-3 text-sm font-semibold text-brand" disabled={email.isPending} onClick={() => email.mutate(r.public_id)}>Email</button>
                      {can('payments.collect') && <Link to={`/fees/collect?student=${r.public_id}`} className="text-sm font-semibold text-brand">Collect</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
