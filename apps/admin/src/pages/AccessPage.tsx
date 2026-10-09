import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Plus, Search, Trash2, Users } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { api, ApiError, fieldErrors } from '../lib/api';
import {
  actionLabel, applyLevel, DEFAULT_SCOPE, SCOPED_MODULES, LEVEL_LABEL, levelOf, moduleLabel, SCOPE_LABEL, scopeOf, WS_LABEL,
  type Grants, type Level, type ModuleInfo, type Scope, type Workspace,
} from '../lib/access';
import { Badge, EmptyState, ErrorState, Field, PageHeader, Sheet, Skeleton, Toggle } from '../components/ui';

interface Role { id: number; key: string; name: string; description: string | null; workspace: Workspace; isSystem: boolean; isActive: boolean; people: number; grants: Grants; fields: Record<string, 'hidden' | 'view'> }
interface Overview { modules: ModuleInfo[]; scopes: Record<Workspace, Scope[]>; roles: Role[]; fieldRules: Array<{ key: string; label: string }> }
interface Person { id: string; name: string; mobile: string | null; email: string | null; active: boolean; staffId: string | null; employeeCode: string | null;
  roles: Array<{ id: number; key: string; name: string; workspace: Workspace; isActive: boolean }>; workspaces: Workspace[];
  effective: Partial<Record<Workspace, Grants>>; overrides: Array<{ workspace: Workspace; perm: string; effect: 'grant' | 'deny'; scope: Scope | null }> }

const err = (e: unknown) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message);
const RANK: Record<Scope, number> = { all: 100, class: 60, section: 50, subject: 40, assigned_students: 30, assigned_route: 25, own_children: 10, own_records: 5 };
const useOverview = () => useQuery({ queryKey: ['access'], queryFn: () => api<Overview>('/developer/access').then((r) => r.data) });

function LevelPicker({ value, onChange, extra, single }: { value: Level; onChange: (l: Exclude<Level, 'custom'>) => void; extra?: React.ReactNode; single?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-line bg-chalk p-0.5" role="radiogroup">
        {(single ? (['none', 'view'] as const) : (['none', 'view', 'edit'] as const)).map((l) => (
          <button key={l} role="radio" aria-checked={value === l} onClick={() => onChange(l)}
            className={clsx('rounded-md px-2.5 py-1.5 text-sm font-semibold', value === l ? (l === 'none' ? 'bg-surface text-ink shadow-sm' : 'bg-surface text-brand shadow-sm') : 'text-ink-muted')}>{LEVEL_LABEL[l]}</button>))}
      </div>
      {value === 'custom' && <Badge tone="attention">Custom</Badge>}
      {extra}
    </div>
  );
}

function ScopeSelect({ ws, scopes, value, onChange, label }: { ws: Workspace; scopes: Scope[]; value: Scope; onChange: (s: Scope) => void; label: string }) {
  if (ws !== 'staff') return null;
  return <select className="field h-9 w-auto py-1 text-sm" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Scope)}>{scopes.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}</select>;
}

// ---------------- Roles ----------------
/** Which details on a student's record this staff role sees. Saves at once. */
function FieldRules({ role, data }: { role: Role; data: Overview }) {
  const qc = useQueryClient();
  const save = useMutation({ mutationFn: (f: Record<string, 'hidden' | 'view'>) => api<Overview>(`/developer/access/roles/${role.id}/fields`, { method: 'PUT', body: { fields: f } }),
    onSuccess: ({ data: d }) => { qc.setQueryData(['access'], d); toast.success('Saved. It applies right away.'); }, onError: err });
  return (
    <div className="panel p-4">
      <p className="font-semibold">Details on student records</p>
      <p className="mt-0.5 text-sm text-ink-muted">Hide private details from this role. If someone has two roles, they see a detail when either role shows it.</p>
      <ul className="mt-3 divide-y divide-line">{data.fieldRules.map((f) => {
        const v = role.fields?.[f.key] ?? 'view';
        return (
          <li key={f.key} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <span className="text-[15px] font-medium">{f.label}</span>
            <div className="inline-flex rounded-lg border border-line bg-chalk p-0.5" role="radiogroup" aria-label={f.label}>
              {(['view', 'hidden'] as const).map((o) => (
                <button key={o} role="radio" aria-checked={v === o} disabled={save.isPending} onClick={() => v !== o && save.mutate({ [f.key]: o })}
                  className={clsx('rounded-md px-3 py-1.5 text-sm font-semibold', v === o ? 'bg-surface shadow-sm ' + (o === 'view' ? 'text-brand' : 'text-ink') : 'text-ink-muted')}>{o === 'view' ? 'Visible' : 'Hidden'}</button>
              ))}
            </div>
          </li>);
      })}</ul>
    </div>
  );
}

