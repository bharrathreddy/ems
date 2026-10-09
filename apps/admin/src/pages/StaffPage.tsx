import { useEffect, useState, type FormEvent } from 'react';
import ExportButtons from '../components/ExportButtons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, fieldErrors } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, EmptyState, ErrorState, Field, MobileAction, PageHeader, Sheet, Skeleton } from '../components/ui';
import { CredentialsPanel, type Credentials } from '../components/Credentials';

interface StaffRow {
  public_id: string; user_id: string; name: string; email: string | null; mobile: string | null; employee_code: string;
  designation: string | null; department: string | null; status: string; account_status: string; roles: string | null;
  has_password: boolean; must_change_password: boolean; last_login_at: string | null;
}
interface Role { role_key: string; name: string }

function accountBadge(s: StaffRow) {
  if (s.account_status !== 'active') return <Badge tone="danger">Disabled</Badge>;
  if (!s.has_password) return <Badge tone="attention">Login not sent</Badge>;
  if (s.must_change_password) return <Badge tone="attention">Awaiting first login</Badge>;
  return <Badge tone="brand">Active</Badge>;
}

const emptyForm = { name: '', email: '', mobile: '', employeeCode: '', designation: '', department: '', joiningDate: '', dob: '', roleKeys: [] as string[] };

function AddStaffSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (s: StaffRow) => void }) {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['staff-roles'], queryFn: () => api<Role[]>('/roles/staff').then((r) => r.data), enabled: open });
  const [f, setF] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api<StaffRow>('/staff', { method: 'POST', body: { ...f, joiningDate: f.joiningDate || null, dob: f.dob || null, designation: f.designation || null, department: f.department || null } }),
    onSuccess: ({ data }) => { toast.success(`${f.name} added`); qc.invalidateQueries({ queryKey: ['staff'] }); setF(emptyForm); onCreated(data); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(Object.keys(fe).length ? fe : { form: (e as ApiError).message }); },
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => { e.preventDefault(); setErrors({}); m.mutate(); };
  return (
    <Sheet open={open} onClose={onClose} title="Add staff member"
      footer={<button form="staff-form" className="btn-primary w-full" disabled={m.isPending}>{m.isPending ? 'Adding…' : 'Add staff member'}</button>}>
      <form id="staff-form" onSubmit={submit} className="space-y-4">
        <Field label="Full name" error={errors.name}><input className="field" value={f.name} onChange={set('name')} autoComplete="off" /></Field>
        <Field label="Mobile number" error={errors.mobile} hint="Used to log in and to send login details on WhatsApp."><input className="field" inputMode="tel" value={f.mobile} onChange={set('mobile')} /></Field>
        <Field label="Email" error={errors.email} hint="Needed for password reset."><input className="field" type="email" value={f.email} onChange={set('email')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Employee code" error={errors.employeeCode}><input className="field" value={f.employeeCode} onChange={set('employeeCode')} /></Field>
          <Field label="Joining date" error={errors.joiningDate}><input className="field" type="date" value={f.joiningDate} onChange={set('joiningDate')} /></Field>
          <Field label="Date of birth (optional)" error={errors.dob}><input className="field" type="date" value={f.dob} onChange={set('dob')} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Designation"><input className="field" value={f.designation} onChange={set('designation')} /></Field>
          <Field label="Department"><input className="field" value={f.department} onChange={set('department')} /></Field>
        </div>
        <fieldset>
          <legend className="label">Roles</legend>
          {errors.roleKeys && <p className="mb-2 text-sm text-danger">{errors.roleKeys}</p>}
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {roles.data?.map((r) => (
              <label key={r.role_key} className="flex min-h-11 items-center gap-2.5 rounded-lg border border-line px-3 text-[15px] has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={f.roleKeys.includes(r.role_key)}
                  onChange={(e) => setF({ ...f, roleKeys: e.target.checked ? [...f.roleKeys, r.role_key] : f.roleKeys.filter((k) => k !== r.role_key) })} />
                {r.name}
              </label>
            ))}
          </div>
        </fieldset>
        {errors.form && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger" role="alert">{errors.form}</p>}
      </form>
    </Sheet>
  );
}


const EMP: Record<string, string> = { permanent: 'Permanent', probation: 'On probation', contract: 'Contract', part_time: 'Part-time' };
const HR_FIELDS: Array<[key: string, label: string, hint?: string]> = [['bankName', 'Bank'], ['bankAccountNo', 'Account number'], ['bankIfsc', 'IFSC', 'e.g. SBIN0001234'], ['panNo', 'PAN'],
  ['uanNo', 'UAN (PF)'], ['esiNo', 'ESI number'], ['emergencyName', 'Emergency contact'], ['emergencyMobile', 'Emergency mobile'], ['exitDate', 'Last working day', 'Only when leaving'], ['exitReason', 'Reason for leaving']];

function HrSection({ staffId }: { staffId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hr', staffId], queryFn: () => api<any>(`/hr/staff/${staffId}`).then((r) => r.data) });
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({ mutationFn: () => api<any>(`/hr/staff/${staffId}`, { method: 'PUT', body: Object.fromEntries(Object.entries(edit!).map(([k, v]) => [k, v === '' ? null : v])) }),
    onSuccess: ({ data }) => { qc.setQueryData(['hr', staffId], data); setEdit(null); setErrors({}); toast.success('HR details saved'); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(fe); if (!Object.keys(fe).length) toast.error((e as ApiError).message); } });
  if (q.isLoading) return <Skeleton rows={2} />;
  if (q.isError) return null;
  const h = q.data;
  if (edit) return (
    <section className="space-y-3">
      <h3 className="font-semibold">HR details</h3>
      <Field label="Employment"><select className="field" value={edit.employmentType} onChange={(e) => setEdit({ ...edit, employmentType: e.target.value })}><option value="">Not set</option>{Object.entries(EMP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-3">{HR_FIELDS.map(([k, label, hint]) => (
        <Field key={k} label={label} hint={hint} error={errors[k]}><input className="field" type={k === 'exitDate' ? 'date' : 'text'} inputMode={k === 'bankAccountNo' || k === 'emergencyMobile' ? 'numeric' : undefined} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></Field>))}</div>
      <Field label="Notes"><textarea className="field min-h-16" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} maxLength={1000} /></Field>
      <div className="flex gap-2"><button className="btn-primary flex-1" disabled={m.isPending} onClick={() => m.mutate()}>Save HR details</button><button className="btn-quiet" onClick={() => setEdit(null)}>Cancel</button></div>
    </section>
  );
  const shown = HR_FIELDS.filter(([k]) => h[k]);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="font-semibold">HR details</h3>
        {can('hr.manage') && <button className="text-sm font-semibold text-brand" onClick={() => setEdit(Object.fromEntries(['employmentType', 'notes', ...HR_FIELDS.map(([k]) => k)].map((k) => [k, h[k] ?? ''])))}>Edit</button>}</div>
      {!shown.length && !h.employmentType ? <p className="text-sm text-ink-muted">No bank or ID details yet.</p> : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[15px]">
          {h.employmentType && <><dt className="text-ink-muted">Employment</dt><dd>{EMP[h.employmentType]}</dd></>}
          {shown.map(([k, label]) => <div key={k} className="contents"><dt className="text-ink-muted">{label}</dt><dd className="break-all">{h[k]}</dd></div>)}
        </dl>)}
      {h.notes && <p className="text-sm text-ink-muted">{h.notes}</p>}
      <div><p className="label">Leave this year ({h.year})</p>
        <ul className="flex flex-wrap gap-2">{h.leave.map((l: any) => <li key={l.id} className="rounded-lg border border-line px-3 py-1.5 text-sm">{l.name}: <b>{l.used}</b>{l.allowed != null ? ` of ${l.allowed}` : ''}{l.pending ? ` · ${l.pending} waiting` : ''}</li>)}</ul></div>
    </section>
  );
}

