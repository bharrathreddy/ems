import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Cake, CalendarOff, GraduationCap, IndianRupee, MessageCircle, PartyPopper, UserCheck, Users, UserPlus, Home } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { inr } from '../lib/fees';

export interface DashboardData {
  year: { id: number; name: string; status: string; start: string; end: string }; years: Array<{ id: number; name: string; status: string; is_current: number }>; today: string; ref: string;
  counts: { students?: number; boys?: number; girls?: number; families?: number; sections?: number; newAdmissions?: number; staff?: number; notices?: number; pendingLeave?: number };
  attendance: null | { from: string; to: string; sections: number; staff: number; totals: { present: number; absent: number; leave: number };
    days: Array<{ date: string; working: boolean; off: string | null; future: boolean; present: number; absent: number; leave: number; percentage: number | null; sectionsMarked: number; staffPresent: number; staffAbsent: number; staffLeave: number }> };
  finance: null | { totalFee: number; collected: number; waived: number; outstanding: number; overdue: number; studentsWithDues: number; collectedPct: number | null; receivedToday: number; receivedThisMonth: number; receivedThisYear: number; receipts: number;
    byMonth: Array<{ month: string; amount: number }>; byMethod: Array<{ method: string; amount: number }> };
  upcoming: Array<{ kind: 'holiday' | 'event' | 'exam'; title: string; date: string; endDate: string | null; link: string | null; place: string | null }>;
  birthdays: Array<{ kind: 'student' | 'staff'; id: string; name: string; detail: string | null; date: string; age: number; mobile: string | null }>;
  staffLeave: null | { today: number; pending: number; list: Array<{ id: number; name: string; designation: string | null; startDate: string; endDate: string; reason: string; status: string; onLeaveToday: boolean }> };
}

export const useDashboard = (yearId?: number) => useQuery({ queryKey: ['dashboard', yearId], queryFn: () => api<DashboardData>('/dashboard', { query: { yearId } }).then((r) => r.data), staleTime: 60_000 });

const d = (x: string, o: Intl.DateTimeFormatOptions) => new Date(`${x}T00:00:00Z`).toLocaleDateString('en-IN', { ...o, timeZone: 'UTC' });
const compact = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : inr(n));
const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', cheque: 'Cheque', bank_transfer: 'Bank', card: 'Card' };

function Kpi({ icon: Icon, label, value, sub, to, tone }: { icon: any; label: string; value: string | number; sub?: string; to?: string; tone?: 'danger' }) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-sm text-ink-muted"><Icon size={16} className="text-brand" aria-hidden />{label}</span>
      <span className={clsx('mt-1 block text-[28px] font-bold leading-tight tabular-nums', tone === 'danger' && 'text-danger')}>{value}</span>
      {sub && <span className="block truncate text-sm text-ink-muted">{sub}</span>}
    </>
  );
  return to ? <Link to={to} className="panel block p-4 hover:border-brand/40">{body}</Link> : <div className="panel p-4">{body}</div>;
}

function Card({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx('panel p-5', className)}>
      <div className="mb-4 flex items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">{title}</h2>{action}</div>
      {children}
    </section>
  );
}

