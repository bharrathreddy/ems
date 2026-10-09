import { useEffect, useRef, useState } from 'react';
import ExportButtons from '../components/ExportButtons';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, CloudOff, Download, MessageCircle, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError, downloadFile, uploadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useClasses } from '../lib/academics';
import { queued } from '../lib/offline';
import { ATT_CLASS, ATT_SHORT, dayLabel, todayLocal, type AttStatus } from '../lib/attendance';
import { Badge, EmptyState, ErrorState, Field, PageHeader, Skeleton } from '../components/ui';

interface Overview { date: string; today: string; working: boolean; offReason: string | null; canMarkAll: boolean;
  sections: Array<{ id: number; name: string; students: number; absent: number; marked: boolean; markedBy: string | null; isClassTeacher: boolean }> }

export function QueueBanner() {
  const [n, setN] = useState(queued().length);
  useEffect(() => {
    const upd = () => setN(queued().length);
    window.addEventListener('ems-queue', upd);
    return () => window.removeEventListener('ems-queue', upd);
  }, []);
  if (!n) return null;
  return <p className="mb-4 flex items-center gap-2 rounded-lg bg-tangedu-soft px-3 py-2 text-sm text-[#7A5A00]"><CloudOff size={16} aria-hidden />{n} attendance sheet{n > 1 ? 's are' : ' is'} saved on this phone, waiting for a connection.</p>;
}

