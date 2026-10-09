import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, FileUp, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError, fieldErrors, postForm } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useClasses } from '../lib/academics';
import { resizeImage } from '../lib/images';
import { EmptyState, ErrorState, Field, MobileAction, PageHeader, Sheet, Skeleton } from '../components/ui';
import { HomeworkByDay, type HomeworkEntry } from '../components/HomeworkList';

interface Options { today: string; sections: Array<{ id: number; label: string; classTeacher: boolean; subjects: Array<{ id: number; name: string; mine: boolean }> }> }

export default function HomeworkPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const canPost = can('homework.post');
  const [section, setSection] = useState('');
  const [mine, setMine] = useState(false);
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState<HomeworkEntry | null>(null);
  const closePost = useCallback(() => setPosting(false), []);
  const closeEdit = useCallback(() => setEditing(null), []);
  const opts = useQuery({ queryKey: ['homework-options'], enabled: canPost, queryFn: () => api<Options>('/homework/options').then((r) => r.data) });
  const classes = useClasses(!canPost);
  const sections = canPost ? (opts.data?.sections ?? []).map((s) => ({ id: s.id, label: s.label }))
    : (classes.data ?? []).flatMap((c: any) => c.sections.map((s: any) => ({ id: s.id, label: `${c.name} ${s.name}` })));
  const list = useQuery({ queryKey: ['homework', section, mine], queryFn: () => api<{ today: string; rows: HomeworkEntry[] }>('/homework', { query: { sectionId: section || undefined, mine: mine ? '1' : undefined } }).then((r) => r.data) });
  const remove = useMutation({ mutationFn: (id: number) => api(`/homework/${id}`, { method: 'DELETE' }), onSuccess: () => { toast.success('Deleted'); void qc.invalidateQueries({ queryKey: ['homework'] }); }, onError: (e) => toast.error((e as ApiError).message) });
  const noSections = canPost && opts.data && !opts.data.sections.length;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Homework & diary" description="Homework and class diary notes for parents. Any teacher of a section can post; parents get an alert on their phone."
        action={canPost && !noSections ? <button className="btn-primary hidden sm:inline-flex" onClick={() => setPosting(true)}><Plus size={18} aria-hidden />Post</button> : undefined} />
      {noSections && <p className="mb-4 rounded-lg bg-tangedu-soft px-4 py-3 text-[15px]">You can post for sections where you are the class teacher or teach a subject. None are set for you this year yet; ask the office to set your classes in the Teaching grid.</p>}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="hw-section">Section</label>
        <select id="hw-section" className="field w-auto min-w-44" value={section} onChange={(e) => setSection(e.target.value)}>
          <option value="">All my sections</option>
          {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {canPost && <label className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[15px]"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />Posted by me</label>}
      </div>
      {list.isLoading ? <Skeleton rows={4} /> : list.isError ? <ErrorState message={(list.error as Error).message} onRetry={() => list.refetch()} /> : !list.data!.rows.length ? (
        <EmptyState title="Nothing in the last two weeks" body={canPost ? 'Post today’s homework or a diary note. Parents of the section see it in their app.' : 'Homework posted by teachers appears here.'}
          action={canPost && !noSections ? <button className="btn-primary" onClick={() => setPosting(true)}><Plus size={18} aria-hidden />Post homework</button> : undefined} />
      ) : (
        <HomeworkByDay rows={list.data!.rows} today={list.data!.today} showClass actions={(h) => h.canChange ? (<>
          <button className="btn-quiet min-h-9 text-sm" onClick={() => setEditing(h)}><Pencil size={14} aria-hidden />Edit</button>
          <button className="btn-quiet min-h-9 text-sm" disabled={remove.isPending} onClick={() => { if (confirm(`Delete "${h.title}"? Parents will no longer see it.`)) remove.mutate(h.id); }}><Trash2 size={14} aria-hidden />Delete</button>
        </>) : null} />
      )}
      {canPost && !noSections && <MobileAction><button className="btn-primary w-full" onClick={() => setPosting(true)}><Plus size={18} aria-hidden />Post homework</button></MobileAction>}
      {posting && opts.data && <HomeworkSheet options={opts.data} defaultSection={section ? Number(section) : undefined} onClose={closePost} />}
      {editing && opts.data && <HomeworkSheet options={opts.data} entry={editing} onClose={closeEdit} />}
    </div>
  );
}