function RoleEditor({ role, data, onDeleted }: { role: Role; data: Overview; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Grants>(role.grants);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState(role.name);
  useEffect(() => { setDraft(role.grants); setName(role.name); setOpen(null); }, [role]);
  const scopes = data.scopes[role.workspace];
  const changed = useMemo(() => { const a = role.grants, b = draft; const keys = new Set([...Object.keys(a), ...Object.keys(b)]); return [...keys].filter((k) => a[k] !== b[k]).length; }, [role.grants, draft]);
  const save = useMutation({ mutationFn: () => api<Overview>(`/developer/access/roles/${role.id}/grants`, { method: 'PUT', body: { grants: draft } }),
    onSuccess: ({ data: d }) => { qc.setQueryData(['access'], d); toast.success(`${role.name} saved. It applies right away.`); }, onError: err });
  const patch = useMutation({ mutationFn: (b: { name?: string; isActive?: boolean }) => api(`/developer/access/roles/${role.id}`, { method: 'PATCH', body: b }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['access'] }); toast.success('Role updated'); }, onError: err });
  const del = useMutation({ mutationFn: () => api(`/developer/access/roles/${role.id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['access'] }); toast.success('Role deleted'); onDeleted(); }, onError: err });
  const modules = data.modules.filter((m) => role.workspace === 'staff' || !['settings', 'users', 'roles', 'audit', 'imports', 'hr', 'payroll', 'expenses', 'cms', 'reports'].includes(m.key));
  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1"><Field label="Role name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== role.name && patch.mutate({ name: name.trim() })} /></Field></div>
          <label className="flex items-center gap-2 pb-2 text-sm font-medium">In use <Toggle checked={role.isActive} label="Role in use" onChange={(v) => patch.mutate({ isActive: v })} /></label>
          {!role.isSystem && <button className="btn-quiet min-h-11 text-sm text-danger" disabled={del.isPending} onClick={() => confirm(`Delete the role ${role.name}?`) && del.mutate()}><Trash2 size={16} aria-hidden />Delete</button>}
        </div>
        <p className="mt-2 text-sm text-ink-muted">{WS_LABEL[role.workspace]} login · {role.people} {role.people === 1 ? 'person' : 'people'}{role.isSystem ? ' · built-in role' : ''}{!role.isActive ? ' · switched off: nobody gets anything from this role' : ''}</p>
      </div>
      {role.workspace === 'staff' && data.fieldRules?.length > 0 && <FieldRules role={role} data={data} />}
      <ul className="panel divide-y divide-line">{modules.map((m) => {
        const lv = levelOf(draft, m); const sc = scopeOf(draft, m, role.workspace);
        return (
          <li key={m.key} className={clsx('px-4 py-3', !m.enabled && 'bg-chalk/60')}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0"><p className="font-semibold">{moduleLabel(m.key)}</p>{!m.enabled && <p className="text-xs text-ink-muted">Module switched off in the Developer console: nobody sees it until it is on.</p>}</div>
              <LevelPicker value={lv} single={m.actions.length === 1} onChange={(l) => setDraft(applyLevel(draft, m, l === 'view' && m.actions.length === 1 ? 'edit' : l, sc))}
                extra={<>{lv !== 'none' && SCOPED_MODULES.has(m.key) && <ScopeSelect ws={role.workspace} scopes={scopes} value={sc} label={`Whose records for ${moduleLabel(m.key)}`} onChange={(s) => setDraft(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, k.startsWith(`${m.key}.`) ? s : v])) as Grants)} />}
                  <button className="inline-flex items-center gap-1 text-sm font-semibold text-brand" aria-expanded={open === m.key} onClick={() => setOpen(open === m.key ? null : m.key)}>Advanced<ChevronDown size={16} className={clsx('transition-transform', open === m.key && 'rotate-180')} aria-hidden /></button></>} />
            </div>
            {open === m.key && (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">{m.actions.map((a) => { const k = `${m.key}.${a}`; const on = k in draft; return (
                <li key={a} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                  <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={on}
                    onChange={(e) => { const d = { ...draft }; if (e.target.checked) d[k] = sc; else delete d[k]; setDraft(d); }} />{actionLabel(a)}</label>
                  {on && SCOPED_MODULES.has(m.key) && <ScopeSelect ws={role.workspace} scopes={scopes} value={draft[k]} label={`Whose records for ${actionLabel(a)}`} onChange={(s) => setDraft({ ...draft, [k]: s })} />}
                </li>); })}</ul>
            )}
          </li>);
      })}</ul>
      <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-10 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface/95 p-3 backdrop-blur lg:bottom-4">
        <span className="text-sm text-ink-muted">{changed ? `${changed} change${changed > 1 ? 's' : ''} not saved` : 'No changes'}</span>
        <span className="flex gap-2"><button className="btn-quiet min-h-10 text-sm" disabled={!changed} onClick={() => setDraft(role.grants)}>Discard</button>
          <button className="btn-primary min-h-10 text-sm" disabled={!changed || save.isPending} onClick={() => save.mutate()}>Save {role.name}</button></span>
      </div>
    </div>
  );
}

function NewRoleSheet({ open, onClose, roles, onCreated }: { open: boolean; onClose: () => void; roles: Role[]; onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', workspace: 'staff' as Workspace, copyFrom: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setF({ name: '', workspace: 'staff', copyFrom: '' }); setErrors({}); } }, [open]);
  const m = useMutation({ mutationFn: () => api<{ id: number }>('/developer/access/roles', { method: 'POST', body: { name: f.name, workspace: f.workspace, copyFrom: f.copyFrom ? Number(f.copyFrom) : null } }),
    onSuccess: ({ data }) => { qc.invalidateQueries({ queryKey: ['access'] }); toast.success('Role created'); onCreated(data.id); onClose(); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(fe); if (!Object.keys(fe).length) err(e); } });
  return (
    <Sheet open={open} onClose={onClose} title="New role" footer={<button className="btn-primary w-full" disabled={m.isPending || f.name.trim().length < 2} onClick={() => m.mutate()}>Create role</button>}>
      <div className="space-y-4">
        <Field label="Role name" error={errors.name} hint="e.g. Office Manager, Hostel Warden, Sports Teacher"><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Start from" hint="Copy an existing role's access, then change it. Or start with no access."><select className="field" value={f.copyFrom} onChange={(e) => setF({ ...f, copyFrom: e.target.value })}>
          <option value="">No access (start empty)</option>{roles.filter((r) => r.workspace === f.workspace).map((r) => <option key={r.id} value={r.id}>Copy of {r.name}</option>)}</select></Field>
        <Field label="For which login"><select className="field" value={f.workspace} onChange={(e) => setF({ ...f, workspace: e.target.value as Workspace, copyFrom: '' })}>
          <option value="staff">Staff</option><option value="parent">Parents</option><option value="student">Students (college)</option></select></Field>
        <p className="text-sm text-ink-muted">Give the role to staff on the Staff screen (Edit → Roles).</p>
      </div>
    </Sheet>
  );
}

function RolesTab() {
  const q = useOverview();
  const [sel, setSel] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const roles = q.data?.roles ?? [];
  useEffect(() => { if (!sel && roles.length) setSel(roles.find((r) => r.key === 'principal')?.id ?? roles[0].id); }, [roles, sel]);
  if (q.isLoading) return <Skeleton />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  const role = roles.find((r) => r.id === sel);
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-3">
        <button className="btn-primary w-full" onClick={() => setAdding(true)}><Plus size={18} aria-hidden />New role</button>
        <select className="field lg:hidden" aria-label="Role" value={sel ?? ''} onChange={(e) => setSel(Number(e.target.value))}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name} ({WS_LABEL[r.workspace]})</option>)}</select>
        {(['staff', 'parent', 'student'] as const).map((w) => { const list = roles.filter((r) => r.workspace === w); return list.length ? (
          <div key={w} className="hidden lg:block"><p className="px-1 pb-1 text-xs font-semibold text-ink-muted">{WS_LABEL[w]} logins</p>
            <ul className="panel divide-y divide-line">{list.map((r) => (
              <li key={r.id}><button onClick={() => setSel(r.id)} className={clsx('flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm', sel === r.id ? 'bg-brand-soft font-semibold text-brand' : 'hover:bg-chalk', !r.isActive && 'opacity-60')}>
                <span className="truncate">{r.name}</span><span className="flex shrink-0 items-center gap-1 text-xs text-ink-muted"><Users size={12} aria-hidden />{r.people}</span></button></li>))}</ul></div>) : null; })}
      </aside>
      {role ? <RoleEditor role={role} data={q.data!} onDeleted={() => setSel(null)} /> : <EmptyState title="Choose a role" body="Pick a role on the left to see and change what it can do." />}
      <NewRoleSheet open={adding} onClose={() => setAdding(false)} roles={roles} onCreated={setSel} />
    </div>
  );
}

// ---------------- People ----------------
type Draft = Record<string, { effect: 'grant' | 'deny'; scope: Scope | null }>;

function PersonEditor({ person, data }: { person: Person; data: Overview }) {
  const qc = useQueryClient();
  const spaces = [...new Set<Workspace>([...person.workspaces, ...person.roles.map((r) => r.workspace)])];
  const [ws, setWs] = useState<Workspace>(spaces[0] ?? 'staff');
  const [open, setOpen] = useState<string | null>(null);
  const saved = (w: Workspace): Draft => Object.fromEntries(person.overrides.filter((o) => o.workspace === w).map((o) => [o.perm, { effect: o.effect, scope: o.scope }]));
  const [draft, setDraft] = useState<Draft>(saved(ws));
  useEffect(() => { setDraft(saved(ws)); setOpen(null); }, [person, ws]); // eslint-disable-line react-hooks/exhaustive-deps
  // What their roles give in this workspace (best scope wins).
  const fromRoles = useMemo(() => {
    const g: Grants = {};
    for (const pr of person.roles.filter((r) => r.workspace === ws && r.isActive)) {
      const role = data.roles.find((r) => r.id === pr.id); if (!role?.isActive) continue;
      for (const [k, s] of Object.entries(role.grants)) if (!g[k] || RANK[s] > RANK[g[k]]) g[k] = s;
    }
    return g;
  }, [person, ws, data]);
  const effective = useMemo(() => { const e: Grants = { ...fromRoles }; for (const [k, o] of Object.entries(draft)) { if (o.effect === 'deny') delete e[k]; else e[k] = o.scope ?? DEFAULT_SCOPE[ws]; } return e; }, [fromRoles, draft, ws]);
  const dirty = JSON.stringify(Object.entries(draft).sort()) !== JSON.stringify(Object.entries(saved(ws)).sort());
  const save = useMutation({ mutationFn: () => api<Person>(`/developer/access/people/${person.id}/exceptions`, { method: 'PUT', body: { workspace: ws, overrides: Object.entries(draft).map(([perm, o]) => ({ perm, effect: o.effect, scope: o.effect === 'grant' ? o.scope : null })) } }),
    onSuccess: ({ data: d }) => { qc.setQueryData(['access-person', person.id], d); toast.success(`Access for ${person.name} saved. It applies right away.`); }, onError: err });
  /** Sets a module to a level for this person: exceptions are only what differs from their roles. */
  const setModule = (m: ModuleInfo, level: Exclude<Level, 'custom'> | 'role') => {
    const d: Draft = { ...draft };
    for (const a of m.actions) delete d[`${m.key}.${a}`];
    if (level !== 'role') {
      const want = applyLevel({}, m, level, scopeOf(fromRoles, m, ws));
      for (const a of m.actions) { const k = `${m.key}.${a}`; if (k in want && !(k in fromRoles)) d[k] = { effect: 'grant', scope: want[k] }; if (!(k in want) && k in fromRoles) d[k] = { effect: 'deny', scope: null }; }
    }
    setDraft(d);
  };
  const modules = data.modules.filter((m) => ws === 'staff' || !['settings', 'users', 'roles', 'audit', 'imports', 'hr', 'payroll', 'expenses', 'cms', 'reports'].includes(m.key));
  const exceptions = Object.keys(draft).length;
  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <p className="text-lg font-semibold">{person.name} {!person.active && <Badge tone="danger">Login off</Badge>}</p>
        <p className="text-sm text-ink-muted">{[person.employeeCode, person.mobile, person.email].filter(Boolean).join(' · ')}</p>
        <p className="mt-2 text-sm">Roles: {person.roles.length ? person.roles.map((r) => r.name).join(', ') : 'none'}{person.staffId && <> · <Link to="/staff" className="font-semibold text-brand">change roles on the Staff screen</Link></>}</p>
        {spaces.length > 1 && <div className="mt-3 inline-flex rounded-lg border border-line bg-chalk p-0.5">{spaces.map((w) => <button key={w} aria-pressed={ws === w} onClick={() => setWs(w)} className={clsx('rounded-md px-3 py-1.5 text-sm font-semibold', ws === w ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted')}>{WS_LABEL[w]} login</button>)}</div>}
      </div>
      <ul className="panel divide-y divide-line">{modules.map((m) => {
        const mine = m.actions.some((a) => `${m.key}.${a}` in draft);
        const lv = levelOf(effective, m);
        return (
          <li key={m.key} className={clsx('px-4 py-3', !m.enabled && 'bg-chalk/60')}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0"><p className="font-semibold">{moduleLabel(m.key)} {mine && <Badge tone="attention">Exception</Badge>}</p>
                <p className="text-xs text-ink-muted">From roles: {levelOf(fromRoles, m) === 'custom' ? 'Custom' : LEVEL_LABEL[levelOf(fromRoles, m) as Exclude<Level, 'custom'>]}{!m.enabled ? ' · module switched off' : ''}</p></div>
              <LevelPicker value={lv} single={m.actions.length === 1} onChange={(l) => setModule(m, l === 'view' && m.actions.length === 1 ? 'edit' : l)} extra={<>
                {mine && <button className="text-sm font-semibold text-ink-muted underline" onClick={() => setModule(m, 'role')}>Same as role</button>}
                <button className="inline-flex items-center gap-1 text-sm font-semibold text-brand" aria-expanded={open === m.key} onClick={() => setOpen(open === m.key ? null : m.key)}>Advanced<ChevronDown size={16} className={clsx('transition-transform', open === m.key && 'rotate-180')} aria-hidden /></button></>} />
            </div>
            {open === m.key && <ul className="mt-3 grid gap-2 sm:grid-cols-2">{m.actions.map((a) => { const k = `${m.key}.${a}`; const o = draft[k]; const val = o ? o.effect : 'role'; return (
              <li key={a} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <span className="font-medium">{actionLabel(a)} <span className="font-normal text-ink-muted">({k in effective ? 'yes' : 'no'})</span></span>
                <select className="field h-9 w-auto py-1 text-sm" aria-label={`${actionLabel(a)} for ${person.name}`} value={val} onChange={(e) => {
                  const d = { ...draft }; const v = e.target.value; if (v === 'role') delete d[k]; else d[k] = { effect: v as 'grant' | 'deny', scope: v === 'grant' ? (fromRoles[k] ?? DEFAULT_SCOPE[ws]) : null }; setDraft(d); }}>
                  <option value="role">As role ({k in fromRoles ? 'yes' : 'no'})</option><option value="grant">Allow</option><option value="deny">Do not allow</option></select>
              </li>); })}</ul>}
          </li>);
      })}</ul>
      <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-10 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface/95 p-3 backdrop-blur lg:bottom-4">
        <span className="text-sm text-ink-muted">{exceptions ? `${exceptions} exception${exceptions > 1 ? 's' : ''} for ${person.name}` : 'Same as their roles'}{dirty ? ' · not saved' : ''}</span>
        <span className="flex gap-2"><button className="btn-quiet min-h-10 text-sm" disabled={!exceptions} onClick={() => setDraft({})}>Clear all</button>
          <button className="btn-primary min-h-10 text-sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save</button></span>
      </div>
    </div>
  );
}

function PeopleTab() {
  const ov = useOverview();
  const [search, setSearch] = useState(''); const [term, setTerm] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const found = useQuery({ queryKey: ['proxy-users', '', term], enabled: term.length >= 2, queryFn: () => api<Array<{ id: string; name: string; kind: string; detail: string }>>('/developer/proxy-users', { query: { search: term } }).then((r) => r.data) });
  const person = useQuery({ queryKey: ['access-person', sel], enabled: !!sel, queryFn: () => api<Person>(`/developer/access/people/${sel}`).then((r) => r.data) });
  return (
    <div className="space-y-4">
      <div className="relative max-w-xl"><Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />
        <input className="field pl-10" placeholder="Find a staff member, parent or student" value={search} onChange={(e) => { setSearch(e.target.value); }} aria-label="Find a person" />
        {term.length >= 2 && !!found.data?.length && !person.data?.name?.startsWith(search) && (
          <ul className="panel absolute inset-x-0 top-full z-20 mt-1 max-h-72 divide-y divide-line overflow-y-auto">{found.data.map((u) => (
            <li key={u.id}><button className="w-full px-3 py-2 text-left hover:bg-chalk" onClick={() => { setSel(u.id); setSearch(u.name); setTerm(''); }}><span className="font-medium">{u.name}</span> <span className="text-sm text-ink-muted">· {u.kind} · {u.detail}</span></button></li>))}</ul>)}
      </div>
      {!sel ? <EmptyState title="Choose a person" body="Give someone more access than their role, or take some away. Everything else stays as their role says." />
        : person.isLoading || ov.isLoading ? <Skeleton /> : person.isError ? <ErrorState message={(person.error as Error).message} /> : <PersonEditor person={person.data!} data={ov.data!} />}
    </div>
  );
}

export default function AccessPage() {
  const [tab, setTab] = useState<'roles' | 'people'>('roles');
  return (
    <div>
      <PageHeader title="Access & roles" description="What each role, and each person, can see and do. Changes apply right away. The developer login always has full access." />
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-lg border border-line bg-chalk p-0.5 sm:inline-flex">
        {([['roles', 'Roles'], ['people', 'People']] as const).map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)} className={clsx('shrink-0 rounded-md px-4 py-2 text-sm font-semibold', tab === k ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted')}>{l}</button>)}
      </div>
      {tab === 'roles' ? <RolesTab /> : <PeopleTab />}
    </div>
  );
}
