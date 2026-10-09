import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '../lib/api';
import { openPdf } from '../lib/exams';
import { EmptyState, ErrorState, Field, PageHeader, Skeleton } from '../components/ui';

interface Exam { id: number; code: string; name: string; first: string; last: string; note: string; customNote: boolean; classIds: number[] }
interface Options { today: string; defaultNote: string; canEditNote: boolean; exams: Exam[]; sections: Array<{ id: number; classId: number; label: string }> }
interface Check { students: number; noPhoto: string[]; noRoll: string[]; papers: Array<{ date: string; subject: string; start: string | null; end: string | null }> }

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const t12 = (t: string | null) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
const names = (list: string[]) => list.length > 6 ? `${list.slice(0, 6).join(', ')} and ${list.length - 6} more` : list.join(', ');

/** Print hall tickets class-wise: two per A4 page with the class's exam timetable. */
export default function HallTicketsPage() {
  const opts = useQuery({ queryKey: ['hall-ticket-options'], queryFn: () => api<Options>('/hall-tickets/options').then((r) => r.data) });
  const [examId, setExamId] = useState<number | null>(null);
  const [sectionId, setSectionId] = useState<number | null>(null);
  const o = opts.data;
  // Default: the next exam that is not over yet.
  useEffect(() => { if (o && examId === null && o.exams.length) setExamId((o.exams.find((e) => e.last >= o.today) ?? o.exams[o.exams.length - 1]).id); }, [o, examId]);
  const exam = o?.exams.find((e) => e.id === examId);
  const sections = (o?.sections ?? []).filter((s) => !exam || exam.classIds.includes(s.classId));
  useEffect(() => { if (exam && !sections.some((s) => s.id === sectionId)) setSectionId(sections[0]?.id ?? null); }, [exam?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const check = useQuery({ queryKey: ['hall-ticket-check', examId, sectionId], enabled: !!examId && !!sectionId,
    queryFn: () => api<Check>('/hall-tickets/check', { query: { examId: examId!, sectionId: sectionId! } }).then((r) => r.data) });
  const [printing, setPrinting] = useState(false);
  const print = async () => {
    const s = sections.find((x) => x.id === sectionId);
    setPrinting(true);
    try { await openPdf(`/hall-tickets/section.pdf?examId=${examId}&sectionId=${sectionId}`, `hall-tickets-${exam!.code}-${s?.label.replace(/\s+/g, '-')}.pdf`); }
    catch (e) { toast.error((e as Error).message, { duration: 7000 }); } finally { setPrinting(false); }
  };
  if (opts.isLoading) return <Skeleton rows={4} />;
  if (opts.isError) return <ErrorState message={(opts.error as Error).message} onRetry={() => opts.refetch()} />;
  const c = check.data;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Hall tickets" description="Print hall tickets for a class: two per A4 page, with the student's photo, roll number and the exam timetable." />
      {!o!.exams.length ? (
        <EmptyState title="No exam timetable yet" body="Hall tickets need the exam timetable. Set the dates and times in Exams → Exams & schedule." />
      ) : !o!.sections.length ? (
        <EmptyState title="No sections for you" body="You can print hall tickets for sections where you are the class teacher or teach a subject." />
      ) : (<>
        <div className="panel mb-4 grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Exam">
            <select className="field" value={examId ?? ''} onChange={(e) => setExamId(Number(e.target.value))}>
              {o!.exams.map((e) => <option key={e.id} value={e.id}>{e.name} ({day(e.first)} – {day(e.last)})</option>)}
            </select>
          </Field>
          <Field label="Class and section">
            <select className="field" value={sectionId ?? ''} onChange={(e) => setSectionId(Number(e.target.value))} disabled={!sections.length}>
              {!sections.length && <option>No timetable for your classes</option>}
              {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
        </div>
        {sectionId && (check.isLoading ? <Skeleton rows={3} /> : check.isError ? <ErrorState message={(check.error as Error).message} /> : c && (
          <div className="space-y-4">
            <section className="panel p-4">
              <h2 className="mb-2 font-semibold">Timetable on the hall ticket</h2>
              {!c.papers.length ? <p className="text-[15px] text-ink-muted">No timetable for this class yet. Set it in Exams → Exams & schedule.</p> : (
                <ul className="divide-y divide-line">{c.papers.map((p, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-x-4 py-2 text-[15px]"><span><span className="text-ink-muted">{day(p.date)}</span> · <strong>{p.subject}</strong></span><span className="text-ink-muted">{p.start ? `${t12(p.start)}${p.end ? ` – ${t12(p.end)}` : ''}` : 'Time not set'}</span></li>))}</ul>
              )}
            </section>
            {(c.noPhoto.length > 0 || c.noRoll.length > 0) && (
              <section className="space-y-2 rounded-xl bg-tangedu-soft p-4 text-[15px]">
                {c.noPhoto.length > 0 && <p className="flex gap-2"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-[#7A5A00]" aria-hidden /><span><strong>{c.noPhoto.length} without a photo:</strong> {names(c.noPhoto)}. Their ticket gets a box to paste a photo. <Link to="/students/photos" className="font-semibold text-brand underline">Take photos</Link></span></p>}
                {c.noRoll.length > 0 && <p className="flex gap-2"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-[#7A5A00]" aria-hidden /><span><strong>{c.noRoll.length} without a roll number:</strong> {names(c.noRoll)}. The office can set roll numbers in Year end → Roll numbers.</span></p>}
              </section>
            )}
            <button className="btn-primary w-full sm:w-auto" disabled={!c.papers.length || !c.students || printing} onClick={() => void print()}>
              <Printer size={18} aria-hidden />{printing ? 'Preparing…' : `Print ${c.students} hall ticket${c.students === 1 ? '' : 's'}`}
            </button>
            <p className="text-sm text-ink-muted">Opens a PDF. Print on A4 and cut along the dotted line. Parents can also download their child's hall ticket in the app (Marks tab).</p>
            {exam && <NoteEditor exam={exam} canEdit={o!.canEditNote} defaultNote={o!.defaultNote} />}
          </div>
        ))}
      </>)}
    </div>
  );
}

function NoteEditor({ exam, canEdit, defaultNote }: { exam: Exam; canEdit: boolean; defaultNote: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState(exam.note);
  useEffect(() => setText(exam.note), [exam.id, exam.note]);
  const save = useMutation({ mutationFn: (t: string | null) => api(`/exams/${exam.id}/hall-ticket-note`, { method: 'PUT', body: { text: t } }),
    onSuccess: () => { toast.success('Instructions saved'); void qc.invalidateQueries({ queryKey: ['hall-ticket-options'] }); }, onError: (e) => toast.error((e as ApiError).message) });
  const lines = exam.note.split('\n').filter((l) => l.trim());
  return (
    <section className="panel p-4">
      <h2 className="font-semibold">Instructions on the {exam.name} hall tickets</h2>
      {!canEdit ? (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[15px] text-ink-muted">{lines.map((l, i) => <li key={i}>{l}</li>)}</ol>
      ) : (<>
        <p className="mt-0.5 text-sm text-ink-muted">One instruction per line. They are numbered on the ticket. Keep it to 4–6 short lines so everything fits.</p>
        <textarea className="field mt-3 min-h-32" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} aria-label="Instructions" />
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary min-h-10 text-sm" disabled={save.isPending || text === exam.note} onClick={() => save.mutate(text)}>Save instructions</button>
          {exam.customNote && <button className="btn-quiet min-h-10 text-sm" disabled={save.isPending} onClick={() => save.mutate(null)}>Use the standard text</button>}
          {!exam.customNote && text === defaultNote && <span className="self-center text-sm text-ink-muted">Using the standard text</span>}
        </div>
      </>)}
    </section>
  );
}
