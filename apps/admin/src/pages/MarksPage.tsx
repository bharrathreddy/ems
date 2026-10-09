import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Lock, Plus } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { RATINGS, SHEET_STATUS } from '../lib/exams';
import { Badge, EmptyState, ErrorState, Field, PageHeader, Sheet, Skeleton } from '../components/ui';

type Exam = { id: number; code: string; name: string; kind: string; maxMarks: number; onReportCard: boolean };
const err = (e: unknown) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message, { duration: 7000 });

function SheetList({ examId }: { examId: number }) {
  const q = useQuery({ queryKey: ['mark-sheets', examId], queryFn: () => api<any>('/marks/sheets', { query: { examId } }).then((r) => r.data) });
  if (q.isLoading) return <Skeleton rows={4} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  if (!q.data.sheets.length) return <EmptyState title="Nothing to enter" body="You enter marks for the subjects you teach. Ask the admin to assign you in the Teaching grid." />;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">{q.data.sheets.map((s: any) => {
      const st = SHEET_STATUS[s.status];
      return (
        <li key={`${s.sectionId}-${s.subjectId}`}>
          <Link to={`/marks/sheet?examId=${examId}&sectionId=${s.sectionId}&subjectId=${s.subjectId}`} className="panel flex items-center gap-3 p-4 hover:border-brand/40">
            <span className="min-w-0 flex-1"><span className="block font-semibold">{s.section} · {s.subject}</span>
              <span className="text-sm text-ink-muted">{s.entered} of {s.students} entered{s.teacher ? ` · ${s.teacher}` : ''}{s.published ? ' · published' : ''}</span>
              {s.status === 'returned' && s.returnNote && <span className="block text-sm text-danger">{s.returnNote}</span>}</span>
            <Badge tone={st.tone}>{st.label}</Badge><ChevronRight size={16} className="text-ink-muted" aria-hidden />
          </Link>
        </li>
      );
    })}</ul>
  );
}

