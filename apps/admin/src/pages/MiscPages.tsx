import PhoneAlerts from '../components/PhoneAlerts';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { LogOut } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { EmptyState, PageHeader, Sheet, Skeleton } from '../components/ui';
import { NAV, WorkspaceSwitch } from '../components/AppShell';
import { ChangePasswordForm } from './AuthPages';

export function ProfilePage() {
  const auth = useAuth();
  const me = auth.me!;
  const [pwOpen, setPwOpen] = useState(false);
  const links = NAV.filter((n) => n.to !== '/' && n.show(auth));
  return (
    <div className="max-w-xl">
      <PageHeader title={me.user.name} description={[me.user.mobile, me.user.email].filter(Boolean).join(' / ')} />
      {me.workspaces.length > 1 && (
        <section className="panel mb-4 p-4">
          <p className="mb-2 font-semibold">View as</p>
          <WorkspaceSwitch compact />
          <p className="mt-2 text-sm text-ink-muted">Parent view shows only your own children.</p>
        </section>
      )}
      {links.length > 0 && (
        <ul className="panel mb-4 divide-y divide-line lg:hidden">
          {links.map((l) => <li key={l.to}><Link to={l.to} className="flex items-center gap-3 px-4 py-3.5 font-medium"><l.icon size={18} className="text-brand" aria-hidden />{l.label}</Link></li>)}
        </ul>
      )}
      <div className="mb-4"><PhoneAlerts /></div>
      <div className="space-y-2">
        <button className="btn-quiet w-full" onClick={() => setPwOpen(true)}>Change password</button>
        <button className="btn-quiet w-full" onClick={auth.logout}><LogOut size={16} aria-hidden />Log out</button>
      </div>
      <Sheet open={pwOpen} onClose={() => setPwOpen(false)} title="Change password"><ChangePasswordForm onDone={() => setPwOpen(false)} /></Sheet>
    </div>
  );
}

export const TasksPage = () => (
  <div><PageHeader title="Tasks" /><EmptyState title="Nothing waiting for you" body="Approvals such as discount requests and marks corrections will appear here." /></div>
);
interface Note { id: number; title: string; body: string | null; link_path: string | null; read_at: string | null; created_at: string }
export function AlertsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<Note[]>('/notifications').then((r) => r.data) });
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['unread'] }); } });
  const open = async (n: Note) => {
    if (!n.read_at) { await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined); qc.invalidateQueries({ queryKey: ['unread'] }); qc.invalidateQueries({ queryKey: ['notifications'] }); }
    if (n.link_path) navigate(n.link_path);
  };
  const unread = (q.data ?? []).filter((n) => !n.read_at).length;
  return (
    <div className="max-w-2xl">
      <PageHeader title="Alerts" action={unread > 0 ? <button className="btn-quiet min-h-9 text-sm" onClick={() => readAll.mutate()}>Mark all read</button> : undefined} />
      <div className="mb-4"><PhoneAlerts compact /></div>
      {q.isLoading ? <Skeleton rows={3} /> : !q.data?.length ? <EmptyState title="No alerts" body="Notices from the school and system messages will appear here." /> : (
        <ul className="panel divide-y divide-line">
          {q.data.map((n) => (
            <li key={n.id}>
              <button onClick={() => open(n)} className="flex w-full gap-3 px-4 py-3.5 text-left hover:bg-chalk">
                <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : 'bg-tangedu'}`} aria-label={n.read_at ? undefined : 'Unread'} />
                <span className="min-w-0 flex-1">
                  <span className={`block ${n.read_at ? 'font-medium text-ink-muted' : 'font-semibold'}`}>{n.title}</span>
                  {n.body && <span className="mt-0.5 line-clamp-2 block text-sm text-ink-muted">{n.body}</span>}
                  <span className="mt-1 block text-xs text-ink-muted">{new Date(n.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {unread > 0 && <div className="mt-3 sm:hidden"><button className="btn-quiet w-full" onClick={() => readAll.mutate()}>Mark all read</button></div>}
    </div>
  );
}
export const SearchPage = () => {
  const auth = useAuth();
  return (
    <div>
      <PageHeader title="Search" />
      {auth.can('students.view') && auth.me?.workspace === 'staff'
        ? <EmptyState title="Find a student" body="Search by name, admission number, parent name or mobile on the Students page." action={<Link to="/students" className="btn-primary">Open Students</Link>} />
        : <EmptyState title="Search is coming" body="You will be able to find receipts and notices here." />}
    </div>
  );
};
export const NotFoundPage = () => (
  <EmptyState title="Page not found" body="This page does not exist or you do not have access to it." action={<Link to="/" className="btn-primary">Go home</Link>} />
);
