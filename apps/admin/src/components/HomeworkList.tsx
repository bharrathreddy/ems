import { useQuery } from '@tanstack/react-query';
import { BookOpenCheck, NotebookPen, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, authHeadersPublic, refreshAccessTokenPublic } from '../lib/api';
import { EmptyState, ErrorState, Skeleton } from './ui';
import type { ReactNode } from 'react';

export interface HomeworkEntry {
  id: number; sectionId: number; className: string; subjectId: number | null; subject: string | null; type: 'homework' | 'diary'; title: string; details: string | null;
  forDate: string; dueDate: string | null; postedBy: string; createdAt: string; updatedAt: string; file: { name: string; mime: string; size: number } | null; canChange: boolean;
}

export const dayLabel = (d: string, today: string) => {
  if (d === today) return 'Today';
  const y = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (d === y) return 'Yesterday';
  const t = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  if (d === t) return 'Tomorrow';
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
};

export const dueLabel = (d: string, today: string) => { const l = dayLabel(d, today); return ['Today', 'Tomorrow', 'Yesterday'].includes(l) ? l.toLowerCase() : l; };

/** Opens the attachment in a new tab (fetched with the login token; files are never public). */
export async function openAttachment(id: number, retried = false): Promise<void> {
  const w = window.open('', '_blank');
  try {
    let res = await fetch(`/api/v1/homework/${id}/file`, { headers: authHeadersPublic(), credentials: 'include' });
    if (res.status === 401 && !retried && (await refreshAccessTokenPublic())) res = await fetch(`/api/v1/homework/${id}/file`, { headers: authHeadersPublic(), credentials: 'include' });
    if (!res.ok) throw new Error('Could not open the attachment.');
    const url = URL.createObjectURL(await res.blob());
    if (w) w.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) { w?.close(); toast.error((e as Error).message); }
}

export function HomeworkCard({ h, today, showClass, actions }: { h: HomeworkEntry; today: string; showClass?: boolean; actions?: ReactNode }) {
  const overdue = h.type === 'homework' && h.dueDate && h.dueDate < today;
  return (
    <article className="panel p-4">
      <div className="flex items-start gap-3">
        <span className={clsx('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg', h.type === 'homework' ? 'bg-brand-soft text-brand' : 'bg-tangedu-soft text-[#7A5A00]')} aria-hidden>
          {h.type === 'homework' ? <BookOpenCheck size={18} /> : <NotebookPen size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-muted">
            {h.type === 'homework' ? 'Homework' : 'Class diary'}{h.subject && <> · {h.subject}</>}{showClass && <> · {h.className}</>}
          </p>
          <h3 className="mt-0.5 text-[17px] font-semibold leading-snug">{h.title}</h3>
          {h.details && <p className="mt-1.5 whitespace-pre-line text-[15px]">{h.details}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
            {h.dueDate && <span className={clsx('font-semibold', overdue ? 'text-ink-muted' : h.dueDate <= today ? 'text-danger' : 'text-ink')}>Due {dueLabel(h.dueDate, today)}</span>}
            <span>{h.postedBy}</span>
          </div>
          {(h.file || actions) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {h.file && <button type="button" className="btn-quiet min-h-9 text-sm" onClick={() => void openAttachment(h.id)}><Paperclip size={14} aria-hidden />{h.file.mime === 'application/pdf' ? 'Open PDF' : 'See photo'}</button>}
              {actions}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/** Groups entries by the day they were given, newest first. */
export function HomeworkByDay({ rows, today, showClass, actions }: { rows: HomeworkEntry[]; today: string; showClass?: boolean; actions?: (h: HomeworkEntry) => ReactNode }) {
  const days = [...new Set(rows.map((r) => r.forDate))];
  return (
    <div className="space-y-5">
      {days.map((d) => (
        <section key={d}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">{dayLabel(d, today)}</h2>
          <div className="space-y-2">{rows.filter((r) => r.forDate === d).map((h) => <HomeworkCard key={h.id} h={h} today={today} showClass={showClass} actions={actions?.(h)} />)}</div>
        </section>
      ))}
    </div>
  );
}

/** The Homework tab on a student's page (parents, students and staff). */
export function StudentHomework({ studentId }: { studentId: string }) {
  const q = useQuery({ queryKey: ['homework', 'student', studentId], queryFn: () => api<{ today: string; rows: HomeworkEntry[] }>(`/students/${studentId}/homework`).then((r) => r.data) });
  if (q.isLoading) return <Skeleton rows={3} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  const { rows, today } = q.data!;
  if (!rows.length) return <EmptyState title="No homework yet" body="Homework and class diary notes from the teachers appear here, from the last 30 days." />;
  const due = rows.filter((r) => r.type === 'homework' && r.dueDate && r.dueDate >= today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  return (
    <div className="space-y-6">
      {due.length > 0 && (
        <section className="rounded-xl border border-brand/30 bg-brand-soft/50 p-4">
          <h2 className="font-semibold">Still to do ({due.length})</h2>
          <ul className="mt-2 space-y-1 text-[15px]">
            {due.map((h) => <li key={h.id}><span className="font-semibold">{h.subject ?? 'General'}:</span> {h.title} <span className="text-ink-muted">· due {dueLabel(h.dueDate!, today)}</span></li>)}
          </ul>
        </section>
      )}
      <HomeworkByDay rows={rows} today={today} />
    </div>
  );
}
