import { useQuery } from '@tanstack/react-query';
import { CalendarDays, FileText, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { openPdf } from '../lib/exams';
import { EmptyState, ErrorState, Skeleton } from './ui';

const d = (x: string) => new Date(`${x}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function StudentMarksTab({ studentId, name, classId }: { studentId: string; name: string; classId?: number | null }) {
  const { me } = useAuth();
  const family = me?.workspace !== 'staff';
  const q = useQuery({ queryKey: ['student-marks', studentId], queryFn: () => api<any>(`/students/${studentId}/marks`).then((r) => r.data) });
  const up = useQuery({ queryKey: ['exams-upcoming'], queryFn: () => api<any[]>('/exams/upcoming').then((r) => r.data) });
  if (q.isLoading) return <Skeleton rows={5} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const r = q.data;
  const papers = (up.data ?? []).filter((p) => !classId || p.classId === classId);
  const file = `report-card-${name.replace(/\s+/g, '-')}.pdf`;
  const pdf = (share: boolean) => openPdf(`/students/${studentId}/report-card.pdf`, file, share).catch((e) => toast.error(e.message));
  const showMarks = r.display !== 'grades', showGrades = r.display !== 'marks';
  return (
    <div className="space-y-4">
      {papers.length > 0 && (
        <section className="panel p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold"><CalendarDays size={18} className="text-brand" aria-hidden />Coming exams</h2>
          <ul className="divide-y divide-line">{papers.slice(0, 10).map((p, i) => (
            <li key={i} className="flex justify-between gap-2 py-2 text-sm"><span><strong>{p.exam}</strong> · {p.subject}</span><span className="text-ink-muted">{d(p.date)}{p.start ? `, ${p.start}${p.end ? `–${p.end}` : ''}` : ''}</span></li>))}</ul>
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => pdf(false)}><FileText size={16} aria-hidden />Report card</button>
        {family && typeof navigator.share === 'function' && <button className="btn-quiet" onClick={() => pdf(true)}><Share2 size={16} aria-hidden />Share</button>}
      </div>
      {r.skills ? (
        <section className="panel overflow-x-auto p-4">
          <table className="w-full text-sm"><thead className="text-ink-muted"><tr><th className="py-2 text-left font-medium">Skill</th><th className="px-2 font-medium">Term 1</th><th className="px-2 font-medium">Term 2</th></tr></thead>
            <tbody>{r.skills.map((k: any, i: number) => <tr key={i} className="border-t border-line"><td className="py-2"><span className="text-ink-muted">{k.group}: </span>{k.name}</td><td className="px-2 text-center">{k.terms[0] || '-'}</td><td className="px-2 text-center">{k.terms[1] || '-'}</td></tr>)}</tbody></table>
        </section>
      ) : !r.marks?.allExams.length ? <EmptyState title="No results yet" body={family ? 'Results appear here after the school publishes them.' : 'No marks entered yet.'} /> : (
        <>
          <section className="panel overflow-x-auto p-4">
            <table className="w-full text-sm">
              <thead className="text-ink-muted"><tr><th className="py-2 text-left font-medium">Subject</th>{r.marks.allExams.map((e: any) => <th key={e.code} className="px-2 font-medium">{e.code}<span className="block text-[11px] font-normal">/{e.max}</span></th>)}
                <th className="px-2 font-medium">Final</th>{showGrades && <th className="px-2 font-medium">Grade</th>}</tr></thead>
              <tbody>{r.marks.result.subjects.map((s: any) => (
                <tr key={s.subjectId} className="border-t border-line">
                  <td className="py-2 font-medium">{s.name}</td>
                  {r.marks.allExams.map((e: any) => { const c = s.cells[e.code]; return <td key={e.code} className={clsx('px-2 text-center tabular-nums', c?.absent && 'text-danger')}>{!c || (c.marks == null && !c.absent) ? '-' : c.absent ? 'AB' : showMarks ? c.marks : c.grade}</td>; })}
                  <td className={clsx('px-2 text-center font-semibold tabular-nums', s.pass === false && 'text-danger')}>{s.finalPct ?? '-'}</td>{showGrades && <td className="px-2 text-center font-semibold">{s.grade ?? '-'}</td>}
                </tr>))}</tbody>
            </table>
          </section>
          {r.marks.result.totalPct != null && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-chalk p-4"><p className="text-sm text-ink-muted">Overall</p><p className="text-3xl font-bold">{showMarks ? `${r.marks.result.totalPct}%` : r.marks.result.grade}</p>{showMarks && showGrades && <p className="text-sm text-ink-muted">Grade {r.marks.result.grade}</p>}</div>
              <div className="rounded-xl bg-chalk p-4"><p className="text-sm text-ink-muted">Rank in section</p><p className="text-3xl font-bold">{r.marks.result.rankSection ?? '-'}<span className="text-base font-normal text-ink-muted"> of {r.marks.sectionSize}</span></p></div>
              <div className="rounded-xl bg-chalk p-4"><p className="text-sm text-ink-muted">Rank in class</p><p className="text-3xl font-bold">{r.marks.result.rankClass ?? '-'}<span className="text-base font-normal text-ink-muted"> of {r.marks.classSize}</span></p></div>
            </div>
          )}
          {r.marks.result.failed > 0 && <p className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">Below the pass mark ({r.passPct}%) in {r.marks.result.failed} subject{r.marks.result.failed > 1 ? 's' : ''}.</p>}
        </>
      )}
      {r.remarks?.some((x: any) => x.text) && <section className="panel p-4"><h2 className="mb-2 font-semibold">Class teacher's remarks</h2>{r.remarks.filter((x: any) => x.text).map((x: any) => <p key={x.term} className="text-sm"><strong>Term {x.term}:</strong> {x.text}</p>)}</section>}
    </div>
  );
}
