import { useEffect, useState } from 'react';
import ExportButtons from '../components/ExportButtons';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useClasses } from '../lib/academics';
import { openPdf, SHEET_STATUS, useExamSetup, type ExamSetup } from '../lib/exams';
import { Badge, EmptyState, ErrorState, Field, PageHeader, Skeleton } from '../components/ui';
import { CorrectionList } from './MarksPage';

const err = (e: unknown) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message, { duration: 7000 });

function ExamPicker({ s, value, onChange, cardOnly }: { s: ExamSetup; value: number | null; onChange: (id: number) => void; cardOnly?: boolean }) {
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {s.exams.filter((e) => !cardOnly || e.onReportCard).map((e) => <button key={e.id} onClick={() => onChange(e.id)} className={clsx('shrink-0 rounded-lg border px-3 py-1.5 text-sm font-semibold', e.id === value ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface')}>{e.code}</button>)}
    </div>
  );
}

function ExamsTab({ s }: { s: ExamSetup }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const edit = can('exams.configure') && s.year.editable;
  const [examId, setExamId] = useState<number | null>(s.exams[0]?.id ?? null);
  const [classId, setClassId] = useState<number | null>(null);
  const exam = s.exams.find((e) => e.id === examId);
  const classes = s.classes.filter((c) => exam?.classIds.includes(c.id));
  const cid = classId && classes.some((c) => c.id === classId) ? classId : classes[0]?.id ?? null;
  const sched = useQuery({ queryKey: ['schedule', examId, cid], enabled: !!examId && !!cid, queryFn: () => api<any>(`/exams/${examId}/schedule`, { query: { classId: cid! } }).then((r) => r.data) });
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => setRows(sched.data?.subjects ?? []), [sched.data]);
  const save = useMutation({ mutationFn: () => api(`/exams/${examId}/schedule`, { method: 'PUT', body: { classId: cid, rows: rows.map((r) => ({ subjectId: r.subjectId, date: r.date || null, start: r.start || null, end: r.end || null })) } }), onSuccess: () => { toast.success('Schedule saved'); sched.refetch(); qc.invalidateQueries({ queryKey: ['dashboard'] }); }, onError: err });
  const [f, setF] = useState({ name: '', code: '', kind: 'unit', maxMarks: 25, classIds: [] as number[] });
  const add = useMutation({ mutationFn: () => api('/exams', { method: 'POST', body: f }), onSuccess: () => { toast.success('Exam added'); setF({ ...f, name: '', code: '' }); qc.invalidateQueries({ queryKey: ['exam-setup'] }); }, onError: err });
  const del = useMutation({ mutationFn: (id: number) => api(`/exams/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['exam-setup'] }), onError: err });
  return (
    <div className="space-y-4">
      <section className="panel p-5">
        <h2 className="mb-3 font-semibold">Exams in {s.year.name}</h2>
        <ul className="divide-y divide-line">{s.exams.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <span className="w-16 font-bold">{e.code}</span>
            <span className="min-w-0 flex-1"><span className="font-medium">{e.name}</span><span className="block text-sm text-ink-muted">out of {e.maxMarks} · {e.onReportCard ? `report card${e.term ? `, term ${e.term}` : ''}` : 'tracking only (not on report card)'} · {e.classIds.length} classes</span></span>
            {edit && !e.onReportCard && <button aria-label={`Delete ${e.code}`} className="p-2 text-ink-muted hover:text-danger" onClick={() => confirm(`Delete ${e.name}?`) && del.mutate(e.id)}><Trash2 size={16} /></button>}
          </li>))}</ul>
        {edit && (
          <div className="mt-4 rounded-xl bg-chalk p-4">
            <p className="mb-3 font-semibold">Add a unit test or pre-final</p>
            <div className="grid gap-2 sm:grid-cols-[1.4fr_0.7fr_1fr_0.6fr]">
              <Field label="Name"><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Unit Test 1" /></Field>
              <Field label="Short name"><input className="field" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^\w-]/g, '') })} placeholder="UT1" /></Field>
              <Field label="Type"><select className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="unit">Unit test</option><option value="prefinal">Pre-final</option></select></Field>
              <Field label="Out of"><input type="number" className="field" value={f.maxMarks} onChange={(e) => setF({ ...f, maxMarks: Number(e.target.value) })} /></Field>
            </div>
            <p className="label mt-3">Classes</p>
            <div className="flex flex-wrap gap-1.5">{s.classes.filter((c) => c.assessment === 'marks').map((c) => {
              const on = f.classIds.includes(c.id);
              return <button key={c.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, classIds: on ? f.classIds.filter((x) => x !== c.id) : [...f.classIds, c.id] })} className={clsx('rounded-lg border px-2.5 py-1 text-sm', on ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface')}>{c.name}</button>;
            })}</div>
            <button className="btn-primary mt-3" disabled={add.isPending || f.name.length < 2 || !f.code || !f.classIds.length} onClick={() => add.mutate()}><Plus size={16} aria-hidden />Add exam</button>
          </div>
        )}
      </section>
      <section className="panel p-5">
        <h2 className="mb-3 font-semibold">Schedule</h2>
        <ExamPicker s={s} value={examId} onChange={setExamId} />
        <select className="field mt-3 w-auto" aria-label="Class" value={cid ?? ''} onChange={(e) => setClassId(Number(e.target.value))}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        {!rows.length ? <p className="mt-3 text-sm text-ink-muted">This class has no subjects yet (Teaching grid).</p> : (
          <div className="mt-3 space-y-2">{rows.map((r, i) => (
            <div key={r.subjectId} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
              <span className="font-medium">{r.subject}</span>
              <input type="date" className="field w-auto py-1.5" disabled={!edit} aria-label={`${r.subject} date`} value={r.date ?? ''} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
              <input type="time" className="field w-auto py-1.5" disabled={!edit} aria-label={`${r.subject} start`} value={r.start ?? ''} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
              <input type="time" className="field w-auto py-1.5" disabled={!edit} aria-label={`${r.subject} end`} value={r.end ?? ''} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
            </div>))}
            {edit && <button className="btn-primary mt-2" disabled={save.isPending} onClick={() => save.mutate()}>Save schedule</button>}
          </div>
        )}
      </section>
    </div>
  );
}

function ApprovalsTab({ s }: { s: ExamSetup }) {
  const qc = useQueryClient();
  const [examId, setExamId] = useState<number | null>(s.exams[0]?.id ?? null);
  const q = useQuery({ queryKey: ['mark-sheets', examId], enabled: !!examId, queryFn: () => api<any>('/marks/sheets', { query: { examId: examId! } }).then((r) => r.data) });
  const publish = useMutation({ mutationFn: (sectionId: number) => api(`/exams/${examId}/publish`, { method: 'POST', body: { sectionId } }), onSuccess: () => { toast.success('Published. Families are notified.'); qc.invalidateQueries({ queryKey: ['mark-sheets'] }); }, onError: err });
  const bySection = new Map<number, any[]>();
  for (const sh of q.data?.sheets ?? []) bySection.set(sh.sectionId, [...(bySection.get(sh.sectionId) ?? []), sh]);
  return (
    <div className="space-y-3">
      <ExamPicker s={s} value={examId} onChange={setExamId} />
      {q.isLoading ? <Skeleton rows={4} /> : !bySection.size ? <EmptyState title="No mark sheets" body="Assign subjects and teachers in the Teaching grid." /> : [...bySection.entries()].map(([sid, list]) => {
        const all = list.every((x) => x.status === 'approved');
        const published = list[0].published;
        return (
          <section key={sid} className="panel p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2"><h3 className="flex-1 font-semibold">{list[0].section}</h3>
              {published ? <Badge tone="brand">Published</Badge> : q.data.canPublish && <button className="btn-primary min-h-9 text-sm" disabled={!all || publish.isPending} title={all ? '' : 'Approve every subject first'} onClick={() => confirm(`Publish ${q.data.exam.code} results for ${list[0].section}? Families will be notified.`) && publish.mutate(sid)}>Publish</button>}</div>
            <ul className="divide-y divide-line">{list.map((x: any) => (
              <li key={x.subjectId}><Link to={`/marks/sheet?examId=${examId}&sectionId=${sid}&subjectId=${x.subjectId}`} className="flex items-center gap-3 py-2 hover:text-brand">
                <span className="flex-1">{x.subject} <span className="text-sm text-ink-muted">· {x.teacher ?? 'No teacher'} · {x.entered}/{x.students}</span></span>
                <Badge tone={SHEET_STATUS[x.status].tone}>{SHEET_STATUS[x.status].label}</Badge></Link></li>))}</ul>
          </section>
        );
      })}
    </div>
  );
}

function ResultsTab() {
  const classes = useClasses();
  const [sectionId, setSectionId] = useState('');
  const q = useQuery({ queryKey: ['results', sectionId], enabled: !!sectionId, queryFn: () => api<any>('/exams/results', { query: { sectionId } }).then((r) => r.data) });
  const sections = (classes.data ?? []).flatMap((c) => c.sections.map((x) => ({ id: x.id, label: `${c.name} ${x.name}` })));
  const d = q.data;
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="field w-auto" aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}><option value="">Choose section</option>{sections.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        {sectionId && <button className="btn-quiet" onClick={() => openPdf(`/sections/${sectionId}/report-cards.pdf`, 'report-cards.pdf').catch(err)}><FileText size={16} aria-hidden />Print all report cards</button>}
        {sectionId && <ExportButtons list="exam-results" name="results" params={{ sectionId }} />}
      </div>
      {!sectionId ? <EmptyState title="Choose a section" body="See every student's result and rank. Marks not yet published are included here for checking." /> : q.isLoading ? <Skeleton rows={5} /> : q.isError ? <ErrorState message={(q.error as Error).message} /> : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-ink-muted"><tr><th className="px-3 py-2 text-left font-medium">Rank</th><th className="px-3 py-2 text-left font-medium">Student</th>
              {d.subjects.map((x: any) => <th key={x.id} className="px-2 py-2 font-medium">{x.name}</th>)}<th className="px-2 py-2 font-medium">Total %</th><th className="px-2 py-2 font-medium">Grade</th><th className="px-2 py-2 font-medium">Class rank</th><th /></tr></thead>
            <tbody>{d.students.map((st: any) => (
              <tr key={st.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-bold">{st.rankSection ?? '-'}</td><td className="whitespace-nowrap px-3 py-2"><Link to={`/students/${st.id}`} className="font-medium">{st.name}</Link></td>
                {st.subjects.map((x: any) => <td key={x.subjectId} className={clsx('px-2 py-2 text-center tabular-nums', x.pass === false && 'font-semibold text-danger')}>{x.finalPct ?? '-'}{x.grade ? <span className="text-ink-muted"> {x.grade}</span> : ''}</td>)}
                <td className="px-2 py-2 text-center font-semibold tabular-nums">{st.totalPct ?? '-'}</td><td className="px-2 py-2 text-center font-semibold">{st.grade ?? '-'}</td><td className="px-2 py-2 text-center">{st.rankClass ?? '-'}</td>
                <td className="px-2 py-2"><button className="text-sm font-semibold text-brand" onClick={() => openPdf(`/students/${st.id}/report-card.pdf`, `report-card-${st.name}.pdf`).catch(err)}>Card</button></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SettingsTab({ s }: { s: ExamSetup }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const edit = can('exams.configure') && s.year.editable;
  const [rules, setRules] = useState(s.classes);
  useEffect(() => setRules(s.classes), [s]);
  const saveRules = useMutation({ mutationFn: () => api('/exams/class-rules', { method: 'PUT', body: { rows: rules.filter((c) => c.assessment === 'marks').map((c) => ({ classId: c.id, gradeScaleId: c.gradeScaleId, display: c.display, formula: c.formula, faWeight: c.faWeight, passPct: c.passPct })) } }),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['exam-setup'] }); }, onError: err });
  const upd = (id: number, p: any) => setRules(rules.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const [scale, setScale] = useState<any>(null);
  const saveScale = useMutation({ mutationFn: () => api(`/grade-scales/${scale.id}`, { method: 'PUT', body: { name: scale.name, bands: scale.bands } }), onSuccess: () => { toast.success('Grade scale saved'); setScale(null); qc.invalidateQueries({ queryKey: ['exam-setup'] }); }, onError: err });
  const [area, setArea] = useState('');
  const addArea = useMutation({ mutationFn: () => api('/exams/co-areas', { method: 'POST', body: { name: area, classId: null } }), onSuccess: () => { setArea(''); qc.invalidateQueries({ queryKey: ['exam-setup'] }); }, onError: err });
  const delArea = useMutation({ mutationFn: (id: number) => api(`/exams/co-areas/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['exam-setup'] }), onError: err });
  const [skills, setSkills] = useState(s.skills);
  useEffect(() => setSkills(s.skills), [s]);
  const saveSkills = useMutation({ mutationFn: () => api('/exams/skills', { method: 'PUT', body: { skills: skills.map((k) => ({ id: k.id > 0 ? k.id : undefined, group: k.group, name: k.name, classId: k.classId })) } }), onSuccess: () => { toast.success('Skills saved'); qc.invalidateQueries({ queryKey: ['exam-setup'] }); }, onError: err });
  return (
    <div className="space-y-4">
      <section className="panel overflow-x-auto p-5">
        <h2 className="font-semibold">Result rules per class</h2>
        <p className="mb-3 text-sm text-ink-muted">What families and the report card show, and how the final is worked out. Pre-primary classes use skills instead of marks.</p>
        <table className="w-full text-sm"><thead className="text-ink-muted"><tr><th className="py-2 pr-2 text-left font-medium">Class</th><th className="px-2 font-medium">Grade scale</th><th className="px-2 font-medium">Show</th><th className="px-2 font-medium">Final</th><th className="px-2 font-medium">FA weight %</th><th className="px-2 font-medium">Pass %</th></tr></thead>
          <tbody>{rules.map((c) => c.assessment === 'skills' ? (
            <tr key={c.id} className="border-t border-line"><td className="py-2 pr-2 font-medium">{c.name}</td><td colSpan={5} className="px-2 text-ink-muted">Skills report (Excellent / Good / Needs practice)</td></tr>
          ) : (
            <tr key={c.id} className="border-t border-line">
              <td className="py-2 pr-2 font-medium">{c.name}</td>
              <td className="px-2"><select disabled={!edit} className="field py-1 text-sm" value={c.gradeScaleId ?? ''} onChange={(e) => upd(c.id, { gradeScaleId: Number(e.target.value) || null })}>{s.scales.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
              <td className="px-2"><select disabled={!edit} className="field py-1 text-sm" value={c.display} onChange={(e) => upd(c.id, { display: e.target.value })}><option value="both">Marks and grades</option><option value="marks">Marks only</option><option value="grades">Grades only</option></select></td>
              <td className="px-2"><select disabled={!edit} className="field py-1 text-sm" value={c.formula} onChange={(e) => upd(c.id, { formula: e.target.value })}><option value="term">Per term (FA avg + SA), average of terms</option><option value="year_end">All FAs average + SA2</option><option value="weights">All FAs and SAs by weight</option></select></td>
              <td className="px-2"><input disabled={!edit} type="number" min={0} max={100} className="field w-20 py-1 text-sm" value={c.faWeight} onChange={(e) => upd(c.id, { faWeight: Number(e.target.value) })} /></td>
              <td className="px-2"><input disabled={!edit} type="number" min={0} max={100} className="field w-20 py-1 text-sm" value={c.passPct} onChange={(e) => upd(c.id, { passPct: Number(e.target.value) })} /></td>
            </tr>))}</tbody></table>
        {edit && <button className="btn-primary mt-3" disabled={saveRules.isPending} onClick={() => saveRules.mutate()}>Save rules</button>}
      </section>
      <section className="panel p-5">
        <h2 className="mb-3 font-semibold">Grade scales</h2>
        <div className="grid gap-3 md:grid-cols-2">{s.scales.map((x) => (
          <div key={x.id} className="rounded-xl border border-line p-3">
            <div className="mb-2 flex items-center justify-between"><p className="font-semibold">{x.name}</p>{edit && <button className="text-sm font-semibold text-brand" onClick={() => setScale(JSON.parse(JSON.stringify(x)))}>Edit</button>}</div>
            <p className="text-sm text-ink-muted">{x.bands.map((b) => `${b.grade} ≥ ${b.min}%`).join(' · ')}</p>
          </div>))}</div>
        {scale && (
          <div className="mt-3 rounded-xl bg-chalk p-4">
            <Field label="Scale name"><input className="field" value={scale.name} onChange={(e) => setScale({ ...scale, name: e.target.value })} /></Field>
            <div className="mt-3 space-y-2">{scale.bands.map((b: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <input className="field w-20" aria-label="Grade" value={b.grade} onChange={(e) => setScale({ ...scale, bands: scale.bands.map((y: any, j: number) => (j === i ? { ...y, grade: e.target.value } : y)) })} />
                <span className="text-sm">from</span><input type="number" className="field w-24" aria-label="From %" value={b.min} onChange={(e) => setScale({ ...scale, bands: scale.bands.map((y: any, j: number) => (j === i ? { ...y, min: Number(e.target.value) } : y)) })} /><span className="text-sm">%</span>
                <button className="p-1 text-ink-muted hover:text-danger" aria-label="Remove" onClick={() => setScale({ ...scale, bands: scale.bands.filter((_: any, j: number) => j !== i) })}><Trash2 size={16} /></button>
              </div>))}</div>
            <div className="mt-3 flex gap-2"><button className="btn-quiet" onClick={() => setScale({ ...scale, bands: [...scale.bands, { grade: '', min: 0 }] })}><Plus size={16} aria-hidden />Grade</button>
              <button className="btn-primary" disabled={saveScale.isPending} onClick={() => saveScale.mutate()}>Save scale</button><button className="btn-quiet" onClick={() => setScale(null)}>Cancel</button></div>
          </div>
        )}
      </section>
      <section className="panel p-5">
        <h2 className="mb-1 font-semibold">Co-scholastic areas</h2>
        <p className="mb-3 text-sm text-ink-muted">Graded by the class teacher each term. Class teachers can also add areas for their own class.</p>
        <ul className="mb-3 divide-y divide-line">{s.coAreas.map((a) => (
          <li key={a.id} className="flex items-center gap-2 py-2"><span className="flex-1">{a.name}{a.classId && <span className="text-sm text-ink-muted"> · {s.classes.find((c) => c.id === a.classId)?.name} only</span>}</span>
            {edit && <button className="p-1 text-ink-muted hover:text-danger" aria-label={`Remove ${a.name}`} onClick={() => confirm(`Remove ${a.name}? Its grades are removed too.`) && delArea.mutate(a.id)}><Trash2 size={16} /></button>}</li>))}</ul>
        {edit && <form className="flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); if (area.trim().length >= 2) addArea.mutate(); }}><input className="field" value={area} onChange={(e) => setArea(e.target.value)} placeholder="New area for all classes" /><button className="btn-quiet"><Plus size={16} aria-hidden />Add</button></form>}
      </section>
      <section className="panel p-5">
        <h2 className="mb-1 font-semibold">Pre-primary skills</h2>
        <p className="mb-3 text-sm text-ink-muted">Rated Excellent / Good / Needs practice each term for Nursery, LKG and UKG.</p>
        <div className="space-y-2">{skills.map((k, i) => (
          <div key={k.id} className="grid grid-cols-[150px_1fr_auto] gap-2">
            <input className="field py-1.5 text-sm" disabled={!edit} aria-label="Group" value={k.group} onChange={(e) => setSkills(skills.map((x, j) => (j === i ? { ...x, group: e.target.value } : x)))} />
            <input className="field py-1.5 text-sm" disabled={!edit} aria-label="Skill" value={k.name} onChange={(e) => setSkills(skills.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            {edit && <button className="p-1 text-ink-muted hover:text-danger" aria-label="Remove skill" onClick={() => setSkills(skills.filter((_, j) => j !== i))}><Trash2 size={16} /></button>}
          </div>))}</div>
        {edit && <div className="mt-3 flex gap-2"><button className="btn-quiet" onClick={() => setSkills([...skills, { id: -Date.now(), group: skills[skills.length - 1]?.group ?? 'Language', name: '', classId: null }])}><Plus size={16} aria-hidden />Skill</button>
          <button className="btn-primary" disabled={saveSkills.isPending || skills.some((k) => !k.name.trim() || !k.group.trim())} onClick={() => saveSkills.mutate()}>Save skills</button></div>}
      </section>
    </div>
  );
}

export default function ExamsPage() {
  const { can } = useAuth();
  const s = useExamSetup();
  const corr = useQuery({ queryKey: ['corrections'], enabled: can('marks.approve'), queryFn: () => api<any[]>('/marks/corrections').then((r) => r.data) });
  const pendingCorr = (corr.data ?? []).filter((c) => c.canDecide).length;
  const tabs = [['exams', 'Exams & schedule'], ...(can('marks.approve') ? [['approvals', 'Approvals']] : []), ['results', 'Results'], ...(can('marks.approve') ? [['corrections', `Corrections${pendingCorr ? ` (${pendingCorr})` : ''}`]] : []), ['settings', 'Settings']] as Array<[string, string]>;
  const [tab, setTab] = useState('exams');
  if (s.isLoading) return <Skeleton rows={6} />;
  if (s.isError) return <ErrorState message={(s.error as Error).message} />;
  return (
    <div>
      <PageHeader title={`Exams · ${s.data!.year.name}`} description="Schedule, approvals, results and report cards. Teachers enter marks in Marks." />
      <div className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={clsx('-mb-px shrink-0 border-b-2 px-3.5 py-2.5 text-[15px] font-semibold', tab === k ? 'border-brand text-brand' : 'border-transparent text-ink-muted hover:text-ink')}>{l}</button>)}
      </div>
      {tab === 'exams' && <ExamsTab s={s.data!} />}
      {tab === 'approvals' && <ApprovalsTab s={s.data!} />}
      {tab === 'results' && <ResultsTab />}
      {tab === 'corrections' && (corr.isLoading ? <Skeleton rows={3} /> : !corr.data?.length ? <EmptyState title="No corrections" body="" /> : <CorrectionList rows={corr.data} onChange={() => corr.refetch()} />)}
      {tab === 'settings' && <SettingsTab s={s.data!} />}
    </div>
  );
}
