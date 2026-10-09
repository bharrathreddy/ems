import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorState, PageHeader, Skeleton, Toggle } from '../components/ui';

const MODULE_INFO: Record<string, [string, string]> = {
  academics: ['Classes & years', 'Academic years, classes, sections, subjects'],
  students: ['Students', 'Student records and Student 360'],
  families: ['Parents', 'Parent accounts linked to students'],
  staff: ['Staff', 'Staff records and roles'],
  announcements: ['Announcements', 'Notices to staff and parents'],
  imports: ['Bulk import', 'Excel imports'],
  fees: ['Fees', 'Release 2'], payments: ['Payments & receipts', 'Release 2'],
  attendance: ['Attendance', 'Release 3'], exams: ['Exams', 'Release 4'], marks: ['Marks', 'Release 4'],
  cms: ['Website', 'Release 5'], reports: ['Reports', 'Later'],
  hr: ['HR records & leave types', 'Release 6: bank and ID details, leave allowances'],
  payroll: ['Payroll & payslips', 'Release 6: salaries, loss of pay, payslips'],
  expenses: ['Expenses', 'Release 6: spending with bills and approval'],
  transport: ['Transport', 'Release 7: buses, drivers, stops and times, fuel and service log (routes come from Fee setup)'],
  inventory: ['Stock & sales counter', 'Release 7: stock in and out, book sets, sales to students with receipts'],
};

export default function DeveloperPage() {
  const { reload } = useAuth();
  const qc = useQueryClient();
  const flags = useQuery({ queryKey: ['flags'], queryFn: () => api<Array<{ module: string; enabled: boolean }>>('/developer/feature-flags').then((r) => r.data) });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<any>('/developer/health').then((r) => r.data) });
  const set = useMutation({
    mutationFn: (v: { module: string; enabled: boolean }) => api(`/developer/feature-flags/${v.module}`, { method: 'PUT', body: { enabled: v.enabled } }),
    onSuccess: async (_d, v) => { toast.success(`${MODULE_INFO[v.module]?.[0] ?? v.module} ${v.enabled ? 'enabled' : 'disabled'}`); await qc.invalidateQueries({ queryKey: ['flags'] }); await reload(); },
    onError: (e) => toast.error((e as ApiError).message),
  });
  return (
    <div className="max-w-2xl">
      <PageHeader title="Developer console" description="Only you can see this page. Changes apply to every user of this installation." />
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Modules</h2>
        {flags.isLoading ? <Skeleton /> : flags.isError ? <ErrorState message={(flags.error as Error).message} /> : (
          <ul className="panel divide-y divide-line">
            {flags.data!.map((f) => (
              <li key={f.module} className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div><p className="font-semibold">{MODULE_INFO[f.module]?.[0] ?? f.module}</p><p className="text-sm text-ink-muted">{MODULE_INFO[f.module]?.[1]}</p></div>
                <Toggle checked={f.enabled} label={`Enable ${f.module}`} disabled={set.isPending} onChange={(enabled) => set.mutate({ module: f.module, enabled })} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">System health</h2>
        {health.data && (
          <div className="panel p-4 text-[15px]">
            <p>Status: <strong className="text-brand">{health.data.status}</strong></p>
            <p className="mt-2 text-ink-muted">Migrations applied</p>
            <ul className="mt-1 space-y-0.5">{health.data.migrations.map((m: any) => <li key={m.filename}>{m.filename}</li>)}</ul>
            <p className="mt-3 text-ink-muted">Email outbox</p>
            <p>{health.data.emailOutbox.length ? health.data.emailOutbox.map((o: any) => `${o.status}: ${o.count}`).join(', ') : 'Empty'}</p>
          </div>
        )}
      </section>
    </div>
  );
}
