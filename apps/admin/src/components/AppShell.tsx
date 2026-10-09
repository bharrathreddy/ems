import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Bell, BookOpen, CheckSquare, Home, LogOut, Search, Settings, Users, Wrench, UserRound, ArrowLeftRight, GraduationCap, Megaphone, FileSpreadsheet, Wallet, ReceiptText, AlertCircle, SlidersHorizontal, Grid3x3, CalendarDays, Globe, CalendarClock, UserCheck, CalendarOff, ClipboardList, PenLine, Banknote, Receipt, FileText, Bus, Package, ShoppingBag, Eye, History, UserCog, ShieldCheck } from 'lucide-react';
import { useUnreadCount } from '../lib/notifications';
import { VersionBanner } from './ServerCheck';
import { startAutoFlush } from '../lib/offline';
import { toast } from 'sonner';
import clsx from 'clsx';
import { useAuth, type Workspace } from '../lib/auth';

export interface NavItem { to: string; label: string; icon: typeof Home; show: (a: ReturnType<typeof useAuth>) => boolean; group: string }

export const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, show: () => true, group: '' },
  { to: '/students', label: 'Students', icon: GraduationCap, show: (a) => a.can('students.view') && a.me?.workspace === 'staff', group: 'People' },
  { to: '/students', label: 'Your children', icon: GraduationCap, show: (a) => a.can('students.view') && a.me?.workspace !== 'staff', group: '' },
  { to: '/staff', label: 'Staff', icon: Users, show: (a) => a.can('staff.view'), group: 'People' },
  { to: '/fees/collect', label: 'Collect fees', icon: Wallet, show: (a) => a.can('payments.collect') && a.me?.workspace === 'staff', group: 'Fees' },
  { to: '/fees/dues', label: 'Dues', icon: AlertCircle, show: (a) => a.me?.permissions['fees.view'] === 'all' && a.can('fees.view'), group: 'Fees' },
  { to: '/fees/receipts', label: 'Receipts', icon: ReceiptText, show: (a) => a.me?.permissions['payments.view'] === 'all' && a.can('payments.view'), group: 'Fees' },
  { to: '/fees/setup', label: 'Fee setup', icon: SlidersHorizontal, show: (a) => a.can('fees.configure'), group: 'Fees' },
  { to: '/payroll', label: 'Payroll', icon: Banknote, show: (a) => a.can('payroll.view') && a.me?.workspace === 'staff', group: 'Payroll & spending' },
  { to: '/expenses', label: 'Expenses', icon: Receipt, show: (a) => a.can('expenses.view') && a.me?.workspace === 'staff', group: 'Payroll & spending' },
  { to: '/payslips', label: 'My payslips', icon: FileText, show: (a) => a.me?.workspace === 'staff' && !!a.me?.features?.payroll && !a.me?.user.isSuperAdmin, group: 'Payroll & spending' },
  { to: '/sales', label: 'Sales counter', icon: ShoppingBag, show: (a) => a.can('inventory.sell') && a.me?.workspace === 'staff', group: 'Operations' },
  { to: '/stock', label: 'Stock', icon: Package, show: (a) => a.can('inventory.view') && a.me?.workspace === 'staff', group: 'Operations' },
  { to: '/transport', label: 'Transport', icon: Bus, show: (a) => a.me?.permissions['transport.view'] === 'all' && a.can('transport.view') && a.me?.workspace === 'staff', group: 'Operations' },
  { to: '/transport', label: 'My bus', icon: Bus, show: (a) => a.me?.permissions['transport.view'] === 'assigned_route' && a.can('transport.view') && a.me?.workspace === 'staff', group: 'Operations' },
  { to: '/announcements', label: 'Notices', icon: Megaphone, show: (a) => a.can('announcements.view'), group: 'Communication' },
  { to: '/attendance', label: 'Attendance', icon: UserCheck, show: (a) => a.can('attendance.view') && a.me?.workspace === 'staff', group: 'Academic' },
  { to: '/leave', label: 'Leave requests', icon: CalendarOff, show: (a) => a.me?.workspace === 'staff', group: 'Academic' },
  { to: '/exams', label: 'Exams', icon: ClipboardList, show: (a) => a.can('exams.view') && a.me?.workspace === 'staff', group: 'Academic' },
  { to: '/marks', label: 'Marks', icon: PenLine, show: (a) => (a.can('marks.enter') || a.me?.permissions['marks.view'] === 'section') && a.me?.workspace === 'staff', group: 'Academic' },
  { to: '/timetable', label: 'Timetable', icon: CalendarDays, show: (a) => a.can('timetable.view') && a.me?.workspace === 'staff', group: 'Academic' },
  { to: '/teaching', label: 'Teaching grid', icon: Grid3x3, show: (a) => a.can('academics.manage') && a.me?.workspace === 'staff', group: 'Academic' },
  { to: '/year-end', label: 'Year end', icon: CalendarClock, show: (a) => a.me?.workspace === 'staff' && (!!a.me?.user.isSuperAdmin || a.me?.permissions['roles.configure'] === 'all'), group: 'Academic' },
  { to: '/academics', label: 'Classes & years', icon: BookOpen, show: (a) => a.can('academics.view') && a.me?.workspace === 'staff', group: 'Academic' },
  { to: '/website', label: 'Website', icon: Globe, show: (a) => a.can('cms.view') && a.me?.workspace === 'staff', group: 'Communication' },
  { to: '/imports', label: 'Bulk import', icon: FileSpreadsheet, show: (a) => a.can('imports.run'), group: 'Administration' },
  { to: '/settings', label: 'School settings', icon: Settings, show: (a) => a.can('settings.view'), group: 'Administration' },
  { to: '/access', label: 'Access & roles', icon: ShieldCheck, show: (a) => !!a.me?.user.isSuperAdmin && a.me.workspace === 'staff', group: 'Administration' },
  { to: '/login-as', label: 'Login as', icon: UserCog, show: (a) => !!a.me?.user.isSuperAdmin && a.me.workspace === 'staff', group: 'Administration' },
  { to: '/activity', label: 'Activity log', icon: History, show: (a) => !!a.me?.user.isSuperAdmin && a.me.workspace === 'staff', group: 'Administration' },
  { to: '/developer', label: 'Developer console', icon: Wrench, show: (a) => !!a.me?.user.isSuperAdmin && a.me.workspace === 'staff', group: 'Administration' },
];

