import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import { initials } from '../lib/academics';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { StudentPhoto } from './Student360Page';

interface Data { sections: Array<{ id: number; label: string }>; sectionId: number | null; students: Array<{ id: string; name: string; rollNo: string | null; hasPhoto: boolean }> }

/** Go through a class and take each student's photo (any teacher of the class). */
export default function ClassPhotosPage() {
  const qc = useQueryClient();
  const [section, setSection] = useState<number | null>(null);
  const [v, setV] = useState<Record<string, number>>({});
  const q = useQuery({ queryKey: ['student-photos', section], queryFn: () => api<Data>('/student-photos', { query: { sectionId: section ?? undefined } }).then((r) => r.data) });
  const d = q.data;
  const missing = d?.students.filter((s) => !s.hasPhoto).length ?? 0;
  return (
    <div className="max-w-4xl">
      <Link to="/students" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink"><ArrowLeft size={16} aria-hidden />Students</Link>
      <PageHeader title="Class photos" description="Take or upload each student's photo. Photos are cropped square and appear on the student's page and report card." />
      {q.isLoading ? <Skeleton rows={4} /> : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /> : !d!.sections.length ? (
        <EmptyState title="No classes yet" body="You can take photos for sections where you are the class teacher or teach a subject." />
      ) : (<>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="cp-section">Section</label>
          <select id="cp-section" className="field w-auto min-w-44" value={d!.sectionId ?? ''} onChange={(e) => setSection(Number(e.target.value))}>
            {d!.sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <p className="text-[15px] text-ink-muted">{d!.students.length} students{missing ? ` · ${missing} without a photo` : ' · all have photos'}</p>
        </div>
        {!d!.students.length ? <EmptyState title="No students" body="No active students in this section." /> : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {d!.students.map((s) => (
              <li key={s.id} className="panel flex flex-col items-center p-3 text-center">
                <StudentPhoto id={s.id} initials={initials(s.name)} canEdit size="lg" version={v[s.id] ?? 0}
                  onChange={() => { setV({ ...v, [s.id]: (v[s.id] ?? 0) + 1 }); void qc.invalidateQueries({ queryKey: ['student-photos'] }); }} />
                <Link to={`/students/${s.id}`} className="mt-2 line-clamp-2 font-semibold hover:text-brand">{s.name}</Link>
                {s.rollNo && <p className="text-sm text-ink-muted">Roll {s.rollNo}</p>}
              </li>
            ))}
          </ul>
        )}
      </>)}
    </div>
  );
}
