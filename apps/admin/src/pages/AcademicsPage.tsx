import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, fieldErrors } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, EmptyState, ErrorState, Field, PageHeader, Sheet, Skeleton } from '../components/ui';

interface Year { id: number; name: string; start_date: string; end_date: string; is_current: number; status: string }
interface Section { id: number; name: string; is_active: number }
interface Klass { id: number; name: string; level_order: number; is_active: number; sections: Section[] }

const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function YearSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api('/academic-years', { method: 'POST', body: form }),
    onSuccess: () => { toast.success(`Academic year ${form.name} added`); qc.invalidateQueries({ queryKey: ['years'] }); onClose(); setForm({ name: '', startDate: '', endDate: '' }); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(Object.keys(fe).length ? fe : { form: (e as ApiError).message }); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setErrors({}); m.mutate(); };
  return (
    <Sheet open={open} onClose={onClose} title="Add academic year"
      footer={<button form="year-form" className="btn-primary w-full" disabled={m.isPending}>{m.isPending ? 'Adding…' : 'Add year'}</button>}>
      <form id="year-form" onSubmit={submit} className="space-y-4">
        <Field label="Name" error={errors.name} hint="For example 2027-28"><input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Starts on" error={errors.startDate}><input type="date" className="field" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
        <Field label="Ends on" error={errors.endDate}><input type="date" className="field" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
        {errors.form && <p className="text-sm font-medium text-danger" role="alert">{errors.form}</p>}
      </form>
    </Sheet>
  );
}

function AddSection({ klass }: { klass: Klass }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const m = useMutation({
    mutationFn: () => api(`/classes/${klass.id}/sections`, { method: 'POST', body: { name } }),
    onSuccess: () => { toast.success(`Section ${name.toUpperCase()} added to ${klass.name}`); setName(''); setOpen(false); qc.invalidateQueries({ queryKey: ['classes'] }); },
    onError: (e) => toast.error((e as ApiError).message),
  });
  if (!open) return <button onClick={() => setOpen(true)} className="inline-flex h-8 items-center gap-1 rounded-md border border-dashed border-line px-2.5 text-sm font-medium text-ink-muted hover:border-brand hover:text-brand"><Plus size={14} aria-hidden />Section</button>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) m.mutate(); }} className="inline-flex items-center gap-1">
      <input autoFocus aria-label={`New section for ${klass.name}`} className="field h-8 w-16 px-2 py-0 text-sm uppercase" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => !name && setOpen(false)} />
      <button className="h-8 rounded-md bg-brand px-2.5 text-sm font-semibold text-white" disabled={m.isPending}>Add</button>
    </form>
  );
}

interface Teaching {
  classTeachers: Array<{ section_id: number; staff_id: string; name: string }>;
  assignments: Array<{ id: number; section_id: number; subject_id: number; subject: string; staff_id: string; name: string }>;
}
interface Subject { id: number; name: string; code: string | null }

function Subjects({ manage }: { manage: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const q = useQuery({ queryKey: ['subjects'], queryFn: () => api<Subject[]>('/subjects').then((r) => r.data) });
  const add = useMutation({
    mutationFn: () => api('/subjects', { method: 'POST', body: { name } }),
    onSuccess: () => { toast.success(`${name} added`); setName(''); qc.invalidateQueries({ queryKey: ['subjects'] }); },
    onError: (e) => toast.error((e as ApiError).status === 409 ? 'That subject already exists.' : (e as ApiError).message),
  });
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-lg font-semibold">Subjects</h2>
      <div className="panel p-4">
        <div className="flex flex-wrap gap-2">
          {q.data?.length ? q.data.map((s) => <span key={s.id} className="rounded-md bg-chalk px-2.5 py-1 text-sm font-medium">{s.name}</span>) : <p className="text-sm text-ink-muted">No subjects yet.</p>}
        </div>
        {manage && (
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }}>
            <input className="field" placeholder="e.g. Telugu, Mathematics, EVS" value={name} onChange={(e) => setName(e.target.value)} aria-label="New subject" />
            <button className="btn-primary" disabled={add.isPending || !name.trim()}>Add</button>
          </form>
        )}
      </div>
    </section>
  );
}

export default function AcademicsPage() {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const manage = can('academics.manage');
  const [yearOpen, setYearOpen] = useState(false);
  const years = useQuery({ queryKey: ['years'], queryFn: () => api<Year[]>('/academic-years').then((r) => r.data) });
  const classes = useQuery({ queryKey: ['classes'], queryFn: () => api<Klass[]>('/classes').then((r) => r.data) });
  const teaching = useQuery({ queryKey: ['teaching'], queryFn: () => api<Teaching>('/teaching').then((r) => r.data) });
  const ctName = (sectionId: number) => teaching.data?.classTeachers.find((c) => c.section_id === sectionId)?.name;
  const makeCurrent = useMutation({
    mutationFn: (y: Year) => api(`/academic-years/${y.id}/make-current`, { method: 'POST' }),
    onSuccess: (_d, y) => { toast.success(`${y.name} is now the current year`); qc.invalidateQueries({ queryKey: ['years'] }); },
    onError: (e) => toast.error((e as ApiError).message),
  });

  return (
    <div>
      <PageHeader title="Classes & years" description="Academic years, classes, sections and subjects. Assign teachers in the Teaching grid." action={<Link to="/teaching" className="btn-quiet">Teaching grid</Link>} />

      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Academic years</h2>
          {(me?.user.isSuperAdmin || me?.permissions['roles.configure'] === 'all') && <Link to="/year-end" className="btn-quiet min-h-9 text-sm">Year end and next year</Link>}
        </div>
        {years.isLoading ? <Skeleton rows={2} /> : years.isError ? <ErrorState message={(years.error as Error).message} onRetry={() => years.refetch()} /> : (
          <ul className="panel divide-y divide-line">
            {years.data!.map((y) => (
              <li key={y.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                <div>
                  <p className="font-semibold">{y.name} {y.is_current === 1 ? <Badge tone="brand">Current</Badge> : y.status === 'closed' ? <Badge>Closed</Badge> : <Badge tone="attention">Next</Badge>}</p>
                  <p className="text-sm text-ink-muted">{fmt(y.start_date)} to {fmt(y.end_date)}</p>
                </div>
                {me?.user.isSuperAdmin && y.is_current !== 1 && y.status !== 'closed' && (
                  <button className="btn-quiet min-h-9 text-sm" disabled={makeCurrent.isPending} onClick={() => makeCurrent.mutate(y)}>Make current</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Classes and sections</h2>
        {classes.isLoading ? <Skeleton rows={6} /> : classes.isError ? <ErrorState message={(classes.error as Error).message} onRetry={() => classes.refetch()} />
          : classes.data!.length === 0 ? <EmptyState title="No classes yet" body="Classes appear here once they are added." /> : (
          <ul className="panel divide-y divide-line">
            {classes.data!.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center">
                <p className="w-32 shrink-0 font-semibold">{c.name}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {c.sections.map((s) => (
                    <span key={s.id} className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-brand-soft px-2.5 py-1 text-sm font-semibold text-brand">
                      {s.name}{ctName(s.id) && <span className="font-normal text-ink-muted">· {ctName(s.id)}</span>}
                    </span>
                  ))}
                  {manage && <AddSection klass={c} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Subjects manage={manage} />
      <YearSheet open={yearOpen} onClose={() => setYearOpen(false)} />
    </div>
  );
}
