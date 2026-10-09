import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, Pencil, UserX, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError, fieldErrors, shown } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fullName, initials, useClasses } from '../lib/academics';
import { Badge, EmptyState, ErrorState, Field, Sheet, Skeleton } from '../components/ui';
import { CredentialsPanel, type Credentials } from '../components/Credentials';
import FeesTab from '../components/FeesTab';
import { StudentBusCard } from './TransportPage';
import TimetableGrid, { type SectionTT } from '../components/TimetableGrid';
import StudentAttendanceTab from '../components/StudentAttendanceTab';
import StudentMarksTab from '../components/StudentMarksTab';
import LeavingSheet from '../components/LeavingSheet';
import { uploadImage } from '../lib/images';
import { authHeadersPublic } from '../lib/api';

interface Student360 {
  public_id: string; admission_no: string; first_name: string; last_name: string | null; dob: string | null; gender: string | null;
  blood_group: string | null; admission_date: string | null; address: string | null; status: string; inactive_reason: string | null; inactive_at: string | null;
  class_id: number | null; class_name: string | null; section_id: number | null; section_name: string | null; roll_no: string | null;
  family_id: string; family_name: string; father_name: string | null; mother_name: string | null; guardian_name: string | null;
  family_mobile: string; family_alt_mobile: string | null; family_email: string | null; family_address: string | null;
  family_user_id: string; family_login_status: string; family_last_login: string | null; family_login_sent: boolean;
  academic_year: string;
  siblings: Array<{ public_id: string; first_name: string; last_name: string | null; status: string; class_name: string | null; section_name: string | null }>;
  history: Array<{ year: string; class_name: string; section_name: string; roll_no: string | null; status: string; remarks: string | null }>;
}

const GENDER: Record<string, string> = { male: 'Boy', female: 'Girl', other: 'Other' };

function Rows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-6 gap-y-3 text-[15px]">
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-ink-muted">{k}</dt><dd className={clsx(v === 'Hidden' && 'text-ink-muted italic')}>{v}</dd></div>)}
    </dl>
  );
}