function HomeworkSheet({ options, entry, defaultSection, onClose }: { options: Options; entry?: HomeworkEntry; defaultSection?: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    sectionId: entry?.sectionId ?? defaultSection ?? options.sections[0]?.id ?? 0, type: entry?.type ?? 'homework' as 'homework' | 'diary',
    subjectId: entry?.subjectId ? String(entry.subjectId) : '', title: entry?.title ?? '', details: entry?.details ?? '', forDate: entry?.forDate ?? options.today, dueDate: entry?.dueDate ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sec = options.sections.find((s) => s.id === f.sectionId);
  // Default the subject to the one this teacher teaches there (only for new posts).
  useEffect(() => { if (!entry) setF((v) => ({ ...v, subjectId: v.type === 'diary' ? '' : String(sec?.subjects.find((s) => s.mine)?.id ?? '') })); }, [f.sectionId, f.type]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!file || !file.type.startsWith('image/')) { setPreview(null); return; } const u = URL.createObjectURL(file); setPreview(u); return () => URL.revokeObjectURL(u); }, [file]);
  const tomorrow = useMemo(() => new Date(Date.parse(`${f.forDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10), [f.forDate]);
  const save = useMutation({
    mutationFn: async () => {
      const body = { subjectId: f.subjectId ? Number(f.subjectId) : null, type: f.type, title: f.title.trim(), details: f.details.trim() || null, forDate: f.forDate, dueDate: f.type === 'homework' && f.dueDate ? f.dueDate : null };
      if (entry) return api(`/homework/${entry.id}`, { method: 'PATCH', body });
      const att = file && file.type.startsWith('image/') ? await resizeImage(file, 1600) : file;
      return postForm('/homework', { sectionId: f.sectionId, ...body }, att);
    },
    onSuccess: () => { toast.success(entry ? 'Saved' : 'Posted. Parents of the section can see it now.'); void qc.invalidateQueries({ queryKey: ['homework'] }); onClose(); },
    onError: (e) => { setErrors(fieldErrors(e)); if (!(e as ApiError).details) toast.error((e as ApiError).message, { duration: 7000 }); },
  });
  const pickFile = (x?: File) => { if (!x) return; if (x.size > 15 * 1024 * 1024) { toast.error('This file is too large.'); return; } if (x.type === 'application/pdf' && x.size > 5 * 1024 * 1024) { toast.error('PDFs must be under 5 MB.'); return; } setFile(x); };
  return (
    <Sheet open onClose={onClose} title={entry ? 'Edit' : 'Post homework or diary'} footer={
      <button className="btn-primary w-full" disabled={save.isPending || f.title.trim().length < 2 || !f.sectionId} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : entry ? 'Save' : 'Post'}</button>
    }>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <fieldset>
          <legend className="label">What is it?</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {([['homework', 'Homework'], ['diary', 'Class diary']] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={f.type === k} onClick={() => setF({ ...f, type: k })}
                className={clsx('rounded-lg border px-3 py-2.5 text-[15px] font-semibold', f.type === k ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-ink-muted')}>{l}</button>
            ))}
          </div>
          <p className="mt-1.5 text-sm text-ink-muted">{f.type === 'homework' ? 'Work to do at home, with a due date.' : 'A note for parents: events, things to bring, reminders.'}</p>
        </fieldset>
        {!entry && (
          <Field label="Class and section" error={errors.sectionId}>
            <select className="field" value={f.sectionId} onChange={(e) => setF({ ...f, sectionId: Number(e.target.value) })}>
              {options.sections.map((s) => <option key={s.id} value={s.id}>{s.label}{s.classTeacher ? ' (class teacher)' : ''}</option>)}
            </select>
          </Field>
        )}
        <Field label="Subject" hint={f.type === 'diary' ? 'Optional for diary notes.' : undefined} error={errors.subjectId}>
          <select className="field" value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })}>
            <option value="">General (no subject)</option>
            {sec?.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}{s.mine ? ' (you teach)' : ''}</option>)}
          </select>
        </Field>
        <Field label={f.type === 'homework' ? 'Homework' : 'Note'} error={errors.title}>
          <input className="field" maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={f.type === 'homework' ? 'e.g. Page 42, sums 1 to 10' : 'e.g. Sports day on Friday, wear white'} />
        </Field>
        <Field label="More details" hint="Optional." error={errors.details}>
          <textarea className="field min-h-24" maxLength={5000} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Given on" error={errors.forDate}><input type="date" className="field" value={f.forDate} onChange={(e) => setF({ ...f, forDate: e.target.value })} /></Field>
          {f.type === 'homework' && <Field label="Due" error={errors.dueDate}><input type="date" className="field" min={f.forDate} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>}
        </div>
        {f.type === 'homework' && !f.dueDate && <button type="button" className="text-sm font-semibold text-brand" onClick={() => setF({ ...f, dueDate: tomorrow })}>Due the next day</button>}
        {!entry && (
          <div>
            <p className="label">Photo or PDF <span className="font-normal text-ink-muted">(optional)</span></p>
            {file ? (
              <div className="flex items-center gap-3 rounded-lg border border-line p-2">
                {preview ? <img src={preview} alt="" className="h-14 w-14 rounded object-cover" /> : <span className="grid h-14 w-14 place-items-center rounded bg-chalk text-xs font-semibold">PDF</span>}
                <p className="min-w-0 flex-1 truncate text-sm">{file.name}</p>
                <button type="button" className="rounded-md p-2 text-ink-muted hover:bg-chalk" aria-label="Remove attachment" onClick={() => setFile(null)}><X size={18} /></button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <label className="btn-quiet cursor-pointer"><Camera size={16} aria-hidden />Take photo<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
                <label className="btn-quiet cursor-pointer"><FileUp size={16} aria-hidden />Choose file<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
              </div>
            )}
            {errors.file && <p className="mt-1 text-sm text-danger">{errors.file}</p>}
          </div>
        )}
      </form>
    </Sheet>
  );
}