const WS_LABEL: Record<Workspace, string> = { staff: 'Staff', parent: 'Parent', student: 'Student' };

export function WorkspaceSwitch({ compact = false }: { compact?: boolean }) {
  const auth = useAuth();
  const me = auth.me!;
  if (me.workspaces.length < 2) return null;
  return (
    <div className={clsx('inline-flex rounded-lg border border-line bg-chalk p-0.5', compact && 'w-full')} role="group" aria-label="Switch view">
      {me.workspaces.map((w) => (
        <button key={w} onClick={() => w !== me.workspace && auth.switchWorkspace(w)} aria-pressed={w === me.workspace}
          className={clsx('flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
            w === me.workspace ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink')}>
          {WS_LABEL[w]}
        </button>
      ))}
    </div>
  );
}

export default function AppShell() {
  useEffect(() => startAutoFlush((r) => {
    if (r.sent) toast.success(`${r.sent} saved attendance sheet${r.sent > 1 ? 's' : ''} sent`);
    r.failed.forEach((f) => toast.error(`${f.item.sectionName} (${f.item.date}): ${f.message}`));
  }), []);
  const auth = useAuth();
  const unread = useUnreadCount().data ?? 0;
  const items = NAV.filter((n) => n.show(auth));
  const groups = [...new Set(items.map((i) => i.group))];
  const { pathname } = useLocation();
  const proxy = auth.me?.proxy;

  return (
    <>
    {proxy && (
      <div role="status" className="sticky top-0 z-40 flex h-12 items-center justify-between gap-3 bg-[#7A5A00] px-4 text-sm text-white">
        <p className="min-w-0 truncate"><Eye size={16} className="mr-1.5 inline" aria-hidden />Logged in as <b>{auth.me?.user.name}</b><span className="hidden sm:inline"> · everything you do is saved in their name</span></p>
        <button onClick={() => void auth.endProxy()} className="shrink-0 rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-[#7A5A00] hover:bg-white/90">Back to my login</button>
      </div>
    )}
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_1fr]">
      {/* Desktop sidebar */}
      <aside className={clsx('sticky hidden flex-col border-r border-line bg-surface lg:flex', proxy ? 'top-12 h-[calc(100dvh-3rem)]' : 'top-0 h-dvh')}>
        <div className="px-5 pb-4 pt-6">
          <p className="text-[17px] font-bold leading-tight">{auth.branding?.name ?? 'School Office'}</p>
          <p className="mt-0.5 text-sm text-ink-muted">{auth.me?.workspace === 'staff' ? 'Staff workspace' : auth.me?.workspace === 'student' ? 'Student' : 'Parent workspace'}</p>
        </div>
        <div className="px-4 pb-3"><WorkspaceSwitch compact /></div>
        <nav className="flex-1 overflow-y-auto px-3" aria-label="Main">
          {groups.map((g) => (
            <div key={g} className="mb-4">
              {g && <p className="px-3 pb-1 text-xs font-semibold text-ink-muted">{g}</p>}
              {items.filter((i) => i.group === g).map((i) => (
                <NavLink key={`${i.to}-${i.label}`} to={i.to} end={i.to === "/"}
                  className={({ isActive }) => clsx('flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium',
                    isActive ? 'bg-brand-soft text-brand' : 'text-ink hover:bg-chalk')}>
                  <i.icon size={18} aria-hidden /> {i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <NavLink to="/alerts" className={({ isActive }) => clsx('mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'bg-brand-soft text-brand' : 'text-ink-muted hover:bg-chalk hover:text-ink')}>
            <Bell size={16} aria-hidden /> Alerts {unread > 0 && <span className="ml-auto rounded-full bg-tangedu px-2 text-xs font-bold text-ink">{unread}</span>}
          </NavLink>
          <NavLink to="/profile" className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-chalk">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-soft font-semibold text-brand">{auth.me?.user.name[0]}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{auth.me?.user.name}</span>
              <span className="block truncate text-xs text-ink-muted">{auth.me?.user.email ?? auth.me?.user.mobile}</span></span>
          </NavLink>
          <button onClick={auth.logout} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted hover:bg-chalk hover:text-ink">
            <LogOut size={16} aria-hidden /> {proxy ? 'Back to my login' : 'Log out'}
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        <VersionBanner />
        {/* Mobile top bar */}
        <header className={clsx('sticky z-30 flex items-center justify-between border-b border-line bg-surface/95 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur lg:hidden', proxy ? 'top-12' : 'top-0')}>
          <p className="truncate text-base font-bold">{auth.branding?.short_name ?? auth.branding?.name ?? 'School Office'}</p>
          {auth.me && auth.me.workspaces.length > 1 && (
            <button onClick={() => auth.switchWorkspace(auth.me!.workspace === 'staff' ? 'parent' : 'staff')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm font-semibold">
              <ArrowLeftRight size={14} aria-hidden /> {WS_LABEL[auth.me.workspace]}
            </button>
          )}
        </header>

        <main className="mx-auto max-w-6xl px-4 pb-40 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
          <Outlet />
        </main>

        {/* Mobile bottom navigation (requirements 17) */}
        <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
          {[{ to: '/', label: 'Home', icon: Home }, { to: '/search', label: 'Search', icon: Search }, { to: '/tasks', label: 'Tasks', icon: CheckSquare },
            { to: '/alerts', label: 'Alerts', icon: Bell }, { to: '/profile', label: 'Profile', icon: UserRound }].map((t) => {
            const active = t.to === '/' ? pathname === '/' : pathname.startsWith(t.to);
            return (
              <NavLink key={t.to} to={t.to} className={clsx('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', active ? 'text-brand' : 'text-ink-muted')}>
                <span className="relative"><t.icon size={22} strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                  {t.to === '/alerts' && unread > 0 && <span className="absolute -right-2 -top-1.5 min-w-4 rounded-full bg-tangedu px-1 text-center text-[10px] leading-4 font-bold text-ink" aria-label={`${unread} unread`}>{unread > 9 ? '9+' : unread}</span>}
                </span>{t.label}
              </NavLink>
            );
          })}
        </nav>
      </div>
    </div>
    </>
  );
}