function EditStudentSheet({ s, open, onClose }: { s: Student360; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const classes = useClasses(open);
  const init = () => ({ firstName: s.first_name, lastName: s.last_name ?? '', dob: s.dob?.slice(0, 10) ?? '', gender: s.gender ?? '', bloodGroup: s.blood_group ?? '',
    admissionNo: s.admission_no, classId: String(s.class_id ?? ''), sectionId: String(s.section_id ?? ''), rollNo: s.roll_no ?? '', address: s.address === '__hidden__' ? '' : s.address ?? '' });
  const [f, setF] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setF(init()); setErrors({}); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof ReturnType<typeof init>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const sections = classes.data?.find((c) => String(c.id) === f.classId)?.sections ?? [];
  const m = useMutation({
    mutationFn: () => api(`/students/${s.public_id}`, { method: 'PATCH', body: {
      firstName: f.firstName, lastName: f.lastName || null, dob: f.dob || null, gender: f.gender || null, bloodGroup: f.bloodGroup || null,
      admissionNo: f.admissionNo, classId: f.classId, sectionId: f.sectionId, rollNo: f.rollNo || null,
      ...(s.address !== '__hidden__' && { address: f.address || null }),
    } }),
    onSuccess: () => { toast.success('Student updated'); qc.invalidateQueries({ queryKey: ['student', s.public_id] }); qc.invalidateQueries({ queryKey: ['students'] }); onClose(); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(Object.keys(fe).length ? fe : { form: (e as ApiError).message }); },
  });
  return (
    <Sheet open={open} onClose={onClose} title="Edit student" footer={<button form="edit-student" className="btn-primary w-full" disabled={m.isPending}>{m.isPending ? 'Saving…' : 'Save changes'}</button>}>
      <form id="edit-student" className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); setErrors({}); m.mutate(); }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" error={errors.firstName}><input className="field" value={f.firstName} onChange={set('firstName')} /></Field>
          <Field label="Last name" error={errors.lastName}><input className="field" value={f.lastName} onChange={set('lastName')} /></Field>
        </div>
        <div className="grid grid-cols-[1fr_96px_88px] gap-3">
          <Field label="Class" error={errors.classId}>
            <select className="field" value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value, sectionId: '' })}>
              <option value="">Choose</option>{classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Section" error={errors.sectionId}>
            <select className="field" value={f.sectionId} onChange={set('sectionId')}><option value="">-</option>{sections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </Field>
          <Field label="Roll no"><input className="field" value={f.rollNo} onChange={set('rollNo')} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date of birth" error={errors.dob}><input type="date" className="field" value={f.dob} onChange={set('dob')} /></Field>
          <Field label="Gender"><select className="field" value={f.gender} onChange={set('gender')}><option value="">-</option><option value="male">Boy</option><option value="female">Girl</option><option value="other">Other</option></select></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Admission no" error={errors.admissionNo}><input className="field" value={f.admissionNo} onChange={set('admissionNo')} /></Field>
          <Field label="Blood group"><input className="field" value={f.bloodGroup} onChange={set('bloodGroup')} placeholder="e.g. B+" /></Field>
        </div>
        {s.address !== '__hidden__' && <Field label="Address"><input className="field" value={f.address} onChange={set('address')} /></Field>}
        {errors.form && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger" role="alert">{errors.form}</p>}
      </form>
    </Sheet>
  );
}

function EditFamilySheet({ s, open, onClose }: { s: Student360; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const init = () => ({ familyName: s.family_name, fatherName: s.father_name ?? '', motherName: s.mother_name ?? '', mobile: s.family_mobile,
    altMobile: s.family_alt_mobile ?? '', email: s.family_email ?? '', address: s.family_address ?? '' });
  const [f, setF] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setF(init()); setErrors({}); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof ReturnType<typeof init>) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => api(`/families/${s.family_id}`, { method: 'PATCH', body: { ...f, fatherName: f.fatherName || null, motherName: f.motherName || null, altMobile: f.altMobile || null, email: f.email || null, address: f.address || null } }),
    onSuccess: () => { toast.success('Parent details updated'); qc.invalidateQueries({ queryKey: ['student'] }); qc.invalidateQueries({ queryKey: ['students'] }); onClose(); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(Object.keys(fe).length ? fe : { form: (e as ApiError).message }); },
  });
  return (
    <Sheet open={open} onClose={onClose} title="Edit parents" footer={<button form="edit-family" className="btn-primary w-full" disabled={m.isPending}>{m.isPending ? 'Saving…' : 'Save'}</button>}>
      <form id="edit-family" className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); setErrors({}); m.mutate(); }}>
        <Field label="Account name" error={errors.familyName}><input className="field" value={f.familyName} onChange={set('familyName')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Father's name"><input className="field" value={f.fatherName} onChange={set('fatherName')} /></Field>
          <Field label="Mother's name"><input className="field" value={f.motherName} onChange={set('motherName')} /></Field>
        </div>
        <Field label="Parent mobile (login)" error={errors.mobile} hint="Changing it changes the parent's login username."><input className="field" inputMode="tel" value={f.mobile} onChange={set('mobile')} /></Field>
        <Field label="Alternate mobile" error={errors.altMobile}><input className="field" inputMode="tel" value={f.altMobile} onChange={set('altMobile')} /></Field>
        <Field label="Email" error={errors.email}><input className="field" type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Address"><input className="field" value={f.address} onChange={set('address')} /></Field>
        {errors.form && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger" role="alert">{errors.form}</p>}
      </form>
    </Sheet>
  );
}

