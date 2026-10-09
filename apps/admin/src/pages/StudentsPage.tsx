import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ExportButtons from '../components/ExportButtons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError, fieldErrors, shown } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fullName, initials, useClasses } from '../lib/academics';
import { Badge, EmptyState, ErrorState, Field, MobileAction, PageHeader, Sheet, Skeleton } from '../components/ui';

export interface StudentRow {
  public_id: string; admission_no: string; first_name: string; last_name: string | null; status: string;
  class_name: string | null; section_name: string | null; roll_no: string | null;
  family_id: string; family_name: string; father_name: string | null; family_mobile: string;
}

const classLabel = (s: { class_name: string | null; section_name: string | null }) =>
  s.class_name ? `${s.class_name}${s.section_name ? ` ${s.section_name}` : ''}` : 'Not enrolled this year';

interface LookupResult { family: null | { public_id: string; family_name: string; father_name: string | null; children: Array<{ first_name: string; last_name: string | null; status: string }> }; staffMatch: string | null }

function AddStudentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const classes = useClasses(open);
  const empty = { firstName: '', lastName: '', classId: '', sectionId: '', rollNo: '', dob: '', gender: '', admissionNo: '',
    mobile: '', familyName: '', fatherName: '', motherName: '', email: '', address: '' };
  const [f, setF] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const digits = f.mobile.replace(/\D/g, '').slice(-10);

  useEffect(() => {
    setLookup(null);
    if (digits.length !== 10) return;
    const t = setTimeout(() => api<LookupResult>('/families/lookup', { query: { mobile: digits } }).then((r) => setLookup(r.data)).catch(() => undefined), 300);
    return () => clearTimeout(t);
  }, [digits]);

  const sections = classes.data?.find((c) => String(c.id) === f.classId)?.sections ?? [];
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const m = useMutation({
    mutationFn: () => api<{ public_id: string }>('/students', {
      method: 'POST',
      body: {
        firstName: f.firstName, lastName: f.lastName || null, classId: f.classId, sectionId: f.sectionId, rollNo: f.rollNo || null,
        dob: f.dob || null, gender: f.gender || null, admissionNo: f.admissionNo || null,
        family: lookup?.family ? { familyId: lookup.family.public_id } : {
          familyName: f.familyName || f.fatherName || f.motherName || `${f.lastName || f.firstName} family`,
          fatherName: f.fatherName || null, motherName: f.motherName || null, mobile: f.mobile, email: f.email || null, address: f.address || null,
        },
      },
    }),
    onSuccess: ({ data }) => { toast.success(`${f.firstName} added`); setF(empty); onClose(); navigate(`/students/${data.public_id}`); },
    onError: (e) => {
      const fe = fieldErrors(e);
      const mapped = Object.fromEntries(Object.entries(fe).map(([k, v]) => [k.replace(/^family\./, ''), v]));
      setErrors(Object.keys(mapped).length ? mapped : { form: (e as ApiError).message });
    },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setErrors({}); m.mutate(); };

  return (
    <Sheet open={open} onClose={onClose} title="Add student"
      footer={<button form="student-form" className="btn-primary w-full" disabled={m.isPending}>{m.isPending ? 'Adding…' : 'Add student'}</button>}>
      <form id="student-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" error={errors.firstName}><input className="field" value={f.firstName} onChange={set('firstName')} /></Field>
          <Field label="Last name" error={errors.lastName}><input className="field" value={f.lastName} onChange={set('lastName')} /></Field>
        </div>
        <div className="grid grid-cols-[1fr_96px_88px] gap-3">
          <Field label="Class" error={errors.classId}>
            <select className="field" value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value, sectionId: '' })}>
              <option value="">Choose</option>{classes.data?.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Section" error={errors.sectionId}>
            <select className="field" value={f.sectionId} onChange={set('sectionId')} disabled={!f.classId}>
              <option value="">-</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Roll no" error={errors.rollNo}><input className="field" inputMode="numeric" value={f.rollNo} onChange={set('rollNo')} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date of birth" error={errors.dob}><input type="date" className="field" value={f.dob} onChange={set('dob')} /></Field>
          <Field label="Gender">
            <select className="field" value={f.gender} onChange={set('gender')}><option value="">-</option><option value="male">Boy</option><option value="female">Girl</option><option value="other">Other</option></select>
          </Field>
        </div>
        <Field label="Admission number" error={errors.admissionNo} hint="Leave empty to number automatically."><input className="field" value={f.admissionNo} onChange={set('admissionNo')} placeholder="Automatic" /></Field>

        <div className="border-t border-line pt-4">
          <h3 className="font-semibold">Family</h3>
          <p className="mb-3 text-sm text-ink-muted">Brothers and sisters share one family login, found by mobile number.</p>
          <Field label="Family mobile" error={errors.mobile}><input className="field" inputMode="tel" value={f.mobile} onChange={set('mobile')} placeholder="10-digit mobile" /></Field>
        </div>
        {lookup?.family ? (
          <div className="rounded-xl bg-brand-soft p-4">
            <p className="font-semibold text-brand">Existing family: {lookup.family.family_name}</p>
            <p className="mt-1 text-sm">Children: {lookup.family.children.map((c) => fullName(c)).join(', ')}</p>
            <p className="mt-1 text-sm text-ink-muted">This student will be added to the same family and login.</p>
          </div>
        ) : digits.length === 10 && lookup ? (
          <div className="space-y-4">
            {lookup.staffMatch && <p className="rounded-lg bg-tangedu-soft px-3 py-2.5 text-sm text-[#7A5A00]">This mobile belongs to staff member <strong>{lookup.staffMatch}</strong>. The family will use their existing login, with a Staff / Parent switch.</p>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Father's name" error={errors.fatherName}><input className="field" value={f.fatherName} onChange={set('fatherName')} /></Field>
              <Field label="Mother's name" error={errors.motherName}><input className="field" value={f.motherName} onChange={set('motherName')} /></Field>
            </div>
            <Field label="Family email" error={errors.email} hint="Optional. Lets the family reset its password by email."><input type="email" className="field" value={f.email} onChange={set('email')} /></Field>
            <Field label="Address" error={errors.address}><input className="field" value={f.address} onChange={set('address')} /></Field>
          </div>
        ) : null}
        {errors.form && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger" role="alert">{errors.form}</p>}
      </form>
    </Sheet>
  );
}

export default function StudentsPage() {
  const { can, me } = useAuth();
  const isFamily = me?.workspace !== 'staff';
  const navigate = useNavigate();
  const classes = useClasses(!isFamily);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [adding, setAdding] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 250); return () => clearTimeout(t); }, [search]);

  const q = useQuery({
    queryKey: ['students', term, classId, sectionId, status],
    queryFn: () => api<StudentRow[]>('/students', { query: { search: term, classId, sectionId, status, pageSize: 200 } }),
  });
  const rows = q.data?.data ?? [];
  const sections = classes.data?.find((c) => String(c.id) === classId)?.sections ?? [];
  const addButton = can('students.create') && <button className="btn-primary w-full sm:w-auto" onClick={() => setAdding(true)}><Plus size={18} aria-hidden />Add student</button>;

  if (isFamily) {
    return (
      <div>
        <PageHeader title="Your children" />
        {q.isLoading ? <Skeleton rows={2} /> : rows.length === 0 ? <EmptyState title="No children linked" body="Ask the school office to link your children to this login." /> : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {rows.map((s) => (
              <li key={s.public_id}>
                <Link to={`/students/${s.public_id}`} className="panel flex items-center gap-4 p-4 hover:border-brand/40">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-soft text-lg font-semibold text-brand">{initials(fullName(s))}</span>
                  <span><span className="block text-lg font-semibold">{fullName(s)}</span><span className="text-ink-muted">{classLabel(s)}{s.roll_no ? ` · Roll ${s.roll_no}` : ''}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Students" description={q.data?.meta ? `${q.data.meta.total} ${status} students · ${q.data.meta.academicYear}` : undefined}
        action={<div className="flex flex-wrap gap-2"><ExportButtons list="students" params={{ classId, sectionId, status, search: term }} />{me?.permissions['students.view'] === 'all' && <Link to="/students/leaving" className="btn-quiet">Leaving students</Link>}{addButton}</div>} />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input className="field pl-10" placeholder="Name, admission no, parent or mobile" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search students" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:contents">
          <select className="field sm:w-36" aria-label="Class" value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }}>
            <option value="">All classes</option>{classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="field sm:w-28" aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!classId}>
            <option value="">All sections</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        {can('students.deactivate') && (
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Status">
            {(['active', 'inactive'] as const).map((s) => (
              <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s}
                className={clsx('rounded-md px-3 py-2 text-sm font-semibold capitalize', status === s ? 'bg-brand-soft text-brand' : 'text-ink-muted')}>{s}</button>
            ))}
          </div>
        )}
      </div>

      {q.isLoading ? <Skeleton /> : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
        : rows.length === 0 ? (term || classId ? <EmptyState title="No matches" body="Try another name, class or section." />
          : status === 'inactive' ? <EmptyState title="No inactive students" body="Students marked inactive (left or transferred) appear here." />
          : <EmptyState title="No students yet" body="Add students one by one, or import them from Excel." action={<div className="flex flex-wrap justify-center gap-2">{addButton}{can('imports.run') && <Link to="/imports" className="btn-quiet"><Users size={18} aria-hidden />Import from Excel</Link>}</div>} />) : (
        <>
          <ul className="space-y-2 md:hidden">
            {rows.map((s) => (
              <li key={s.public_id}>
                <Link to={`/students/${s.public_id}`} className="panel flex items-center gap-3 p-3.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand">{initials(fullName(s))}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{fullName(s)}</span>
                    <span className="block truncate text-sm text-ink-muted">{classLabel(s)}{s.roll_no ? ` · Roll ${s.roll_no}` : ''} · {s.admission_no}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="panel hidden overflow-x-auto md:block">
            <table className="w-full text-left text-[15px]">
              <thead className="border-b border-line text-sm text-ink-muted">
                <tr><th className="px-4 py-3 font-medium">Adm no</th><th className="px-4 py-3 font-medium">Name</th><th className="px-4 py-3 font-medium">Class</th><th className="px-4 py-3 font-medium">Roll</th><th className="px-4 py-3 font-medium">Parent</th><th className="px-4 py-3 font-medium">Mobile</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((s) => (
                  <tr key={s.public_id} className="cursor-pointer hover:bg-chalk" onClick={() => navigate(`/students/${s.public_id}`)}>
                    <td className="px-4 py-3 text-ink-muted">{s.admission_no}</td>
                    <td className="px-4 py-3"><Link to={`/students/${s.public_id}`} className="font-semibold">{fullName(s)}</Link>{s.status === 'inactive' && <> <Badge tone="danger">Inactive</Badge></>}</td>
                    <td className="px-4 py-3">{classLabel(s)}</td>
                    <td className="px-4 py-3">{s.roll_no ?? '-'}</td>
                    <td className="px-4 py-3">{s.father_name ?? s.family_name}</td>
                    <td className="px-4 py-3">{shown(s.family_mobile)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {addButton && <MobileAction>{addButton}</MobileAction>}
      <AddStudentSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