export function MarkSheetPage() {
  const [p] = useSearchParams();
  const key = { examId: Number(p.get('examId')), sectionId: Number(p.get('sectionId')), subjectId: Number(p.get('subjectId')) };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mark-sheet', key], queryFn: () => api<any>('/marks/sheet', { query: key }).then((r) => r.data) });
  const [vals, setVals] = useState<Record<string, string>>({});
  const [fix, setFix] = useState<any>(null);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  useEffect(() => { if (q.data) setVals(Object.fromEntries(q.data.students.map((s: any) => [s.id, s.absent ? 'AB' : s.marks == null ? '' : String(s.marks)]))); }, [q.data]);
  const d = q.data;
  const bad = useMemo(() => new Set(Object.entries(vals).filter(([, v]) => v && v !== 'AB' && (isNaN(Number(v)) || Number(v) < 0 || Number(v) > (d?.exam.maxMarks ?? 0))).map(([k]) => k)), [vals, d]);
  const save = useMutation({
    mutationFn: (submit: boolean) => api<any>('/marks/sheet', { method: 'PUT', body: { ...key, submit, entries: Object.entries(vals).filter(([, v]) => v !== '').map(([studentId, v]) => ({ studentId, absent: v === 'AB', marks: v === 'AB' ? null : Number(v) })) } }),
    onSuccess: ({ data }, submit) => { qc.setQueryData(['mark-sheet', key], data); qc.invalidateQueries({ queryKey: ['mark-sheets'] }); toast.success(submit ? 'Submitted to the principal for approval' : 'Saved'); },
    onError: err,
  });
  const approve = useMutation({ mutationFn: (v: { approve: boolean; note?: string }) => api('/marks/sheet/decide', { method: 'POST', body: { ...key, ...v } }), onSuccess: () => { toast.success('Done'); q.refetch(); }, onError: err });
  if (q.isLoading) return <Skeleton rows={8} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const filled = Object.values(vals).filter((v) => v !== '').length;
  const st = SHEET_STATUS[d.status];
  return (
    <div className="max-w-2xl pb-28">
      <Link to={`/marks?examId=${key.examId}`} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink"><ArrowLeft size={16} aria-hidden />Marks</Link>
      <h1 className="text-2xl font-semibold">{d.exam.code} · {d.subject}</h1>
      <p className="text-ink-muted">{d.section} · out of {d.exam.maxMarks} · <Badge tone={st.tone}>{st.label}</Badge>{d.published && <> <Badge tone="brand">Published</Badge></>}</p>
      {d.returnNote && d.status === 'returned' && <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Sent back: {d.returnNote}</p>}
      {d.canEdit ? <p className="mt-3 text-sm text-ink-muted">Type marks and press Enter to go to the next student. Type <strong>AB</strong> for absent.</p>
        : <p className="mt-3 flex items-center gap-2 rounded-lg bg-chalk px-3 py-2 text-sm text-ink-muted"><Lock size={14} aria-hidden />{d.status === 'submitted' ? 'Submitted: waiting for the principal.' : d.canCorrect ? 'Published. To change a mark, use Correct.' : 'Approved.'}</p>}
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
        {d.students.map((s: any, i: number) => (
          <li key={s.id} className="flex items-center gap-3 px-3 py-2">
            <span className="w-7 text-sm tabular-nums text-ink-muted">{s.rollNo ?? '-'}</span>
            <span className="flex-1 font-medium">{s.name}</span>
            {d.canEdit ? (<>
              <input ref={(el) => { inputs.current[i] = el; }} inputMode="decimal" aria-label={`Marks for ${s.name}`} value={vals[s.id] ?? ''}
                onChange={(e) => setVals({ ...vals, [s.id]: e.target.value.toUpperCase().replace(/[^0-9.AB]/g, '').slice(0, 5) })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); inputs.current[i + 1]?.focus(); } }}
                className={clsx('field w-20 py-1.5 text-center tabular-nums', bad.has(s.id) && 'border-danger', vals[s.id] === 'AB' && 'text-danger')} />
              <button type="button" className={clsx('rounded-md border px-2 py-1 text-xs font-bold', vals[s.id] === 'AB' ? 'border-danger bg-danger-soft text-danger' : 'border-line text-ink-muted')} onClick={() => setVals({ ...vals, [s.id]: vals[s.id] === 'AB' ? '' : 'AB' })}>AB</button>
            </>) : (<>
              <span className={clsx('w-16 text-right font-semibold tabular-nums', s.absent && 'text-danger')}>{s.absent ? 'AB' : s.marks ?? '-'}</span>
              {d.canCorrect && <button className="text-sm font-semibold text-brand" onClick={() => setFix(s)}>Correct</button>}
            </>)}
          </li>
        ))}
      </ul>
      {(d.canEdit || d.canApprove) && (
        <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 p-3 backdrop-blur lg:bottom-0 lg:left-[264px]">
          <div className="mx-auto flex max-w-6xl items-center gap-2">
            {d.canEdit ? (<>
              <span className="flex-1 text-sm text-ink-muted">{filled} of {d.students.length} entered{bad.size ? <span className="text-danger"> · {bad.size} above {d.exam.maxMarks}</span> : ''}</span>
              <button className="btn-quiet" disabled={save.isPending || bad.size > 0} onClick={() => save.mutate(false)}>Save draft</button>
              <button className="btn-primary" disabled={save.isPending || bad.size > 0 || filled < d.students.length} onClick={() => confirm('Submit to the principal? You cannot change marks after submitting.') && save.mutate(true)}>Submit</button>
            </>) : (<>
              <span className="flex-1 text-sm text-ink-muted">Check the marks, then approve or send back.</span>
              <button className="btn-quiet" onClick={() => { const note = prompt('What should the teacher check?'); if (note) approve.mutate({ approve: false, note }); }}>Send back</button>
              <button className="btn-primary" onClick={() => approve.mutate({ approve: true })}>Approve</button>
            </>)}
          </div>
        </div>
      )}
      <CorrectionSheet student={fix} exam={d.exam} examId={key.examId} subjectId={key.subjectId} onClose={() => setFix(null)} />
    </div>
  );
}

function CorrectionSheet({ student, exam, examId, subjectId, onClose }: { student: any; exam: any; examId: number; subjectId: number; onClose: () => void }) {
  const [v, setV] = useState(''); const [reason, setReason] = useState('');
  useEffect(() => { setV(''); setReason(''); }, [student]);
  const m = useMutation({ mutationFn: () => api('/marks/corrections', { method: 'POST', body: { examId, subjectId, studentId: student.id, absent: v === 'AB', marks: v === 'AB' ? null : Number(v), reason } }),
    onSuccess: () => { toast.success('Correction sent to the principal'); onClose(); }, onError: err });
  return (
    <Sheet open={!!student} onClose={onClose} title={student ? `Correct ${student.name}'s mark` : ''} footer={<button className="btn-primary w-full" disabled={!v || reason.trim().length < 5 || m.isPending} onClick={() => m.mutate()}>Send for approval</button>}>
      {student && <div className="space-y-4">
        <p>Now: <strong>{student.absent ? 'AB' : student.marks}</strong> out of {exam.maxMarks}. The family is told when the principal approves the change.</p>
        <Field label="Correct mark (or AB)"><input className="field w-28" value={v} onChange={(e) => setV(e.target.value.toUpperCase().replace(/[^0-9.AB]/g, ''))} /></Field>
        <Field label="Reason"><textarea className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Totalling error on page 3" /></Field>
      </div>}
    </Sheet>
  );
}

