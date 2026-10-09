import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorState, PageHeader, Skeleton } from '../components/ui';

interface Grid {
  year: { id: number; name: string; status: string; editable: boolean };
  years: Array<{ id: number; name: string; status: string; is_current: number }>;
  subjects: Array<{ id: number; name: string }>;
  staff: Array<{ public_id: string; name: string; designation: string | null }>;
  classes: Array<{ id: number; name: string; subjectIds: number[]; sections: Array<{ id: number; name: string; classTeacher: string | null; teachers: Record<string, string> }> }>;
}
type Draft = { subjects: Record<number, number[]>; ct: Record<number, string | null>; cells: Record<string, string | null> };
const empty = (): Draft => ({ subjects: {}, ct: {}, cells: {} });

export default function TeachingPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [yearId, setYearId] = useState<number | undefined>(Number(params.get('year')) || undefined);
  const q = useQuery({ queryKey: ['teaching-grid', yearId], queryFn: () => api<Grid>('/teaching/grid', { query: { yearId } }).then((r) => r.data) });
  const [d, setD] = useState<Draft>(empty);
  useEffect(() => setD(empty()), [q.data]);
  const g = q.data;
  const edit = !!g?.year.editable && can('academics.manage');

  const subjectsOf = (c: Grid['classes'][number]) => d.subjects[c.id] ?? c.subjectIds;
  const ctOf = (s: Grid['classes'][number]['sections'][number]) => (s.id in d.ct ? d.ct[s.id] : s.classTeacher);
  const cellOf = (s: Grid['classes'][number]['sections'][number], subjectId: number) => {
    const k = `${s.id}:${subjectId}`;
    return k in d.cells ? d.cells[k] : s.teachers[subjectId] ?? null;
  };
  const changes = Object.keys(d.subjects).length + Object.keys(d.ct).length + Object.keys(d.cells).length;
  const staffName = useMemo(() => new Map(g?.staff.map((s) => [s.public_id, s.name])), [g]);
  // Lessons per teacher in this grid, to help balance the load
  const load = useMemo(() => {
    const m = new Map<string, number>();
    g?.classes.forEach((c) => c.sections.forEach((s) => subjectsOf(c).forEach((sub) => { const t = cellOf(s, sub); if (t) m.set(t, (m.get(t) ?? 0) + 1); })));
    return m;
  }, [g, d]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => api<Grid>('/teaching/grid', { method: 'PUT', body: {
      yearId: g!.year.id,
      classSubjects: Object.entries(d.subjects).map(([classId, subjectIds]) => ({ classId: Number(classId), subjectIds })),
      classTeachers: Object.entries(d.ct).map(([sectionId, staffId]) => ({ sectionId: Number(sectionId), staffId })),
      assignments: Object.entries(d.cells).map(([k, staffId]) => { const [sectionId, subjectId] = k.split(':').map(Number); return { sectionId, subjectId, staffId }; }),
    } }),
    onSuccess: ({ data }) => { qc.setQueryData(['teaching-grid', yearId], data); qc.invalidateQueries({ queryKey: ['teaching'] }); toast.success('Teaching grid saved'); },
    onError: (e) => toast.error((e as ApiError).message, { duration: 8000 }),
  });

  if (q.isLoading) return <Skeleton rows={6} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  const select = (value: string | null, onChange: (v: string | null) => void, label: string) => (
    <select aria-label={label} disabled={!edit} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}
      className={clsx('field min-w-36 py-1.5 text-sm', !value && 'text-ink-muted')}>
      <option value="">Not assigned</option>
      {g!.staff.map((s) => <option key={s.public_id} value={s.public_id}>{s.name}</option>)}
    </select>
  );

  return (
    <div className="pb-24">
      <PageHeader title="Teaching grid" description="Subjects of each class, and who teaches them in every section. Assigned fresh each academic year." action={
        <select className="field w-auto" aria-label="Academic year" value={g!.year.id} onChange={(e) => setYearId(Number(e.target.value))}>
          {g!.years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' (current)' : y.status === 'planned' ? ' (planned)' : y.status === 'closed' ? ' (closed)' : ''}</option>)}
        </select>} />
      {!g!.year.editable && <p className="mb-4 rounded-lg bg-chalk px-4 py-3 text-sm text-ink-muted">{g!.year.name} is closed. This is a read-only record.</p>}
      {g!.subjects.length === 0 && <p className="mb-4 rounded-lg bg-tangedu-soft px-4 py-3 text-sm text-[#7A5A00]">No subjects yet. Add them under <Link className="font-semibold underline" to="/academics">Classes &amp; years</Link>.</p>}
      <div className="space-y-4">
        {g!.classes.map((c) => {
          const subs = subjectsOf(c);
          return (
            <section key={c.id} className="panel p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="mr-2 text-lg font-semibold">{c.name}</h2>
                {g!.subjects.map((s) => {
                  const on = subs.includes(s.id);
                  return (
                    <button key={s.id} disabled={!edit} aria-pressed={on} onClick={() => setD({ ...d, subjects: { ...d.subjects, [c.id]: on ? subs.filter((x) => x !== s.id) : [...subs, s.id] } })}
                      className={clsx('rounded-md border px-2 py-1 text-xs font-semibold', on ? 'border-brand bg-brand-soft text-brand' : 'border-dashed border-line text-ink-muted', edit && 'hover:border-brand')}>{s.name}</button>
                  );
                })}
              </div>
              {c.sections.length === 0 ? <p className="text-sm text-ink-muted">No sections.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-ink-muted"><tr>
                      <th className="py-2 pr-3 font-medium">Section</th><th className="py-2 pr-3 font-medium">Class teacher</th>
                      {subs.map((id) => <th key={id} className="py-2 pr-3 font-medium">{g!.subjects.find((s) => s.id === id)?.name}</th>)}
                    </tr></thead>
                    <tbody>
                      {c.sections.map((s) => (
                        <tr key={s.id} className="border-t border-line">
                          <td className="py-2 pr-3 font-semibold">{s.name}</td>
                          <td className="py-2 pr-3">{select(ctOf(s), (v) => setD({ ...d, ct: { ...d.ct, [s.id]: v } }), `${c.name} ${s.name} class teacher`)}</td>
                          {subs.map((sub) => (
                            <td key={sub} className="py-2 pr-3">{select(cellOf(s, sub), (v) => setD({ ...d, cells: { ...d.cells, [`${s.id}:${sub}`]: v } }), `${c.name} ${s.name} ${g!.subjects.find((x) => x.id === sub)?.name} teacher`)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
      {load.size > 0 && (
        <section className="panel mt-4 p-4">
          <h2 className="mb-2 font-semibold">Subjects per teacher</h2>
          <div className="flex flex-wrap gap-2">{[...load].sort((a, b) => b[1] - a[1]).map(([id, n]) => <span key={id} className="rounded-md bg-chalk px-2.5 py-1 text-sm">{staffName.get(id)} · <strong>{n}</strong></span>)}</div>
        </section>
      )}
      {edit && changes > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 p-3 backdrop-blur lg:bottom-0 lg:left-[264px]">
          <div className="mx-auto flex max-w-6xl items-center justify-end gap-2">
            <span className="mr-auto text-sm text-ink-muted">{changes} unsaved change{changes > 1 ? 's' : ''}</span>
            <button className="btn-quiet" onClick={() => setD(empty())}>Discard</button>
            <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save grid'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
