import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, fieldErrors } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useClasses } from '../lib/academics';
import { Badge, EmptyState, ErrorState, Field, MobileAction, PageHeader, Sheet, Skeleton } from '../components/ui';

type Audience = { type: 'all' | 'staff' | 'families' } | { type: 'classes' | 'sections'; ids: number[] };
export interface Announcement { is_public?: number; id: number; title: string; body: string; audience: Audience; status: string; publish_at: string | null; expire_at: string | null; created_at: string; author: string; mine: boolean }

function audienceLabel(a: Audience, names: Map<number, string>) {
  if (a.type === 'all') return 'Everyone';
  if (a.type === 'staff') return 'Staff';
  if (a.type === 'families') return 'All parents';
  return 'ids' in a ? a.ids.map((id) => names.get(id) ?? `#${id}`).join(', ') : '';
}

function ComposeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const classes = useClasses(open);
  const canAll = me?.permissions['announcements.create'] === 'all' || me?.permissions['announcements.publish'] === 'all';
  const canPublish = can('announcements.publish');
  const [f, setF] = useState({ title: '', body: '', type: canAll ? 'all' : 'sections', ids: [] as number[], expireAt: '', isPublic: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (publish: boolean) => api<{ status: string; notified?: number }>('/announcements', { method: 'POST', body: {
      title: f.title, body: f.body, expireAt: f.expireAt || null, publish, isPublic: f.isPublic,
      audience: ['classes', 'sections'].includes(f.type) ? { type: f.type, ids: f.ids } : { type: f.type },
    } }),
    onSuccess: ({ data }) => {
      toast.success(data.status === 'published' ? `Published${data.notified !== undefined ? ` · ${data.notified} people notified` : ''}` : 'Saved as draft. A principal or admin will publish it.');
      qc.invalidateQueries({ queryKey: ['announcements'] }); setF({ ...f, title: '', body: '', ids: [] }); onClose();
    },
    onError: (e) => { const fe = fieldErrors(e); setErrors(Object.keys(fe).length ? fe : { form: (e as ApiError).message }); },
  });
  const toggle = (id: number) => setF({ ...f, ids: f.ids.includes(id) ? f.ids.filter((x) => x !== id) : [...f.ids, id] });
  const submit = (publish: boolean) => (e?: FormEvent) => { e?.preventDefault(); setErrors({}); m.mutate(publish); };
  return (
    <Sheet open={open} onClose={onClose} title="New notice"
      footer={<div className="flex gap-2">
        <button className="btn-quiet flex-1" disabled={m.isPending} onClick={() => submit(false)()}>Save draft</button>
        {canPublish && <button className="btn-primary flex-1" disabled={m.isPending} onClick={() => submit(true)()}>Publish now</button>}
      </div>}>
      <form className="space-y-4" onSubmit={submit(canPublish)}>
        <Field label="Title" error={errors.title}><input className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} /></Field>
        <Field label="Message" error={errors.body}><textarea className="field min-h-36" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={5000} /></Field>
        <Field label="Who should see it" error={errors.audience || errors['audience.ids']}>
          <select className="field" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, ids: [] })}>
            {canAll && <><option value="all">Everyone (staff and parents)</option><option value="staff">Staff only</option><option value="families">All parents</option><option value="classes">Parents of selected classes</option></>}
            <option value="sections">Parents of selected sections</option>
          </select>
        </Field>
        {f.type === 'classes' && (
          <div className="flex flex-wrap gap-2">{classes.data?.map((c) => (
            <button type="button" key={c.id} onClick={() => toggle(c.id)} aria-pressed={f.ids.includes(c.id)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${f.ids.includes(c.id) ? 'border-brand bg-brand-soft text-brand' : 'border-line'}`}>{c.name}</button>
          ))}</div>
        )}
        {f.type === 'sections' && (
          <div className="flex flex-wrap gap-2">{classes.data?.flatMap((c) => c.sections.map((s) => (
            <button type="button" key={s.id} onClick={() => toggle(s.id)} aria-pressed={f.ids.includes(s.id)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${f.ids.includes(s.id) ? 'border-brand bg-brand-soft text-brand' : 'border-line'}`}>{c.name} {s.name}</button>
          )))}</div>
        )}
        {canAll && <label className="flex items-start gap-3 rounded-lg border border-line p-3"><input type="checkbox" className="mt-1 h-4 w-4" checked={f.isPublic} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} />
          <span><span className="font-semibold">Also show on the school website</span><span className="block text-sm text-ink-muted">Anyone can read it there. Don't use for private information.</span></span></label>}
        <Field label="Hide after (optional)"><input type="date" className="field" value={f.expireAt} onChange={(e) => setF({ ...f, expireAt: e.target.value })} /></Field>
        {errors.form && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger" role="alert">{errors.form}</p>}
      </form>
    </Sheet>
  );
}