function MyClass() {
  const classes = useQuery({ queryKey: ['my-classes'], queryFn: () => api<any[]>('/marks/my-classes').then((r) => r.data) });
  const mine = (classes.data ?? []).filter((c) => c.mine);
  const list = mine.length ? mine : classes.data ?? [];
  const [sectionId, setSectionId] = useState<number | null>(null);
  const [term, setTerm] = useState(1);
  const sid = sectionId ?? list[0]?.sectionId ?? null;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ct-sheet', sid, term], enabled: !!sid, queryFn: () => api<any>('/marks/class-teacher', { query: { sectionId: sid!, term } }).then((r) => r.data) });
  const [rows, setRows] = useState<Record<string, any>>({});
  useEffect(() => { if (q.data) setRows(Object.fromEntries(q.data.students.map((s: any) => [s.id, { grades: { ...s.grades }, ratings: { ...s.ratings }, remarks: s.remarks }]))); }, [q.data]);
  const save = useMutation({ mutationFn: () => api('/marks/class-teacher', { method: 'PUT', body: { sectionId: sid, term, rows: Object.entries(rows).map(([studentId, r]) => ({ studentId, ...r })) } }), onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['ct-sheet'] }); }, onError: err });
  const [newArea, setNewArea] = useState('');
  const addArea = useMutation({ mutationFn: () => api('/exams/co-areas', { method: 'POST', body: { name: newArea, classId: q.data.classId } }), onSuccess: () => { setNewArea(''); q.refetch(); }, onError: err });
  if (classes.isLoading) return <Skeleton rows={3} />;
  if (!list.length) return <EmptyState title="You are not a class teacher" body="Class teachers grade co-scholastic areas and write remarks for their class here." />;
  const d = q.data;
  return (
    <div className="pb-24">
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="field w-auto" aria-label="Section" value={sid ?? ''} onChange={(e) => setSectionId(Number(e.target.value))}>{list.map((c) => <option key={c.sectionId} value={c.sectionId}>{c.name}</option>)}</select>
        <select className="field w-auto" aria-label="Term" value={term} onChange={(e) => setTerm(Number(e.target.value))}><option value={1}>Term 1 (SA1)</option><option value={2}>Term 2 (SA2)</option></select>
      </div>
      {!d ? <Skeleton rows={5} /> : d.assessment === 'skills' ? (
        <div className="space-y-3">{d.students.map((s: any) => (
          <details key={s.id} className="panel p-4"><summary className="cursor-pointer font-semibold">{s.name} <span className="text-sm font-normal text-ink-muted">· {Object.keys(rows[s.id]?.ratings ?? {}).length} of {d.skills.length} rated</span></summary>
            <ul className="mt-3 space-y-2">{d.skills.map((k: any) => (
              <li key={k.id} className="flex flex-wrap items-center gap-2"><span className="flex-1 text-sm"><span className="text-ink-muted">{k.group}: </span>{k.name}</span>
                <div className="inline-flex rounded-lg border border-line">{RATINGS.map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setRows({ ...rows, [s.id]: { ...rows[s.id], ratings: { ...rows[s.id].ratings, [k.id]: v } } })}
                    className={clsx('px-2.5 py-1 text-xs font-semibold', rows[s.id]?.ratings?.[k.id] === v ? 'bg-brand text-white' : 'text-ink-muted')}>{l}</button>))}</div></li>))}</ul>
            <Field label="Remarks"><textarea className="field mt-2" value={rows[s.id]?.remarks ?? ''} onChange={(e) => setRows({ ...rows, [s.id]: { ...rows[s.id], remarks: e.target.value } })} /></Field>
          </details>))}</div>
      ) : (
        <>
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-ink-muted"><tr><th className="px-3 py-2 text-left font-medium">Student</th>{d.areas.map((a: any) => <th key={a.id} className="px-2 py-2 font-medium">{a.name}</th>)}<th className="px-3 py-2 text-left font-medium">Remarks</th></tr></thead>
              <tbody>{d.students.map((s: any) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{s.name}</td>
                  {d.areas.map((a: any) => (
                    <td key={a.id} className="px-2 py-2 text-center"><select aria-label={`${a.name} for ${s.name}`} className="field w-20 px-1 py-1 text-sm" value={rows[s.id]?.grades?.[a.id] ?? ''}
                      onChange={(e) => setRows({ ...rows, [s.id]: { ...rows[s.id], grades: { ...rows[s.id].grades, [a.id]: e.target.value } } })}>
                      <option value="">-</option>{['A+', 'A', 'B', 'C'].map((g) => <option key={g}>{g}</option>)}</select></td>))}
                  <td className="px-3 py-2"><input className="field min-w-56 py-1.5 text-sm" aria-label={`Remarks for ${s.name}`} value={rows[s.id]?.remarks ?? ''} onChange={(e) => setRows({ ...rows, [s.id]: { ...rows[s.id], remarks: e.target.value } })} /></td>
                </tr>))}</tbody>
            </table>
          </div>
          <form className="mt-3 flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); if (newArea.trim().length >= 2) addArea.mutate(); }}>
            <input className="field" placeholder="Add an area for this class, e.g. Spoken English" value={newArea} onChange={(e) => setNewArea(e.target.value)} />
            <button className="btn-quiet" disabled={newArea.trim().length < 2}><Plus size={16} aria-hidden />Add</button>
          </form>
        </>
      )}
      <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 p-3 backdrop-blur lg:bottom-0 lg:left-[264px]">
        <div className="mx-auto flex max-w-6xl justify-end"><button className="btn-primary" disabled={save.isPending || !d} onClick={() => save.mutate()}>Save</button></div>
      </div>
    </div>
  );
}

