import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, Sheet, Toggle } from './ui';

interface S { enabled: boolean; daysBefore: number; overdueEveryDays: number; studentsWithDuesWithoutEmail: number; emailConfigured: boolean; lastRun: { date: string; result: { emails: number; noEmail: number } } | null }

/** Fee reminder emails: on/off and timing (off until the admin switches it on). */
export default function ReminderSettings() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['fee-reminders'], queryFn: () => api<S>('/fees/reminders').then((r) => r.data) });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ enabled: false, daysBefore: 3, overdueEveryDays: 7 });
  useEffect(() => { if (q.data) setF({ enabled: q.data.enabled, daysBefore: q.data.daysBefore, overdueEveryDays: q.data.overdueEveryDays }); }, [q.data]);
  const save = useMutation({ mutationFn: () => api('/fees/reminders', { method: 'PUT', body: f }), onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['fee-reminders'] }); setOpen(false); }, onError: (e) => toast.error((e as ApiError).message) });
  const run = useMutation({ mutationFn: () => api<{ emails: number; noEmail: number }>('/fees/reminders/run', { method: 'POST' }),
    onSuccess: ({ data }) => { toast.success(`${data.emails} reminder email${data.emails === 1 ? '' : 's'} queued${data.noEmail ? `; ${data.noEmail} famil${data.noEmail === 1 ? 'y has' : 'ies have'} no email` : ''}`); qc.invalidateQueries({ queryKey: ['fee-reminders'] }); },
    onError: (e) => toast.error((e as ApiError).message) });
  const d = q.data;
  if (!d) return null;
  const edit = can('fees.configure');
  return (
    <>
      <button type="button" className="btn-quiet min-h-10 px-3 text-sm" onClick={() => setOpen(true)}><Mail size={16} aria-hidden />Email reminders: {d.enabled ? 'on' : 'off'}</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Fee reminder emails" footer={edit ? <button className="btn-primary w-full" disabled={save.isPending} onClick={() => save.mutate()}>Save</button> : undefined}>
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">Once a day after 9 am, families get one email listing fees that fall due soon, and a reminder for overdue fees. Nobody gets the same reminder twice. There is no late fine.</p>
          {!d.emailConfigured && <p className="rounded-lg bg-tangedu-soft px-3 py-2 text-sm text-[#7A5A00]">Email sending is not set up yet, so reminders wait in the queue. Set it up in <Link to="/settings" className="font-semibold underline">School settings</Link>.</p>}
          {d.studentsWithDuesWithoutEmail > 0 && <p className="rounded-lg bg-chalk px-3 py-2 text-sm">{d.studentsWithDuesWithoutEmail} student{d.studentsWithDuesWithoutEmail === 1 ? ' with dues has' : 's with dues have'} no family email. Remind them on WhatsApp, or add the email on the student's Family tab.</p>}
          <label className="flex items-center gap-3"><Toggle checked={f.enabled} label="Send reminder emails" onChange={(v) => edit && setF({ ...f, enabled: v })} /><span className="font-semibold">Send reminder emails</span></label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Days before the due date"><input type="number" min={0} max={30} className="field" disabled={!edit} value={f.daysBefore} onChange={(e) => setF({ ...f, daysBefore: Number(e.target.value) })} /></Field>
            <Field label="Repeat overdue every (days)"><input type="number" min={1} max={60} className="field" disabled={!edit} value={f.overdueEveryDays} onChange={(e) => setF({ ...f, overdueEveryDays: Number(e.target.value) })} /></Field>
          </div>
          {d.lastRun && <p className="text-sm text-ink-muted">Last run {new Date(`${d.lastRun.date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}: {d.lastRun.result.emails} emails{d.lastRun.result.noEmail ? `, ${d.lastRun.result.noEmail} without email` : ''}.</p>}
          {edit && d.enabled && <button className="btn-quiet w-full" disabled={run.isPending} onClick={() => run.mutate()}>Send today's reminders now</button>}
        </div>
      </Sheet>
    </>
  );
}
