import { Link } from 'react-router-dom';
import ExportButtons from '../components/ExportButtons';
import { useQuery } from '@tanstack/react-query';
import { Check, Circle } from 'lucide-react';
import { api } from '../lib/api';
import { EmptyState, PageHeader, Skeleton } from '../components/ui';

const d = (x: string) => new Date(`${x}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export default function LeavingStudentsPage() {
  const q = useQuery({ queryKey: ['student-exits'], queryFn: () => api<any[]>('/student-exits').then((r) => r.data) });
  const item = (x: any, label: string) => x ? <span className="flex items-center gap-1.5 text-sm"><Check size={15} className="text-brand" aria-hidden />{label} {x.number} · {d(x.issuedOn)}</span>
    : <span className="flex items-center gap-1.5 text-sm text-danger"><Circle size={14} aria-hidden />{label} not issued</span>;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Leaving students" description="Relieving checklist: TC and bonafide certificate issued for each student who left." action={<ExportButtons list="leaving-students" />} />
      {q.isLoading ? <Skeleton rows={4} /> : !q.data?.length ? <EmptyState title="Nobody has left yet" body={'Use "Leaving school" on a student\'s page.'} /> : (
        <ul className="panel divide-y divide-line">{q.data.map((x) => (
          <li key={x.studentId} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1"><Link to={`/students/${x.studentId}`} className="font-semibold">{x.name}</Link><p className="text-sm text-ink-muted">Adm {x.admissionNo} · left {d(x.leavingDate)} · {x.reason}</p></div>
            <div className="space-y-1">{item(x.tc, 'TC')}{item(x.bonafide, 'Bonafide')}</div>
          </li>))}</ul>
      )}
    </div>
  );
}