function MyCorrections() {
  const q = useQuery({ queryKey: ['corrections'], queryFn: () => api<any[]>('/marks/corrections').then((r) => r.data) });
  if (q.isLoading) return <Skeleton rows={3} />;
  if (!q.data?.length) return <EmptyState title="No corrections" body="After results are published, use Correct on a mark sheet to fix a mistake." />;
  return <CorrectionList rows={q.data} />;
}

export function CorrectionList({ rows, onChange }: { rows: any[]; onChange?: () => void }) {
  const decide = useMutation({ mutationFn: (v: { id: number; approve: boolean; note?: string }) => api(`/marks/corrections/${v.id}/decide`, { method: 'POST', body: v }), onSuccess: () => { toast.success('Done'); onChange?.(); }, onError: err });
  return (
    <ul className="panel divide-y divide-line">{rows.map((c) => (
      <li key={c.id} className="px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="font-semibold">{c.student} <span className="font-normal text-ink-muted">· {c.section} · {c.exam} {c.subject}</span></p>
          <Badge tone={c.status === 'approved' ? 'brand' : c.status === 'pending' ? 'attention' : 'danger'}>{c.status === 'pending' ? 'Waiting' : c.status === 'approved' ? 'Approved' : 'Not approved'}</Badge></div>
        <p className="text-sm">{c.from} → <strong>{c.to}</strong> (out of {c.maxMarks}) · {c.reason} <span className="text-ink-muted">· {c.requestedBy}</span></p>
        {c.decisionNote && <p className="text-sm text-ink-muted">{c.decidedBy}: {c.decisionNote}</p>}
        {c.canDecide && <div className="mt-2 flex gap-2"><button className="btn-primary min-h-9 text-sm" onClick={() => decide.mutate({ id: c.id, approve: true })}>Approve</button>
          <button className="btn-quiet min-h-9 text-sm" onClick={() => { const note = prompt('Reason for not approving:'); if (note !== null) decide.mutate({ id: c.id, approve: false, note }); }}>Do not approve</button></div>}
      </li>))}</ul>
  );
}

export default function MarksPage() {
  const { can } = useAuth();
  const [p, setP] = useSearchParams();
  const exams = useQuery({ queryKey: ['exam-list'], queryFn: () => api<Exam[]>('/exams/list').then((r) => r.data) });
  const examId = Number(p.get('examId')) || exams.data?.[0]?.id;
  const [tab, setTab] = useState<'sheets' | 'class' | 'corrections'>('sheets');
  return (
    <div>
      <PageHeader title="Marks" description="Enter marks for your subjects, and grades and remarks for your class." />
      <div className="mb-4 inline-flex rounded-lg border border-line bg-chalk p-0.5">
        {([['sheets', 'Mark sheets'], ['class', 'My class'], ['corrections', 'Corrections']] as const).map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)} className={clsx('rounded-md px-4 py-2 text-sm font-semibold', tab === k ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted')}>{l}</button>)}
      </div>
      {tab === 'sheets' && (exams.isLoading ? <Skeleton rows={3} /> : !exams.data?.length ? <EmptyState title="No exams" body="" /> : (
        <>
          <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            {exams.data.map((e) => <button key={e.id} onClick={() => setP({ examId: String(e.id) })} className={clsx('shrink-0 rounded-lg border px-3 py-1.5 text-sm font-semibold', e.id === examId ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface')}>{e.code}</button>)}
          </div>
          {examId && <SheetList examId={examId} />}
        </>
      ))}
      {tab === 'class' && <MyClass />}
      {tab === 'corrections' && <MyCorrections />}
      {can('marks.approve') && <p className="mt-6 text-sm text-ink-muted">Approvals and publishing are in <Link className="font-semibold text-brand underline" to="/exams">Exams</Link>.</p>}
    </div>
  );
}