function AttendanceWeek({ a, today }: { a: NonNullable<DashboardData['attendance']>; today: string }) {
  const max = Math.max(1, ...a.days.map((x) => x.present + x.absent + x.leave));
  const t = a.days.find((x) => x.date === today);
  return (
    <Card title="Attendance this week" action={<Link to="/attendance" className="text-sm font-semibold text-brand">Open</Link>}>
      <p className="mb-3 text-sm text-ink-muted">{d(a.from, { day: 'numeric', month: 'short' })} to {d(a.to, { day: 'numeric', month: 'short' })} · {a.totals.present} present · <span className="text-danger">{a.totals.absent} absent</span> · {a.totals.leave} on leave</p>
      <div className="flex h-44 items-end gap-2 sm:gap-3" role="img" aria-label="Students present and absent each day this week">
        {a.days.map((x) => {
          const total = x.present + x.absent + x.leave;
          const h = (n: number) => `${(n / max) * 100}%`;
          return (
            <div key={x.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className={clsx('text-xs font-semibold tabular-nums', x.percentage != null && x.percentage < 85 ? 'text-danger' : 'text-ink-muted')}>{x.percentage != null ? `${Math.round(x.percentage)}%` : ''}</span>
              <div className="flex w-full max-w-12 flex-1 flex-col justify-end overflow-hidden rounded-md bg-chalk" title={x.working ? `${x.present} present, ${x.absent} absent, ${x.leave} leave` : x.off ?? ''}>
                {x.working && total > 0 ? (<>
                  <div className="bg-ink-muted/35" style={{ height: h(x.leave) }} />
                  <div className="bg-danger/70" style={{ height: h(x.absent) }} />
                  <div className="bg-brand" style={{ height: h(x.present) }} />
                </>) : <div className="grid h-full place-items-center text-[10px] text-ink-muted">{!x.working ? 'Off' : x.future ? '' : '-'}</div>}
              </div>
              <span className={clsx('text-xs', x.date === today ? 'font-bold text-ink' : 'text-ink-muted')}>{d(x.date, { weekday: 'short' })}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-brand" />Present</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-danger/70" />Absent</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-ink-muted/35" />Leave</span>
        {t && t.working && <span className="ml-auto">Today: {t.sectionsMarked} of {a.sections} sections marked · staff {t.staffPresent} of {a.staff} present</span>}
      </div>
    </Card>
  );
}

function Finance({ f }: { f: NonNullable<DashboardData['finance']> }) {
  const max = Math.max(1, ...f.byMonth.map((m) => m.amount));
  return (
    <Card title="Fees" action={<Link to="/fees/dues" className="text-sm font-semibold text-brand">Dues</Link>}>
      <div className="mb-1 flex items-baseline justify-between"><span className="text-2xl font-bold tabular-nums">{compact(f.collected)}</span><span className="text-sm text-ink-muted">of {compact(f.totalFee)} ({f.collectedPct ?? 0}%)</span></div>
      <div className="mb-4 h-2.5 overflow-hidden rounded-full bg-chalk"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, f.collectedPct ?? 0)}%` }} /></div>
      <dl className="mb-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-ink-muted">Today</dt><dd className="font-semibold tabular-nums">{inr(f.receivedToday)}</dd></div>
        <div><dt className="text-ink-muted">This month</dt><dd className="font-semibold tabular-nums">{inr(f.receivedThisMonth)}</dd></div>
        <div><dt className="text-ink-muted">Still due</dt><dd className="font-semibold tabular-nums">{inr(f.outstanding)}</dd></div>
        <div><dt className="text-ink-muted">Overdue</dt><dd className="font-semibold tabular-nums text-danger">{inr(f.overdue)}</dd></div>
      </dl>
      {f.byMonth.length > 0 && (
        <>
          <p className="mb-2 text-sm text-ink-muted">Collected each month</p>
          <div className="flex h-28 items-end gap-1.5" role="img" aria-label="Fees collected each month">
            {f.byMonth.map((m) => (
              <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${d(`${m.month}-01`, { month: 'long' })}: ${inr(m.amount)}`}>
                <div className="w-full max-w-10 rounded-t-md bg-brand/80" style={{ height: `${Math.max(3, (m.amount / max) * 100)}%` }} />
                <span className="text-[11px] text-ink-muted">{d(`${m.month}-01`, { month: 'short' })}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {f.byMethod.length > 0 && <p className="mt-3 text-xs text-ink-muted">{f.byMethod.map((m) => `${METHOD[m.method] ?? m.method} ${compact(m.amount)}`).join(' · ')}</p>}
    </Card>
  );
}

function Upcoming({ items }: { items: DashboardData['upcoming'] }) {
  return (
    <Card title="Coming up" action={<Link to="/attendance" className="text-sm font-semibold text-brand">Holidays</Link>}>
      {!items.length ? <p className="text-sm text-ink-muted">No holidays or events in the next 30 days.</p> : (
        <ul className="space-y-2.5">{items.map((i, n) => (
          <li key={n} className="flex items-center gap-3">
            <span className={clsx('grid h-11 w-11 shrink-0 place-items-center rounded-lg text-center leading-none', i.kind === 'holiday' ? 'bg-tangedu-soft text-[#7A5A00]' : i.kind === 'exam' ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand')}>
              <span><span className="block text-base font-bold">{Number(i.date.slice(8))}</span><span className="text-[10px] font-semibold uppercase">{d(i.date, { month: 'short' })}</span></span>
            </span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{i.link ? <a href={i.link} target="_blank" rel="noreferrer">{i.title}</a> : i.title}</span>
              <span className="text-sm text-ink-muted">{i.kind === 'holiday' ? 'Holiday' : i.kind === 'exam' ? 'Exams' : 'Event'}{i.endDate && i.endDate !== i.date ? ` to ${d(i.endDate, { day: 'numeric', month: 'short' })}` : ''}{i.place ? ` · ${i.place}` : ''}</span></span>
            {i.kind === 'holiday' ? <PartyPopper size={16} className="text-ink-muted" aria-hidden /> : <CalendarDays size={16} className="text-ink-muted" aria-hidden />}
          </li>))}</ul>
      )}
    </Card>
  );
}

function Birthdays({ items, today, school }: { items: DashboardData['birthdays']; today: string; school: string }) {
  return (
    <Card title="Birthdays">
      {!items.length ? <p className="text-sm text-ink-muted">No birthdays in the next week. Add dates of birth to students and staff to see them here.</p> : (
        <ul className="space-y-2">{items.map((b) => {
          const isToday = b.date === today;
          const msg = encodeURIComponent(b.kind === 'student' ? `Happy birthday, ${b.name}! Best wishes from all of us at ${school}.` : `Happy birthday, ${b.name}! Best wishes from all of us at ${school}.`);
          return (
            <li key={`${b.kind}${b.id}`} className={clsx('flex items-center gap-3 rounded-lg px-2 py-1.5', isToday && 'bg-tangedu-soft')}>
              <Cake size={18} className={isToday ? 'text-[#B7791F]' : 'text-ink-muted'} aria-hidden />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{b.kind === 'student' ? <Link to={`/students/${b.id}`}>{b.name}</Link> : b.name}</span>
                <span className="text-sm text-ink-muted">{isToday ? 'Today' : d(b.date, { weekday: 'short', day: 'numeric', month: 'short' })} · turns {b.age} · {b.kind === 'staff' ? (b.detail ?? 'Staff') : b.detail}</span></span>
              {isToday && b.mobile && <a href={`https://wa.me/91${b.mobile}?text=${msg}`} target="_blank" rel="noreferrer" aria-label={`Send birthday wishes to ${b.name}`} className="grid h-9 w-9 place-items-center rounded-full bg-[#1F7A4D] text-white"><MessageCircle size={16} /></a>}
            </li>
          );
        })}</ul>
      )}
    </Card>
  );
}

function StaffLeave({ s, today }: { s: NonNullable<DashboardData['staffLeave']>; today: string }) {
  return (
    <Card title="Staff leave" action={<Link to="/leave" className="text-sm font-semibold text-brand">{s.pending ? `${s.pending} to review` : 'All requests'}</Link>}>
      <p className="mb-3 text-sm text-ink-muted">{s.today ? `${s.today} on leave today` : 'Nobody on leave today'}</p>
      {!s.list.length ? <p className="text-sm text-ink-muted">No leave in the next two weeks.</p> : (
        <ul className="space-y-2">{s.list.map((l) => (
          <li key={l.id} className="flex items-center gap-3">
            <CalendarOff size={16} className="text-ink-muted" aria-hidden />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{l.name}</span>
              <span className="text-sm text-ink-muted">{l.startDate <= today ? 'Today' : d(l.startDate, { day: 'numeric', month: 'short' })}{l.endDate !== l.startDate ? ` to ${d(l.endDate, { day: 'numeric', month: 'short' })}` : ''} · {l.reason}</span></span>
            {l.status === 'pending' && <span className="rounded-md bg-tangedu-soft px-2 py-0.5 text-xs font-semibold text-[#7A5A00]">Waiting</span>}
          </li>))}</ul>
      )}
    </Card>
  );
}

export default function Dashboard({ data, school }: { data: DashboardData; school: string }) {
  const c = data.counts;
  const t = data.attendance?.days.find((x) => x.date === data.ref);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {c.students != null && <Kpi icon={GraduationCap} label="Students" value={c.students} sub={c.boys || c.girls ? `${c.boys} boys · ${c.girls} girls` : undefined} to="/students" />}
        {c.staff != null && <Kpi icon={Users} label="Staff" value={c.staff} to="/staff" />}
        {c.newAdmissions != null && <Kpi icon={UserPlus} label="New admissions" value={c.newAdmissions} sub={data.year.name} />}
        {c.families != null && <Kpi icon={Home} label="Parents" value={c.families} sub={c.sections ? `${c.sections} sections` : undefined} />}
        {data.attendance && <Kpi icon={UserCheck} label={data.ref === data.today ? 'Attendance today' : 'Attendance'} value={t?.percentage != null ? `${Math.round(t.percentage)}%` : '-'} sub={t?.working ? `${t.absent} absent` : t?.off ?? undefined} to="/attendance" tone={t?.percentage != null && t.percentage < 85 ? 'danger' : undefined} />}
        {data.finance && <Kpi icon={IndianRupee} label="Fees collected" value={compact(data.finance.collected)} sub={`${data.finance.collectedPct ?? 0}% of ${compact(data.finance.totalFee)}`} to="/fees/receipts" />}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.attendance && <AttendanceWeek a={data.attendance} today={data.ref} />}
        {data.finance && <Finance f={data.finance} />}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Upcoming items={data.upcoming} />
        <Birthdays items={data.birthdays} today={data.today} school={school} />
        {data.staffLeave && <StaffLeave s={data.staffLeave} today={data.today} />}
      </div>
    </div>
  );
}