function StaffDetailSheet({ staffId, onClose }: { staffId: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [cred, setCred] = useState<Credentials | null>(null);
  useEffect(() => setCred(null), [staffId]);
  const q = useQuery({ queryKey: ['staff', staffId], enabled: !!staffId, queryFn: () => api<any>(`/staff/${staffId}`).then((r) => r.data) });
  const issue = useMutation({
    mutationFn: () => api<Credentials>(`/users/${q.data.user_id}/credentials`, { method: 'POST' }),
    onSuccess: ({ data }) => { setCred(data); qc.invalidateQueries({ queryKey: ['staff'] }); },
    onError: (e) => toast.error((e as ApiError).message),
  });
  const toggle = useMutation({
    mutationFn: (enable: boolean) => api(`/users/${q.data.user_id}/${enable ? 'enable' : 'disable'}`, { method: 'POST' }),
    onSuccess: (_d, enable) => { toast.success(enable ? 'Account enabled' : 'Account disabled'); qc.invalidateQueries({ queryKey: ['staff'] }); },
    onError: (e) => toast.error((e as ApiError).message),
  });
  const s = q.data;
  return (
    <Sheet open={!!staffId} onClose={onClose} title={s?.name ?? 'Staff member'}>
      {q.isLoading || !s ? <Skeleton rows={3} /> : (
        <div className="space-y-6">
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[15px]">
            <dt className="text-ink-muted">Mobile</dt><dd>{s.mobile}</dd>
            <dt className="text-ink-muted">Email</dt><dd className="break-all">{s.email}</dd>
            <dt className="text-ink-muted">Employee code</dt><dd>{s.employee_code}</dd>
            {s.designation && <><dt className="text-ink-muted">Designation</dt><dd>{s.designation}</dd></>}
            <dt className="text-ink-muted">Roles</dt><dd>{s.roles.map((r: Role) => r.name).join(', ')}</dd>
            <dt className="text-ink-muted">Last login</dt><dd>{s.last_login_at ? new Date(s.last_login_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'}</dd>
          </dl>
          {can('hr.view') && <HrSection staffId={staffId!} />}
          {cred ? <CredentialsPanel c={cred} /> : (
            <div className="space-y-2">
              {can('users.issue_credentials') && s.account_status === 'active' && (
                <button className="btn-primary w-full" onClick={() => issue.mutate()} disabled={issue.isPending}>{issue.isPending ? 'Generating…' : 'Send login details'}</button>
              )}
              {can('users.disable') && (
                s.account_status === 'active'
                  ? <button className="btn-danger w-full" onClick={() => confirm(`Disable ${s.name}'s account? They will be signed out everywhere.`) && toggle.mutate(false)}>Disable account</button>
                  : <button className="btn-quiet w-full" onClick={() => toggle.mutate(true)}>Enable account</button>
              )}
              {s.account_status === 'active' && <p className="text-sm text-ink-muted">Sending new login details replaces the old password and signs the person out on all devices.</p>}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

export default function StaffPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const q = useQuery({ queryKey: ['staff', 'list', term], queryFn: () => api<StaffRow[]>('/staff', { query: { search: term, pageSize: 100 } }) });
  const rows = q.data?.data ?? [];
  const addButton = can('staff.create') && <button className="btn-primary w-full sm:w-auto" onClick={() => setAdding(true)}><Plus size={18} aria-hidden />Add staff member</button>;

  return (
    <div>
      <PageHeader title="Staff" description="Teachers and office staff. Each person logs in with their own mobile number or email." action={<div className="flex flex-wrap gap-2"><ExportButtons list="staff" params={{ search: term }} />{addButton}</div>} />
      <div className="relative mb-4">
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />
        <input className="field pl-10" placeholder="Search by name, mobile, email or code" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search staff" />
      </div>
      {q.isLoading ? <Skeleton /> : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
        : rows.length === 0 ? (term ? <EmptyState title="No matches" body={`No staff member matches “${term}”.`} />
          : <EmptyState title="No staff yet" body="Add your teachers and office staff, then send each of them their login details on WhatsApp." action={addButton} />) : (
        <>
          {/* Phones: cards */}
          <ul className="space-y-2 md:hidden">
            {rows.map((s) => (
              <li key={s.public_id}>
                <button onClick={() => setSelected(s.public_id)} className="panel w-full p-4 text-left">
                  <div className="flex items-start justify-between gap-3"><p className="font-semibold">{s.name}</p>{accountBadge(s)}</div>
                  <p className="mt-0.5 text-sm text-ink-muted">{s.roles ?? 'No role'}</p>
                  <p className="mt-1 text-sm">{s.mobile}</p>
                </button>
              </li>
            ))}
          </ul>
          {/* Larger screens: table */}
          <div className="panel hidden overflow-x-auto md:block">
            <table className="w-full text-left text-[15px]">
              <thead className="border-b border-line text-sm text-ink-muted">
                <tr><th className="px-4 py-3 font-medium">Name</th><th className="px-4 py-3 font-medium">Roles</th><th className="px-4 py-3 font-medium">Mobile</th><th className="px-4 py-3 font-medium">Code</th><th className="px-4 py-3 font-medium">Login</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((s) => (
                  <tr key={s.public_id} onClick={() => setSelected(s.public_id)} className="cursor-pointer hover:bg-chalk">
                    <td className="px-4 py-3"><button className="text-left font-semibold" onClick={() => setSelected(s.public_id)}>{s.name}</button><p className="text-sm text-ink-muted">{s.email}</p></td>
                    <td className="px-4 py-3">{s.roles ?? '-'}</td>
                    <td className="px-4 py-3">{s.mobile}</td>
                    <td className="px-4 py-3">{s.employee_code}</td>
                    <td className="px-4 py-3">{accountBadge(s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {addButton && <MobileAction>{addButton}</MobileAction>}
      <AddStaffSheet open={adding} onClose={() => setAdding(false)} onCreated={(s) => { setAdding(false); setSelected(s.public_id); }} />
      <StaffDetailSheet staffId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
