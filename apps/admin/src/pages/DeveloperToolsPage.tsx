import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronDown, LogIn, Search } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import ExportButtons from '../components/ExportButtons';
import { Badge, EmptyState, ErrorState, Field, PageHeader, Skeleton } from '../components/ui';

// ---------------- Login as ----------------
interface ProxyUser { id: string; name: string; kind: string; detail: string; mobile: string | null; email: string | null; active: boolean }
const TYPES = [['', 'Everyone'], ['staff', 'Staff'], ['driver', 'Drivers'], ['parent', 'Parents'], ['student', 'Students']] as const;

export function LoginAsPage() {
  const { startProxy } = useAuth();
  const nav = useNavigate();
  const [type, setType] = useState<string>('');
  const [search, setSearch] = useState(''); const [term, setTerm] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const q = useQuery({ queryKey: ['proxy-users', type, term], queryFn: () => api<ProxyUser[]>('/developer/proxy-users', { query: { type: type || undefined, search: term || undefined } }).then((r) => r.data) });
  const go = async (u: ProxyUser) => {
    setBusy(u.id);
    try { await startProxy(u.id); nav('/', { replace: true }); toast.success(`You are now using ${u.name}'s login`); }
    catch (e) { toast.error((e as ApiError).message); }
    finally { setBusy(null); }
  };
  return (
    <div>
      <PageHeader title="Login as" description="Open the app exactly as a staff member, parent, student or driver sees it. What you do is saved in their name, and the activity log records that you did it. Press Back to my login at the top to return." />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-chalk p-0.5">
          {TYPES.map(([k, label]) => <button key={k} aria-pressed={type === k} onClick={() => setType(k)} className={clsx('shrink-0 rounded-md px-3 py-2 text-sm font-semibold', type === k ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted')}>{label}</button>)}
        </div>
        <div className="relative min-w-0 flex-1 sm:min-w-72"><Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input className="field pl-10" placeholder="Name, mobile, email, employee code or child's name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a person" /></div>
      </div>
      {q.isLoading ? <Skeleton /> : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /> : !q.data!.length ? (
        <EmptyState title="Nobody found" body="Try another name or mobile number. Only people with a login appear here." />
      ) : (
        <ul className="panel divide-y divide-line">{q.data!.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft font-semibold text-brand">{u.name[0]}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{u.name} <Badge tone={u.kind === 'Parent' ? 'attention' : u.kind === 'Student' ? 'neutral' : 'brand'}>{u.kind}</Badge>{!u.active && <> <Badge tone="danger">Login off</Badge></>}</p>
              <p className="truncate text-sm text-ink-muted">{[u.detail, u.mobile, u.email].filter(Boolean).join(' · ')}</p>
            </div>
            <button className="btn-quiet min-h-10 text-sm" disabled={!u.active || !!busy} onClick={() => go(u)}><LogIn size={16} aria-hidden />{busy === u.id ? 'Opening…' : 'Login as'}</button>
          </li>))}</ul>
      )}
    </div>
  );
}

// ---------------- Activity log ----------------
interface Row {
  id: string; at: string; type: 'signin' | 'change' | 'download'; userId: string | null; who: string; workspace: string | null; actingName: string | null;
  module: string | null; action: string; success: boolean; reason: string | null; entityType: string | null; entityId: number | null; entity: string | null;
  before: unknown; after: unknown; ip: string | null; device: string | null;
}
const MODULE: Record<string, string> = {
  auth: 'Login', users: 'Logins', features: 'Modules', staff: 'Staff', students: 'Students', families: 'Parents', academics: 'Classes & teachers', announcements: 'Notices', settings: 'Settings',
  fees: 'Fees', payments: 'Fee receipts', attendance: 'Attendance', timetable: 'Timetable', exams: 'Exams', marks: 'Marks', cms: 'Website', reports: 'Downloads', imports: 'Bulk import',
  year_end: 'Year end', hr: 'HR', payroll: 'Payroll', expenses: 'Expenses', transport: 'Transport', inventory: 'Stock & sales', developer: 'Developer', roles: 'Roles',
};
const ACTION: Record<string, string> = {
  login: 'Signed in', logout: 'Signed out', login_failed: 'Sign-in failed', proxy_start: 'Started Login as', proxy_end: 'Ended Login as', password_changed: 'Changed password',
  password_reset: 'Reset password by email', refresh_token_reuse: 'Suspicious session reuse (all sessions signed out)', issue_credentials: 'Sent new login details',
  export: 'Downloaded list', download: 'Downloaded file', collect: 'Collected fee', void: 'Voided receipt', create: 'Added', update: 'Changed', publish: 'Published', archive: 'Archived',
  approve: 'Approved', reject: 'Rejected', return: 'Sent back', submit: 'Submitted', save: 'Saved', cancel: 'Cancelled', enable: 'Turned login on', disable: 'Turned login off',
  activate: 'Made active', deactivate: 'Made inactive', sale: 'Sold items', cancel_sale: 'Cancelled sale', mark_paid: 'Marked salaries paid', finalise: 'Finalised payroll',
  switch_year: 'Switched academic year', waiver: 'Gave a fee waiver', staff_check_in: 'Checked in', leave_approve: 'Approved leave', leave_reject: 'Rejected leave',
};
const REASON: Record<string, string> = { bad_password: 'wrong password', bad_password_locked: 'wrong password, account locked 15 min', locked: 'account locked', unknown_user: 'no such login', disabled: 'login turned off', no_password: 'login details not sent yet', no_workspace: 'no access' };
const words = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const what = (r: Row) => {
  if (r.type === 'signin') return `${ACTION[r.action]}${r.reason ? ` (${REASON[r.reason] ?? words(r.reason)})` : ''}`;
  if (r.action === 'export') return `Downloaded ${words(String((r.after as any)?.list ?? 'list'))} (${String((r.after as any)?.format ?? '').toUpperCase()})`;
  if (r.action === 'download') return `Downloaded ${String((r.after as any)?.file ?? 'file')}`;
  if (r.module === 'features') return `${r.action === 'enable' ? 'Switched on' : 'Switched off'} module ${MODULE[String((r.after as any)?.module)] ?? words(String((r.after as any)?.module ?? ''))}`;
  if (r.module === 'auth' && (r.action === 'proxy_start' || r.action === 'proxy_end')) return `${ACTION[r.action]}`;
  return `${MODULE[r.module ?? ''] ?? words(r.module ?? '')}: ${ACTION[r.action] ?? words(r.action)}`;
};
const ist = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const istDaysAgo = (n: number) => new Date(Date.now() + 5.5 * 3600_000 - n * 86_400_000).toISOString().slice(0, 10);
const show = (v: unknown): string => (v === null || v === undefined || v === '' ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function Details({ r }: { r: Row }) {
  const b = (r.before && typeof r.before === 'object' ? r.before : {}) as Record<string, unknown>;
  const a = (r.after && typeof r.after === 'object' ? r.after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return (
    <div className="mt-2 rounded-lg bg-chalk p-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {r.entity && <><dt className="text-ink-muted">About</dt><dd>{r.entity}</dd></>}
        {r.entityType && !r.entity && <><dt className="text-ink-muted">About</dt><dd>{words(r.entityType)} #{r.entityId}</dd></>}
        <dt className="text-ink-muted">Device</dt><dd>{r.device ?? '-'}{r.ip ? ` · ${r.ip}` : ''}</dd>
        {r.workspace && r.workspace !== 'staff' && <><dt className="text-ink-muted">Workspace</dt><dd>{words(r.workspace)}</dd></>}
      </dl>
      {keys.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-ink-muted"><tr><th className="py-1 pr-3 font-medium">Field</th>{Object.keys(b).length > 0 && <th className="py-1 pr-3 font-medium">Before</th>}<th className="py-1 font-medium">{Object.keys(b).length ? 'After' : 'Value'}</th></tr></thead>
            <tbody>{keys.map((k) => { const changed = Object.keys(b).length > 0 && show(b[k]) !== show(a[k]); return (
              <tr key={k} className={clsx('align-top', changed && 'bg-tangedu-soft/60')}><td className="py-1 pr-3 text-ink-muted">{words(k)}</td>
                {Object.keys(b).length > 0 && <td className="max-w-xs break-words py-1 pr-3">{show(b[k])}</td>}<td className="max-w-md break-words py-1">{show(a[k])}</td></tr>); })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ActivityPage() {
  const [from, setFrom] = useState(istDaysAgo(6));
  const [to, setTo] = useState(istToday());
  const [type, setType] = useState('');
  const [module, setModule] = useState('');
  const [proxyOnly, setProxyOnly] = useState(false);
  const [person, setPerson] = useState<{ id: string; name: string } | null>(null);
  const [find, setFind] = useState(''); const [term, setTerm] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setTerm(find.trim()), 250); return () => clearTimeout(t); }, [find]);
  const people = useQuery({ queryKey: ['proxy-users', '', term], enabled: term.length >= 2 && !person, queryFn: () => api<ProxyUser[]>('/developer/proxy-users', { query: { search: term } }).then((r) => r.data) });
  const modules = useQuery({ queryKey: ['activity-modules'], queryFn: () => api<string[]>('/developer/activity/modules').then((r) => r.data) });
  const params = { from, to, type: type || undefined, module: module || undefined, proxyOnly: proxyOnly ? '1' : undefined, userId: person?.id };
  const q = useInfiniteQuery({
    queryKey: ['activity', params], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<{ rows: Row[]; next: string | null }>('/developer/activity', { query: { ...params, before: pageParam, limit: 100 } as any }).then((r) => r.data),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.rows) ?? [], [q.data]);
  const days = useMemo(() => { const m = new Map<string, Row[]>(); for (const r of rows) { const d = new Date(r.at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); m.set(d, [...(m.get(d) ?? []), r]); } return [...m]; }, [rows]);
  return (
    <div>
      <PageHeader title="Activity log" description="Who signed in, who changed what, and who downloaded which list. Times are India time. Entries are kept for 2 years."
        action={<ExportButtons list="activity" params={params} name={`activity-${from}-to-${to}`} />} />
      <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        <Field label="From"><input type="date" className="field" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className="field" value={to} min={from} max={istToday()} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Type"><select className="field" value={type} onChange={(e) => setType(e.target.value)}><option value="">Everything</option><option value="signin">Sign-ins and sign-outs</option><option value="change">Changes</option><option value="download">Downloads</option></select></Field>
        <Field label="Area"><select className="field" value={module} onChange={(e) => setModule(e.target.value)} disabled={type === 'signin'}><option value="">All</option>{modules.data?.map((m) => <option key={m} value={m}>{MODULE[m] ?? words(m)}</option>)}</select></Field>
        <div className="relative col-span-2 sm:min-w-64 sm:flex-1">
          <span className="label">Person</span>
          {person ? <div className="field flex items-center justify-between"><span className="truncate">{person.name}</span><button className="text-sm font-semibold text-brand" onClick={() => { setPerson(null); setFind(''); }}>Clear</button></div> : (
            <><input className="field" placeholder="Anyone. Type a name to filter" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Filter by person" />
              {term.length >= 2 && !!people.data?.length && <ul className="panel absolute inset-x-0 top-full z-10 mt-1 max-h-64 divide-y divide-line overflow-y-auto">{people.data.map((u) => (
                <li key={u.id}><button className="w-full px-3 py-2 text-left hover:bg-chalk" onClick={() => setPerson({ id: u.id, name: u.name })}><span className="font-medium">{u.name}</span> <span className="text-sm text-ink-muted">· {u.kind}</span></button></li>))}</ul>}</>)}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={proxyOnly} onChange={(e) => setProxyOnly(e.target.checked)} />Only what was done through Login as</label>
        <span className="flex gap-3 font-semibold text-brand"><button onClick={() => { setFrom(istToday()); setTo(istToday()); }}>Today</button><button onClick={() => { setFrom(istDaysAgo(6)); setTo(istToday()); }}>Last 7 days</button><button onClick={() => { setFrom(istDaysAgo(29)); setTo(istToday()); }}>Last 30 days</button></span>
      </div>
      {q.isLoading ? <Skeleton rows={6} /> : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /> : !rows.length ? (
        <EmptyState title="Nothing in these dates" body="Change the dates or filters." />
      ) : (
        <div className="space-y-5">
          {days.map(([day, list]) => (
            <section key={day}>
              <h2 className="mb-2 text-sm font-semibold text-ink-muted">{day}</h2>
              <ul className="panel divide-y divide-line">{list.map((r) => (
                <li key={r.id} className="px-4 py-2.5">
                  <button className="flex w-full items-start gap-3 text-left" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                    <span className="w-20 shrink-0 pt-0.5 text-sm tabular-nums text-ink-muted">{new Date(r.at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block"><b>{r.who}</b> <span className={clsx(!r.success && 'font-semibold text-danger')}>{what(r)}</span>{r.entity && r.type !== 'signin' && <span className="text-ink-muted"> · {r.entity}</span>}</span>
                      <span className="mt-0.5 flex flex-wrap gap-1.5">
                        {r.actingName && <Badge tone="attention">done by {r.actingName} via Login as</Badge>}
                        {r.device && <span className="text-xs text-ink-muted">{r.device}{r.ip ? ` · ${r.ip}` : ''}</span>}
                      </span>
                    </span>
                    <ChevronDown size={18} className={clsx('mt-0.5 shrink-0 text-ink-muted transition-transform', open === r.id && 'rotate-180')} aria-hidden />
                  </button>
                  {open === r.id && <Details r={r} />}
                </li>))}</ul>
            </section>
          ))}
          {q.hasNextPage && <button className="btn-quiet w-full" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>{q.isFetchingNextPage ? 'Loading…' : 'Show older entries'}</button>}
          <p className="text-center text-sm text-ink-muted">{rows.length} entries shown, oldest {ist(rows[rows.length - 1].at)}</p>
        </div>
      )}
    </div>
  );
}

