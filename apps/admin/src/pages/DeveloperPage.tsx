import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, fieldErrors } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, ErrorState, Field, PageHeader, Skeleton, Toggle } from '../components/ui';

const MODULE_INFO: Record<string, [string, string]> = {
  academics: ['Classes & years', 'Academic years, classes, sections, subjects'],
  students: ['Students', 'Student records and Student 360'],
  families: ['Parents', 'Parent accounts linked to students'],
  staff: ['Staff', 'Staff records and roles'],
  announcements: ['Announcements', 'Notices to staff and parents'],
  imports: ['Bulk import', 'Excel imports'],
  timetable: ['Timetable', 'Periods and class timetables'],
  fees: ['Fees', 'Release 2'], payments: ['Payments & receipts', 'Release 2'],
  attendance: ['Attendance', 'Release 3'], exams: ['Exams', 'Release 4'], marks: ['Marks', 'Release 4'],
  cms: ['Website', 'Release 5'], reports: ['Reports', 'Later'],
  hr: ['HR records & leave types', 'Release 6: bank and ID details, leave allowances'],
  payroll: ['Payroll & payslips', 'Release 6: salaries, loss of pay, payslips'],
  expenses: ['Expenses', 'Release 6: spending with bills and approval'],
  transport: ['Transport', 'Release 7: buses, drivers, stops and times, fuel and service log (routes come from Fee setup)'],
  inventory: ['Stock & sales counter', 'Release 7: stock in and out, book sets, sales to students with receipts'],
  homework: ['Homework & class diary', 'Teachers of a section post homework and diary notes; parents see them for their child'],
  enquiries: ['Admission enquiries', 'Messages from the website contact form, followed up to admission'],
};

interface TwoStepStatus { enabled: boolean; changedAt: string | null; emailConfigured: boolean; testedAt: string | null; covered: Array<{ name: string; email: string | null; developer: boolean }> }

/** Two-step sign-in: can be switched on only after a test code has arrived by email. */
function TwoStepCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['two-step'], queryFn: () => api<TwoStepStatus>('/developer/two-step').then((r) => r.data) });
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const done = (d: TwoStepStatus) => qc.setQueryData(['two-step'], d);
  const test = useMutation({ mutationFn: () => api<{ sentTo: string }>('/developer/two-step/test', { method: 'POST' }), onSuccess: ({ data }) => { setSentTo(data.sentTo); setErr(null); setCode(''); }, onError: (e) => toast.error((e as ApiError).message, { duration: 7000 }) });
  const enable = useMutation({ mutationFn: () => api<TwoStepStatus>('/developer/two-step/enable', { method: 'POST', body: { code } }),
    onSuccess: ({ data }) => { done(data); setSentTo(null); toast.success('Two-step sign-in is on'); },
    onError: (e) => setErr(fieldErrors(e).code ?? (e as ApiError).message) });
  const disable = useMutation({ mutationFn: () => api<TwoStepStatus>('/developer/two-step/disable', { method: 'POST' }), onSuccess: ({ data }) => { done(data); toast.success('Two-step sign-in is off'); } });
  if (q.isLoading) return <Skeleton rows={2} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const d = q.data!;
  const noEmail = d.covered.filter((c) => !c.email);
  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold">Two-step sign-in {d.enabled ? <Badge tone="brand">On</Badge> : <Badge>Off</Badge>}</p>
          <p className="mt-1 text-sm text-ink-muted">After the password, the developer and Institution Admin logins must enter a 6-digit code sent to their email. Other staff and parents sign in as before.</p>
        </div>
        {d.enabled && <button className="btn-quiet shrink-0" disabled={disable.isPending} onClick={() => { if (confirm('Switch off two-step sign-in? Admin logins will need only a password.')) disable.mutate(); }}>Switch off</button>}
      </div>
      <p className="mt-3 text-sm"><span className="text-ink-muted">Applies to: </span>{d.covered.map((c) => `${c.name}${c.email ? ` (${c.email})` : ''}`).join(', ') || 'nobody yet'}</p>
      {noEmail.length > 0 && <p className="mt-2 rounded-lg bg-tangedu-soft px-3 py-2 text-sm">No email address, so they sign in with password only: <strong>{noEmail.map((c) => c.name).join(', ')}</strong>. Add their email on the Staff page.</p>}
      {!d.enabled && (!d.emailConfigured ? (
        <p className="mt-3 rounded-lg bg-tangedu-soft px-3 py-2 text-sm">Set up email first in <Link className="font-semibold text-brand underline" to="/settings">School settings → Email</Link>. The codes are sent by email, so it can be switched on only when email works.</p>
      ) : !sentTo ? (
        <button className="btn-primary mt-4" disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? 'Sending…' : 'Send me a test code'}</button>
      ) : (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); enable.mutate(); }}>
          <p className="text-sm">We emailed a code to <strong>{sentTo}</strong>. Enter it to prove email works and switch two-step sign-in on.</p>
          <Field label="Code from the test email" error={err ?? undefined}>
            <input className="field max-w-40 text-center text-xl font-semibold tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={code.length !== 6 || enable.isPending}>Switch on</button>
            <button type="button" className="btn-quiet" disabled={test.isPending} onClick={() => test.mutate()}>Send another code</button>
          </div>
        </form>
      ))}
    </div>
  );
}

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
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Sign-in security</h2>
        <TwoStepCard />
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