export default function Student360Page() {
  const { id } = useParams();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const staffView = me?.workspace === 'staff';
  const [tab, setTab] = useState<'overview' | 'attendance' | 'marks' | 'timetable' | 'fees' | 'family' | 'history'>('overview');
  const [leaving, setLeaving] = useState(false);
  const [photoV, setPhotoV] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editingFamily, setEditingFamily] = useState(false);
  const [cred, setCred] = useState<Credentials | null>(null);
  const q = useQuery({ queryKey: ['student', id], queryFn: () => api<Student360>(`/students/${id}`).then((r) => r.data) });

  const status = useMutation({
    mutationFn: (v: { active: boolean; reason?: string }) => api<Student360 & { family_login_change: string | null }>(`/students/${id}/${v.active ? 'activate' : 'deactivate'}`, { method: 'POST', body: { reason: v.reason ?? null } }),
    onSuccess: ({ data }) => {
      toast.success(data.status === 'active' ? 'Student is active again' : 'Student marked inactive');
      if (data.family_login_change === 'auto_disabled') toast.info('The parent login was turned off because no child is active.');
      if (data.family_login_change === 'active') toast.info('The parent login is on again.');
      qc.invalidateQueries({ queryKey: ['student', id] }); qc.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (e) => toast.error((e as ApiError).message),
  });
  const issue = useMutation({
    mutationFn: () => api<Credentials>(`/users/${q.data!.family_user_id}/credentials`, { method: 'POST' }),
    onSuccess: ({ data }) => { setCred(data); qc.invalidateQueries({ queryKey: ['student', id] }); },
    onError: (e) => toast.error((e as ApiError).message),
  });

  if (q.isLoading) return <Skeleton rows={5} />;
  if (q.isError) return (q.error as ApiError).status === 404
    ? <EmptyState title="Student not found" body="This student does not exist or is outside your classes." action={<Link to="/students" className="btn-primary">Back to students</Link>} />
    : <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const name = fullName(s);
  const loginBadge = s.family_login_status !== 'active' ? <Badge tone="danger">Login off</Badge>
    : !s.family_login_sent ? <Badge tone="attention">Login not sent</Badge> : s.family_last_login ? <Badge tone="brand">Using the app</Badge> : <Badge tone="attention">Not logged in yet</Badge>;

  return (
    <div>
      <Link to="/students" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink"><ArrowLeft size={16} aria-hidden />{staffView ? 'Students' : 'Your children'}</Link>

      <header className="panel mb-4 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <StudentPhoto id={s.public_id} initials={initials(name)} canEdit={staffView && can('students.edit')} version={photoV} onChange={() => setPhotoV(photoV + 1)} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
            <p className="mt-0.5 text-ink-muted">
              {s.class_name ? `${s.class_name} ${s.section_name ?? ''}` : 'Not enrolled this year'}{s.roll_no ? ` · Roll ${s.roll_no}` : ''} · Adm {s.admission_no}
            </p>
            {s.status === 'inactive' && <p className="mt-2"><Badge tone="danger">Inactive</Badge> <span className="text-sm text-ink-muted">{s.inactive_reason ?? ''} {s.inactive_at ? `· ${fmtDate(s.inactive_at)}` : ''}</span></p>}
          </div>
          {staffView && (
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              {can('students.edit') && <button className="btn-quiet min-h-10 flex-1 text-sm sm:flex-none" onClick={() => setEditing(true)}><Pencil size={16} aria-hidden />Edit</button>}
              {can('students.deactivate') && (s.status === 'active'
                ? <button className="btn-quiet min-h-10 flex-1 text-sm sm:flex-none" onClick={() => setLeaving(true)}><UserX size={16} aria-hidden />Leaving school</button>
                : <><button className="btn-quiet min-h-10 flex-1 text-sm sm:flex-none" onClick={() => setLeaving(true)}>TC checklist</button><button className="btn-quiet min-h-10 flex-1 text-sm sm:flex-none" onClick={() => status.mutate({ active: true })}><UserCheck size={16} aria-hidden />Make active</button></>)}
            </div>
          )}
        </div>
      </header>

      <div className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0" role="tablist">
        {([['overview', 'Overview'], ...(can('attendance.view') ? [['attendance', 'Attendance']] : []), ...(can('marks.view') ? [['marks', 'Marks']] : []), ...(can('timetable.view') ? [['timetable', 'Timetable']] : []), ...(can('fees.view') ? [['fees', 'Fees']] : []), ['family', 'Parents'], ['history', 'History']] as Array<[typeof tab, string]>).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={clsx('-mb-px shrink-0 border-b-2 px-4 py-2.5 text-[15px] font-semibold', tab === k ? 'border-brand text-brand' : 'border-transparent text-ink-muted hover:text-ink')}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (<div className="space-y-4">
        <section className="panel p-5">
          <Rows rows={[
            ['Date of birth', fmtDate(s.dob)], ['Gender', s.gender ? GENDER[s.gender] : '-'], ['Blood group', shown(s.blood_group)],
            ['Admission date', fmtDate(s.admission_date)], ['Academic year', s.academic_year], ['Address', shown(s.address)],
          ]} />
        </section>
        <StudentBusCard studentId={s.public_id} />
      </div>)}

      {tab === 'fees' && <FeesTab studentId={s.public_id} studentName={name} />}
      {tab === 'timetable' && <StudentTimetable id={s.public_id} />}
      {tab === 'attendance' && <StudentAttendanceTab studentId={s.public_id} />}
      {tab === 'marks' && <StudentMarksTab studentId={s.public_id} name={name} classId={s.class_id} />}
      {staffView && <LeavingSheet studentId={s.public_id} name={name} open={leaving} onClose={() => setLeaving(false)} />}

      {tab === 'family' && (
        <div className="space-y-4">
          <section className="panel p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{s.family_name}</h2>
              {staffView && can('families.edit') && <button className="btn-quiet min-h-9 text-sm" onClick={() => setEditingFamily(true)}><Pencil size={14} aria-hidden />Edit</button>}
            </div>
            <Rows rows={[
              ["Father", shown(s.father_name)], ["Mother", shown(s.mother_name)], ['Mobile (login)', shown(s.family_mobile)],
              ['Alternate mobile', shown(s.family_alt_mobile)], ['Email', shown(s.family_email)], ['Address', shown(s.family_address)],
            ]} />
          </section>
          {staffView && (
            <section className="panel p-5">
              <div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-semibold">Parent login</h2>{loginBadge}</div>
              {cred ? <CredentialsPanel c={cred} /> : (
                <>
                  <p className="mb-3 text-sm text-ink-muted">
                    {s.family_last_login ? `Last signed in ${new Date(s.family_last_login).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.` : 'One parent login for all brothers and sisters, using the parent mobile.'}
                  </p>
                  {can('users.issue_credentials') && s.family_login_status === 'active' && (
                    <button className="btn-primary" onClick={() => issue.mutate()} disabled={issue.isPending}><KeyRound size={16} aria-hidden />{s.family_login_sent ? 'Send new login details' : 'Send login details'}</button>
                  )}
                </>
              )}
            </section>
          )}
          {s.siblings.length > 0 && (
            <section className="panel p-5">
              <h2 className="mb-3 font-semibold">Brothers and sisters</h2>
              <ul className="divide-y divide-line">
                {s.siblings.map((x) => (
                  <li key={x.public_id}><Link to={`/students/${x.public_id}`} className="flex items-center justify-between py-2.5 hover:text-brand">
                    <span className="font-medium">{fullName(x)}</span>
                    <span className="text-sm text-ink-muted">{x.class_name ? `${x.class_name} ${x.section_name ?? ''}` : ''} {x.status === 'inactive' && <Badge tone="danger">Inactive</Badge>}</span>
                  </Link></li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {tab === 'history' && (
        <section className="panel p-5">
          {s.history.length === 0 ? <p className="text-ink-muted">No class records yet.</p> : (
            <ol className="relative space-y-4 border-l-2 border-line pl-5">
              {s.history.map((h) => (
                <li key={h.year} className="relative">
                  <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-surface bg-brand" aria-hidden />
                  <p className="font-semibold">{h.year}</p>
                  <p className="text-ink-muted">{h.class_name} {h.section_name}{h.roll_no ? ` · Roll ${h.roll_no}` : ''} · {({ enrolled: 'studying', promoted: 'promoted', detained: 'kept in class', left: 'left', completed: 'completed school' } as Record<string, string>)[h.status] ?? h.status}</p>
                  {h.remarks && <p className="text-sm text-ink-muted">{h.remarks}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
      {staffView && <EditStudentSheet s={s} open={editing} onClose={() => setEditing(false)} />}
      {staffView && <EditFamilySheet s={s} open={editingFamily} onClose={() => setEditingFamily(false)} />}
    </div>
  );
}

function StudentTimetable({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['timetable', 'student', id], queryFn: () => api<SectionTT>(`/students/${id}/timetable`).then((r) => r.data) });
  if (q.isLoading) return <Skeleton rows={5} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  if (!q.data!.section) return <EmptyState title="No timetable" body="This student is not in a class this year." />;
  return <section className="panel p-4">{q.data!.section.classTeacher && <p className="mb-3 text-sm text-ink-muted">Class teacher: <strong className="text-ink">{q.data!.section.classTeacher}</strong></p>}<TimetableGrid tt={q.data!} /></section>;
}

/** Student photo (staff can change it; shown on the report card). Loaded with the login token, never public. */
function StudentPhoto({ id, initials, canEdit, version, onChange }: { id: string; initials: string; canEdit: boolean; version: number; onChange: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    fetch(`/api/v1/students/${id}/photo`, { headers: authHeadersPublic(), credentials: 'include' }).then(async (r) => { if (r.ok) { url = URL.createObjectURL(await r.blob()); setSrc(url); } else setSrc(null); }).catch(() => setSrc(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [id, version]);
  const pick = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try { await uploadImage(`/students/${id}/photo`, f); onChange(); } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  };
  const img = src ? <img src={src} alt="" className="h-16 w-16 rounded-full object-cover" /> : <span className="grid h-16 w-16 place-items-center rounded-full bg-brand-soft text-xl font-semibold text-brand">{initials}</span>;
  if (!canEdit) return <span className="shrink-0">{img}</span>;
  return (
    <label className="group relative shrink-0 cursor-pointer" title="Change photo">
      {img}
      <span className="absolute inset-x-0 bottom-0 rounded-b-full bg-black/55 py-0.5 text-center text-[10px] font-semibold text-white opacity-0 group-hover:opacity-100">{busy ? '...' : 'Photo'}</span>
      <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
    </label>
  );
}