function TodayTab({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  const q = useQuery({ queryKey: ['att-overview', date], queryFn: () => api<Overview>('/attendance/overview', { query: { date } }).then((r) => r.data) });
  if (q.isLoading) return <Skeleton rows={5} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const o = q.data!;
  const done = o.sections.filter((s) => s.marked).length;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input type="date" className="field w-auto" aria-label="Date" value={date} max={o.today} onChange={(e) => setDate(e.target.value)} />
        <span className="text-ink-muted">{dayLabel(date)}</span>
        {o.working && o.sections.length > 0 && <span className="ml-auto text-sm text-ink-muted">{done} of {o.sections.length} sections marked</span>}
      </div>
      {!o.working ? <EmptyState title="No school on this day" body={o.offReason ?? ''} /> : !o.sections.length ? <EmptyState title="No sections to mark" body="You can mark attendance for sections where you are the class teacher or teach a subject." /> : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {o.sections.map((s) => (
            <li key={s.id}>
              <Link to={`/attendance/mark/${s.id}?date=${date}`} className={clsx('panel flex items-center gap-3 p-4 hover:border-brand/40', !s.marked && 'border-tangedu/60')}>
                <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-full', s.marked ? 'bg-brand text-white' : 'bg-tangedu-soft text-[#7A5A00]')}>{s.marked ? <Check size={18} /> : '!'}</span>
                <span className="min-w-0 flex-1"><span className="block font-semibold">{s.name} {s.isClassTeacher && <Badge tone="brand">Your class</Badge>}</span>
                  <span className="text-sm text-ink-muted">{s.marked ? `${s.students - s.absent} of ${s.students} present · ${s.markedBy}` : `${s.students} students · not marked`}</span></span>
                <ChevronRight size={18} className="text-ink-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AbsenteesTab({ date }: { date: string }) {
  const q = useQuery({ queryKey: ['att-absentees', date], queryFn: () => api<{ rows: Array<{ studentId: string; name: string; className: string; parent: string; mobile: string; whatsappUrl: string }> }>('/attendance/absentees', { query: { date } }).then((r) => r.data) });
  const [sent, setSent] = useState<Set<string>>(new Set());
  if (q.isLoading) return <Skeleton rows={4} />;
  if (!q.data?.rows.length) return <EmptyState title="No absentees" body={`Nobody is marked absent on ${dayLabel(date)}.`} />;
  return (
    <div>
      <div className="mb-3"><ExportButtons list="absentees" name={`absentees-${date}`} params={{ date }} /></div>
      <p className="mb-3 text-sm text-ink-muted">Parents already got an in-app alert. Send a WhatsApp message too: tap each button; it opens WhatsApp with the message ready.</p>
      <ul className="panel divide-y divide-line">{q.data.rows.map((r) => (
        <li key={r.studentId} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1"><Link to={`/students/${r.studentId}`} className="font-semibold">{r.name}</Link><p className="text-sm text-ink-muted">{r.className} · {r.parent} · {r.mobile}</p></div>
          {sent.has(r.studentId) && <Badge tone="brand">Sent</Badge>}
          <a href={r.whatsappUrl} target="_blank" rel="noreferrer" onClick={() => setSent(new Set(sent).add(r.studentId))} className="btn min-h-9 bg-[#1F7A4D] px-3 text-sm text-white"><MessageCircle size={16} aria-hidden />WhatsApp</a>
        </li>))}</ul>
    </div>
  );
}

function StaffTab({ date }: { date: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['att-staff', date], queryFn: () => api<{ working: boolean; offReason: string | null; staff: Array<{ id: string; name: string; designation: string | null; status: string | null; source: string | null; checkInAt: string | null; distanceM: number | null }> }>('/staff-attendance', { query: { date } }).then((r) => r.data) });
  const set = useMutation({ mutationFn: (v: { staffId: string; status: string | null }) => api('/staff-attendance', { method: 'PUT', body: { date, entries: [v] } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['att-staff', date] }), onError: (e) => toast.error((e as ApiError).message) });
  if (q.isLoading) return <Skeleton rows={4} />;
  const d = q.data!;
  if (!d.working) return <EmptyState title="Not a working day" body={d.offReason ?? ''} />;
  const present = d.staff.filter((s) => s.status === 'present' || s.status === 'half_day').length;
  return (
    <div>
      <p className="mb-3 text-sm text-ink-muted">{present} of {d.staff.length} staff present. Staff check in from their phones on the school premises; you can correct any entry.</p>
      <ul className="panel divide-y divide-line">{d.staff.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1"><p className="font-semibold">{s.name}</p><p className="text-sm text-ink-muted">{s.designation ?? ''}{s.checkInAt ? ` · checked in ${new Date(s.checkInAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}${s.distanceM != null ? ` (${s.distanceM} m)` : ''}` : ''}{s.source === 'admin' ? ' · set by admin' : s.source === 'leave' ? ' · approved leave' : ''}</p></div>
          <select className="field w-auto py-1.5 text-sm" aria-label={`Status for ${s.name}`} disabled={!can('staff.edit')} value={s.status ?? ''} onChange={(e) => set.mutate({ staffId: s.id, status: e.target.value || null })}>
            <option value="">Not checked in</option><option value="present">Present</option><option value="half_day">Half day</option><option value="absent">Absent</option><option value="leave">Leave</option>
          </select>
        </li>))}</ul>
    </div>
  );
}

function MonthTab() {
  const classes = useClasses();
  const [sectionId, setSectionId] = useState('');
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const q = useQuery({ queryKey: ['att-month', sectionId, month], enabled: !!sectionId, queryFn: () => api<any>(`/attendance/sections/${sectionId}/month`, { query: { month } }).then((r) => r.data) });
  const sections = (classes.data ?? []).flatMap((c) => c.sections.map((s) => ({ id: s.id, label: `${c.name} ${s.name}` })));
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="field w-auto" aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}><option value="">Choose section</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <input type="month" className="field w-auto" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} />
        {sectionId && <ExportButtons list="attendance-month" name={`attendance-${month}`} params={{ sectionId, month }} />}
      </div>
      {!sectionId ? <EmptyState title="Choose a section" body="See every student's attendance for the month, with their percentage." /> : q.isLoading ? <Skeleton rows={5} /> : q.isError ? <ErrorState message={(q.error as Error).message} /> : (
        <div className="panel overflow-x-auto">
          <table className="text-sm">
            <thead><tr className="border-b border-line text-ink-muted"><th className="sticky left-0 bg-surface px-3 py-2 text-left font-medium">Student</th>
              {q.data.days.filter((d: any) => d.working).map((d: any) => <th key={d.date} className={clsx('px-1 py-2 text-center font-medium', !d.marked && 'text-ink-muted/50')}>{Number(d.date.slice(8))}</th>)}
              <th className="px-3 py-2 text-right font-medium">%</th></tr></thead>
            <tbody>{q.data.students.map((s: any) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="sticky left-0 whitespace-nowrap bg-surface px-3 py-1.5"><Link to={`/students/${s.id}`} className="font-medium">{s.name}</Link></td>
                {q.data.days.filter((d: any) => d.working).map((d: any) => { const st = s.statuses[d.date] as AttStatus | undefined; return (
                  <td key={d.date} className="px-0.5 py-1 text-center">{st ? <span className={clsx('inline-block w-7 rounded py-0.5 text-[11px] font-bold', ATT_CLASS[st])}>{ATT_SHORT[st]}</span> : <span className="text-ink-muted/40">·</span>}</td>); })}
                <td className={clsx('px-3 py-1.5 text-right font-semibold tabular-nums', s.percentage != null && s.percentage < 75 && 'text-danger')}>{s.percentage ?? '-'}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HolidaysTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['att-holidays'], queryFn: () => api<{ year: string; workingDaysSoFar: number; workingDaysInYear: number; holidays: Array<{ id: number; name: string; start_date: string; end_date: string }> }>('/attendance/holidays').then((r) => r.data) });
  const [f, setF] = useState({ name: '', startDate: '', endDate: '' });
  const add = useMutation({ mutationFn: () => api<{ warning: string | null }>('/attendance/holidays', { method: 'POST', body: { ...f, endDate: f.endDate || null } }),
    onSuccess: ({ data }) => { toast.success('Holiday added'); if (data.warning) toast.info(data.warning); setF({ name: '', startDate: '', endDate: '' }); qc.invalidateQueries({ queryKey: ['att-holidays'] }); }, onError: (e) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message) });
  const del = useMutation({ mutationFn: (id: number) => api(`/attendance/holidays/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['att-holidays'] }) });
  if (q.isLoading) return <Skeleton rows={4} />;
  const d = q.data!;
  const fmt = (x: string) => new Date(`${x}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (
    <div className="max-w-2xl">
      <p className="mb-3 text-sm text-ink-muted">{d.year}: {d.workingDaysSoFar} working days so far, {d.workingDaysInYear} in the year. Sundays and the Saturdays set in <Link className="font-semibold text-brand underline" to="/timetable/setup">Bell schedules</Link> are holidays automatically.</p>
      {can('academics.manage') && (
        <div className="panel mb-4 grid gap-2 p-4 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-end">
          <Field label="Holiday"><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Dasara holidays" /></Field>
          <Field label="From"><input type="date" className="field" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="To (optional)"><input type="date" className="field" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          <button className="btn-primary" disabled={add.isPending || f.name.trim().length < 2 || !f.startDate} onClick={() => add.mutate()}><Plus size={16} aria-hidden />Add</button>
        </div>
      )}
      {!d.holidays.length ? <EmptyState title="No holidays added" body="Add festivals and vacations so they are not counted as working days." /> : (
        <ul className="panel divide-y divide-line">{d.holidays.map((h) => (
          <li key={h.id} className="flex items-center gap-3 px-4 py-3"><span className="flex-1"><span className="font-semibold">{h.name}</span><span className="block text-sm text-ink-muted">{fmt(h.start_date)}{h.end_date !== h.start_date ? ` to ${fmt(h.end_date)}` : ''}</span></span>
            {can('academics.manage') && <button aria-label={`Remove ${h.name}`} className="p-2 text-ink-muted hover:text-danger" onClick={() => confirm(`Remove ${h.name}?`) && del.mutate(h.id)}><Trash2 size={16} /></button>}</li>))}</ul>
      )}
    </div>
  );
}

function ImportTab() {
  const classes = useClasses();
  const [sectionId, setSectionId] = useState('');
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [result, setResult] = useState<any>(null);
  const input = useRef<HTMLInputElement>(null);
  const sections = (classes.data ?? []).flatMap((c) => c.sections.map((s) => ({ id: s.id, label: `${c.name} ${s.name}` })));
  const validate = useMutation({ mutationFn: (f: File) => uploadFile<any>('/attendance/import/validate', f), onSuccess: ({ data }) => setResult(data), onError: (e) => toast.error((e as ApiError).message) });
  const commit = useMutation({ mutationFn: () => api<any>(`/attendance/import/${result.jobId}/commit`, { method: 'POST' }), onSuccess: ({ data }) => { if (data.status === 'completed') { toast.success(`Imported ${data.summary.marks} marks`); setResult(null); if (input.current) input.current.value = ''; } else setResult({ ...result, status: 'invalid', errors: data.errors }); } });
  return (
    <div className="max-w-2xl space-y-4">
      <div className="panel p-5">
        <p className="font-semibold">1. Download the sheet for a section and month</p>
        <p className="mb-3 text-sm text-ink-muted">Students are filled in; only working days are columns. Codes: P present, A absent, L late, H half day, LV leave. Leave a cell empty if not taken.</p>
        <div className="flex flex-wrap gap-2">
          <select className="field w-auto" aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}><option value="">Choose section</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          <input type="month" className="field w-auto" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <button className="btn-quiet" disabled={!sectionId} onClick={() => downloadFile(`/attendance/import-template?sectionId=${sectionId}&month=${month}`, `attendance-${month}.xlsx`).catch((e) => toast.error(e.message))}><Download size={16} aria-hidden />Download</button>
        </div>
      </div>
      <div className="panel p-5">
        <p className="mb-3 font-semibold">2. Upload the filled sheet</p>
        <button className="btn-quiet" onClick={() => input.current?.click()} disabled={validate.isPending}><Upload size={16} aria-hidden />{validate.isPending ? 'Checking…' : 'Choose Excel file'}</button>
        <input ref={input} type="file" accept=".xlsx" className="sr-only" onChange={(e) => e.target.files?.[0] && validate.mutate(e.target.files[0])} />
        {result && (result.status === 'ready' ? (
          <div className="mt-4"><p className="text-brand">All correct: {result.summary.marks} marks for {result.summary.students} students over {result.summary.days} days.</p>
            <button className="btn-primary mt-3" disabled={commit.isPending} onClick={() => commit.mutate()}>Import</button></div>
        ) : (
          <div className="mt-4"><p className="text-danger">Fix these and upload again:</p>
            <ul className="mt-2 max-h-72 overflow-auto rounded-lg border border-line text-sm">{result.errors.map((e: any, i: number) => <li key={i} className="border-b border-line px-3 py-1.5 last:border-0">Row {e.row}, {e.column}: {e.message}</li>)}</ul></div>
        ))}
      </div>
    </div>
  );
}

export default function AttendancePage() {
  const { can, me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [date, setDateState] = useState(params.get('date') ?? todayLocal());
  const setDate = (d: string) => { setDateState(d); setParams({ date: d }); };
  const office = me?.permissions['attendance.view'] === 'all';
  const tabs = [['today', 'Today'], ...(office ? [['absent', 'Absentees']] : []), ...(can('staff.view') ? [['staff', 'Staff']] : []), ['month', 'Month report'], ['holidays', 'Holidays'],
    ...(me?.permissions['attendance.mark'] === 'all' && can('imports.run') ? [['import', 'Import']] : [])] as Array<[string, string]>;
  const [tab, setTab] = useState('today');
  return (
    <div>
      <PageHeader title="Attendance" />
      <QueueBanner />
      <div className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0" role="tablist">
        {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={clsx('-mb-px shrink-0 border-b-2 px-3.5 py-2.5 text-[15px] font-semibold', tab === k ? 'border-brand text-brand' : 'border-transparent text-ink-muted hover:text-ink')}>{label}</button>)}
      </div>
      {tab === 'today' && <TodayTab date={date} setDate={setDate} />}
      {tab === 'absent' && <><input type="date" className="field mb-4 w-auto" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} /><AbsenteesTab date={date} /></>}
      {tab === 'staff' && <><input type="date" className="field mb-4 w-auto" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} /><StaffTab date={date} /></>}
      {tab === 'month' && <MonthTab />}
      {tab === 'holidays' && <HolidaysTab />}
      {tab === 'import' && <ImportTab />}
    </div>
  );
}