export function AnnouncementCard({ a, names, actions }: { a: Announcement; names: Map<number, string>; actions?: React.ReactNode }) {
  return (
    <article id={String(a.id)} className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg font-semibold">{a.title}</h3>
        <span className="flex gap-1">{a.is_public === 1 && <Badge tone="brand">On website</Badge>}{a.status !== 'published' && <Badge tone={a.status === 'draft' ? 'attention' : 'neutral'}>{a.status === 'draft' ? 'Draft' : 'Archived'}</Badge>}</span>
      </div>
      <p className="mt-0.5 text-sm text-ink-muted">{a.author} · {new Date(a.publish_at ?? a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{names.size > 0 && ` · ${audienceLabel(a.audience, names)}`}</p>
      <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed">{a.body}</p>
      {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
    </article>
  );
}

export default function AnnouncementsPage() {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const manage = me?.workspace === 'staff' && (can('announcements.create') || can('announcements.publish'));
  const [open, setOpen] = useState(false);
  const classes = useClasses(me?.workspace === 'staff');
  const names = new Map<number, string>();
  classes.data?.forEach((c) => { names.set(c.id, c.name); c.sections.forEach((s) => names.set(s.id, `${c.name} ${s.name}`)); });
  const q = useQuery({ queryKey: ['announcements', manage], queryFn: () => api<Announcement[]>('/announcements', { query: { drafts: manage ? 1 : undefined } }).then((r) => r.data) });
  const act = useMutation({
    mutationFn: (v: { id: number; op: 'publish' | 'archive' }) => api<{ notified?: number }>(`/announcements/${v.id}/${v.op}`, { method: 'POST' }),
    onSuccess: ({ data }, v) => { toast.success(v.op === 'publish' ? `Published · ${data.notified ?? 0} people notified` : 'Archived'); qc.invalidateQueries({ queryKey: ['announcements'] }); },
    onError: (e) => toast.error((e as ApiError).message),
  });
  const newButton = manage && <button className="btn-primary w-full sm:w-auto" onClick={() => setOpen(true)}><Plus size={18} aria-hidden />New notice</button>;
  const items = (q.data ?? []).filter((a) => a.status !== 'archived');
  return (
    <div className="max-w-3xl">
      <PageHeader title="Notices" description={manage ? 'Send notices to staff, all parents, or parents of chosen classes and sections. Each person also gets an alert.' : undefined} action={newButton} />
      {q.isLoading ? <Skeleton rows={3} /> : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
        : items.length === 0 ? <EmptyState title="No notices yet" body={manage ? 'Notices you publish appear here and in everyone\'s alerts.' : 'Notices from the school will appear here.'} action={newButton || undefined} /> : (
        <div className="space-y-3">
          {items.map((a) => (
            <AnnouncementCard key={a.id} a={a} names={names} actions={manage && (
              <>
                {a.status === 'draft' && can('announcements.publish') && <button className="btn-primary min-h-9 text-sm" onClick={() => act.mutate({ id: a.id, op: 'publish' })}><Megaphone size={16} aria-hidden />Publish</button>}
                {(a.mine || can('announcements.publish')) && <button className="btn-quiet min-h-9 text-sm" onClick={() => confirm('Archive this notice? It will be hidden from everyone.') && act.mutate({ id: a.id, op: 'archive' })}>Archive</button>}
              </>
            )} />
          ))}
        </div>
      )}
      {newButton && <MobileAction>{newButton}</MobileAction>}
      <ComposeSheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
