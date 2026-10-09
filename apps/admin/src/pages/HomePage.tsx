import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Circle } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { NAV } from '../components/AppShell';
import { Skeleton } from '../components/ui';
import { fullName, initials } from '../lib/academics';
import { inr, type StudentFees } from '../lib/fees';
import type { StudentRow } from './StudentsPage';
import { AnnouncementCard, type Announcement } from './AnnouncementsPage';
import CheckInCard from '../components/CheckInCard';
import Dashboard, { useDashboard, type DashboardData } from '../components/Dashboard';
import { useState } from 'react';
import { QueueBanner } from './AttendancePage';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function SetupChecklist() {
  const auth = useAuth();
  const q = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const [years, classes, staff, inst] = await Promise.all([
        api<any[]>('/academic-years'), api<any[]>('/classes'), api<any[]>('/staff', { query: { pageSize: 1 } }), api<any>('/settings/institution'),
      ]);
      return [
        { done: years.data.some((y) => y.is_current === 1), label: 'Set the current academic year', to: '/academics' },
        { done: classes.data.some((c) => c.sections.length > 0), label: 'Check classes and sections', to: '/academics' },
        { done: (staff.meta?.total ?? 0) > 0, label: 'Add staff and send their login details', to: '/staff' },
        { done: ((await api<any[]>('/students', { query: { pageSize: 1 } })).meta?.total ?? 0) > 0, label: 'Add students, or import them from Excel', to: '/students' },
        ...(auth.can('fees.configure') ? [{ done: !!(await api<any>('/fees/setup')).data.defaultPlanId, label: 'Set up fees: plan, due dates and class fees', to: '/fees/setup' }] : []),
        { done: !!inst.data.contact_email && !!inst.data.contact_whatsapp, label: 'Add the school contact email and WhatsApp number', to: '/settings' },
        { done: !!inst.data.smtp_config?.host, label: 'Connect email (SMTP) for password resets', to: '/settings' },
      ];
    },
  });
  if (!q.data) return null;
  const remaining = q.data.filter((i) => !i.done).length;
  if (remaining === 0) return null;
  return (
    <section className="panel mb-8 p-5">
      <h2 className="text-lg font-semibold">Finish setting up</h2>
      <p className="text-sm text-ink-muted">{remaining} of {q.data.length} steps left before families can use the app.</p>
      <ul className="mt-4 divide-y divide-line">
        {q.data.map((i) => (
          <li key={i.label}>
            <Link to={i.to} className="flex items-center gap-3 py-3 text-[15px] hover:text-brand">
              {i.done ? <Check size={18} className="text-brand" aria-label="Done" /> : <Circle size={18} className="text-ink-muted" aria-label="To do" />}
              <span className={clsx(i.done && 'text-ink-muted line-through')}>{i.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function HomePage() {
  const auth = useAuth();
  const me = auth.me!;
  const first = me.user.name.split(' ')[0];
  const modules = NAV.filter((n) => n.to !== '/' && n.show(auth) && n.to !== '/developer');
  const [yearId, setYearId] = useState<number | undefined>();
  const dash = useDashboard(me.workspace === 'staff' ? yearId : undefined);
  const data = me.workspace === 'staff' ? dash.data : undefined;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight sm:text-3xl">{greeting()}, {first}</h1>
          <p className="mt-1 text-ink-muted">
            {me.workspace === 'staff' ? new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Family view'}
          </p>
        </div>
        {data && (
          <label className="flex items-center gap-2 text-sm text-ink-muted">Academic year
            <select className="field w-auto py-2" value={data.year.id} onChange={(e) => setYearId(Number(e.target.value))}>
              {data.years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' (current)' : y.status === 'closed' ? ' (closed)' : ' (next)'}</option>)}
            </select>
          </label>
        )}
      </div>

      {me.workspace === 'staff' && auth.can('settings.configure') && <SetupChecklist />}
      {me.workspace === 'staff' && (
        <div className="mb-6 space-y-3">
          <QueueBanner />
          <CheckInCard />
          {auth.can('attendance.mark') && <MarkToday />}
        </div>
      )}

      {me.workspace !== 'staff' ? (
        <FamilyHome />
      ) : (
        <>
          {data && <div className="mb-8"><Dashboard data={data} school={auth.branding?.name ?? ''} /></div>}
          <section>
            <h2 className="mb-3 text-lg font-semibold">Go to</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {modules.map((m) => {
                const badge = tileCount(m.to, data);
                return (
                  <Link key={m.to} to={m.to} className="panel flex min-h-24 flex-col justify-between p-4 hover:border-brand/40">
                    <span className="flex items-start justify-between gap-2"><m.icon size={22} className="text-brand" aria-hidden />
                      {badge && <span className={clsx('rounded-full px-2 py-0.5 text-xs font-bold tabular-nums', badge.alert ? 'bg-tangedu-soft text-[#7A5A00]' : 'bg-brand-soft text-brand')}>{badge.text}</span>}</span>
                    <span className="font-semibold">{m.label}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        </>
      )}
      {auth.can('announcements.view') && <LatestNotices />}
    </div>
  );
}

function FamilyHome() {
  const q = useQuery({ queryKey: ['students', 'mine'], queryFn: () => api<StudentRow[]>('/students').then((r) => r.data) });
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Your children</h2>
      {q.isLoading ? <Skeleton rows={2} /> : !q.data?.length ? <p className="panel p-5 text-ink-muted">No children are linked to this login yet.</p> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {q.data.map((s) => (
            <li key={s.public_id}>
              <Link to={`/students/${s.public_id}`} className="panel flex items-center gap-4 p-4 hover:border-brand/40">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-soft text-lg font-semibold text-brand">{initials(fullName(s))}</span>
                <span className="flex-1"><span className="block text-lg font-semibold">{fullName(s)}</span>
                  <span className="text-ink-muted">{s.class_name ? `${s.class_name} ${s.section_name ?? ''}` : ''}{s.roll_no ? ` · Roll ${s.roll_no}` : ''}</span>
                  <ChildAttendance id={s.public_id} /></span>
                <ChildDue id={s.public_id} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChildDue({ id }: { id: string }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['fees', id], enabled: can('fees.view'), queryFn: () => api<StudentFees>(`/students/${id}/fees`).then((r) => r.data) });
  if (!q.data?.configured && !q.data?.items.length) return null;
  const due = q.data.totals.totalDue;
  return due > 0
    ? <span className="text-right"><span className="block text-xs text-ink-muted">Fees due</span><span className={`font-semibold tabular-nums ${q.data.totals.overdue > 0 ? 'text-danger' : ''}`}>{inr(due)}</span></span>
    : <span className="rounded-md bg-brand-soft px-2 py-1 text-xs font-semibold text-brand">Fees paid</span>;
}

function LatestNotices() {
  const q = useQuery({ queryKey: ['announcements', 'latest'], queryFn: () => api<Announcement[]>('/announcements').then((r) => r.data.filter((a) => a.status === 'published').slice(0, 3)) });
  if (!q.data?.length) return null;
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Latest notices</h2><Link to="/announcements" className="text-sm font-semibold text-brand">See all</Link></div>
      <div className="space-y-3">{q.data.map((a) => <AnnouncementCard key={a.id} a={a} names={new Map()} />)}</div>
    </section>
  );
}

/** Teachers: sections still to mark today. */
function MarkToday() {
  const q = useQuery({ queryKey: ['att-overview', 'home'], queryFn: () => api<{ working: boolean; sections: Array<{ id: number; name: string; marked: boolean; isClassTeacher: boolean }> }>('/attendance/overview').then((r) => r.data), retry: false });
  if (!q.data?.working) return null;
  const todo = q.data.sections.filter((s) => !s.marked && (s.isClassTeacher || q.data!.sections.every((x) => !x.isClassTeacher)));
  if (!todo.length) return null;
  return (
    <section className="panel flex flex-wrap items-center gap-3 border-tangedu/60 p-4">
      <p className="flex-1"><span className="font-semibold">Attendance not marked yet:</span> <span className="text-ink-muted">{todo.slice(0, 4).map((s) => s.name).join(', ')}{todo.length > 4 ? ` and ${todo.length - 4} more` : ''}</span></p>
      <Link className="btn-primary" to={todo.length === 1 ? `/attendance/mark/${todo[0].id}` : '/attendance'}>Mark attendance</Link>
    </section>
  );
}

/** Families: this month's attendance under each child. */
function ChildAttendance({ id }: { id: string }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['student-att', id, 'home'], enabled: can('attendance.view'), retry: false,
    queryFn: () => api<{ monthSummary: { percentage: number | null } }>(`/students/${id}/attendance`).then((r) => r.data) });
  const p = q.data?.monthSummary.percentage;
  if (p == null) return null;
  return <span className={clsx('block text-sm', p < 75 ? 'font-semibold text-danger' : 'text-ink-muted')}>Attendance this month: {p}%</span>;
}

/** Small count shown on a "Go to" tile. */
function tileCount(to: string, d?: DashboardData): { text: string; alert?: boolean } | null {
  if (!d) return null;
  const c = d.counts;
  const t = d.attendance?.days.find((x) => x.date === d.ref);
  switch (to) {
    case '/students': return c.students != null ? { text: String(c.students) } : null;
    case '/staff': return c.staff != null ? { text: String(c.staff) } : null;
    case '/announcements': return c.notices ? { text: String(c.notices) } : null;
    case '/leave': return c.pendingLeave ? { text: `${c.pendingLeave} waiting`, alert: true } : null;
    case '/attendance': return t?.percentage != null ? { text: `${Math.round(t.percentage)}%` } : null;
    case '/fees/dues': return d.finance?.studentsWithDues ? { text: String(d.finance.studentsWithDues), alert: true } : null;
    case '/academics': return c.sections ? { text: `${c.sections} sections` } : null;
    default: return null;
  }
}
