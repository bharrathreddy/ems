import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Phone, Search } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError, fieldErrors } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, EmptyState, ErrorState, Field, PageHeader, Sheet, Skeleton } from '../components/ui';

type Status = 'new' | 'contacted' | 'visit' | 'admitted' | 'closed';
interface Row { id: number; name: string; mobile: string | null; message: string; status: Status; seen: boolean; followUpOn: string | null; createdAt: string; updatedAt: string | null; updatedBy: string | null; notes: number }
interface List { counts: Record<Status, number>; unseen: number; rows: Row[] }
interface One { id: number; name: string; mobile: string | null; message: string; status: Status; followUpOn: string | null; createdAt: string; notes: Array<{ id: number; note: string; statusTo: Status | null; at: string; by: string | null }> }

export const STATUS_LABEL: Record<Status, string> = { new: 'New', contacted: 'Called back', visit: 'Visit booked', admitted: 'Admitted', closed: 'Closed' };
const TONE: Record<Status, 'attention' | 'brand' | 'neutral' | 'danger'> = { new: 'attention', contacted: 'neutral', visit: 'brand', admitted: 'brand', closed: 'neutral' };
const FILTERS: Array<[string, string]> = [['open', 'Open'], ['new', 'New'], ['contacted', 'Called back'], ['visit', 'Visit booked'], ['admitted', 'Admitted'], ['closed', 'Closed'], ['all', 'All']];
const when = (d: string) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export default function EnquiriesPage() {
  const [filter, setFilter] = useState('open');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  useEffect(() => { const t = setTimeout(() => setTerm(q), 300); return () => clearTimeout(t); }, [q]);
  const list = useQuery({ queryKey: ['enquiries', filter, term], queryFn: () => api<List>('/enquiries', { query: { status: filter === 'all' ? undefined : filter, q: term || undefined } }).then((r) => r.data) });
  const c = list.data?.counts;
  const count = (k: string) => !c ? null : k === 'open' ? c.new + c.contacted + c.visit : k === 'all' ? Object.values(c).reduce((a, b) => a + b, 0) : c[k as Status];
  const today = todayIST();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Admission enquiries" description="Every message sent from the website's contact page. Call back, book a visit, keep notes, and mark it admitted or closed." />
      <div className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label="Show">
        {FILTERS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
            className={clsx('shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold', filter === k ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink-muted hover:text-ink')}>
            {label}{count(k) !== null && <span className={clsx('ml-1.5', filter === k ? 'text-white/80' : 'text-ink-muted')}>{count(k)}</span>}
          </button>
        ))}
      </div>
      <label className="relative mb-4 block">
        <span className="sr-only">Search enquiries</span>
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />
        <input className="field pl-9" placeholder="Search by name, mobile or message" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {list.isLoading ? <Skeleton rows={4} /> : list.isError ? <ErrorState message={(list.error as Error).message} onRetry={() => list.refetch()} /> : !list.data!.rows.length ? (
        <EmptyState title={term ? 'No matching enquiries' : 'Nothing here'} body="When parents send a message from the website's contact page, it appears here and the school email gets a copy." />
      ) : (
        <ul className="space-y-2">
          {list.data!.rows.map((r) => (
            <li key={r.id}>
              <button onClick={() => setOpen(r.id)} className={clsx('panel block w-full p-4 text-left hover:border-brand/40', !r.seen && 'border-l-4 border-l-tangedu')}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="font-semibold">{r.name}{r.mobile && <span className="font-normal text-ink-muted"> · {r.mobile}</span>}</p>
                  <p className="text-xs text-ink-muted">{when(r.createdAt)}</p>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[15px] text-ink">{r.message}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  {!r.seen && <Badge tone="attention">Not opened</Badge>}
                  {r.followUpOn && ['new', 'contacted', 'visit'].includes(r.status) && (
                    <span className={clsx('font-medium', r.followUpOn <= today ? 'text-danger' : 'text-ink-muted')}>Follow up {r.followUpOn === today ? 'today' : day(r.followUpOn)}</span>
                  )}
                  {r.notes > 0 && <span className="text-ink-muted">{r.notes} note{r.notes === 1 ? '' : 's'}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open !== null && <EnquirySheet id={open} onClose={close} />}
    </div>
  );
}

function EnquirySheet({ id, onClose }: { id: number; onClose: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['enquiry', id], queryFn: () => api<One>(`/enquiries/${id}`).then((r) => r.data) });
  const [status, setStatus] = useState<Status>('new');
  const [follow, setFollow] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (q.data) { setStatus(q.data.status); setFollow(q.data.followUpOn ?? ''); } }, [q.data]);
  useEffect(() => { if (q.data) void qc.invalidateQueries({ queryKey: ['enquiries'] }); }, [q.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const manage = can('enquiries.manage');
  const changed = !!q.data && (status !== q.data.status || follow !== (q.data.followUpOn ?? '') || note.trim() !== '');
  const save = useMutation({
    mutationFn: () => api<One>(`/enquiries/${id}`, { method: 'PATCH', body: { ...(status !== q.data!.status ? { status } : {}), ...(follow !== (q.data!.followUpOn ?? '') ? { followUpOn: follow || null } : {}), ...(note.trim() ? { note: note.trim() } : {}) } }),
    onSuccess: ({ data }) => { qc.setQueryData(['enquiry', id], data); setNote(''); setErrors({}); toast.success('Saved'); void qc.invalidateQueries({ queryKey: ['enquiries'] }); },
    onError: (e) => { setErrors(fieldErrors(e)); if (!(e as ApiError).details) toast.error((e as ApiError).message); },
  });
  const d = q.data;
  const wa = d?.mobile ? `https://wa.me/91${d.mobile}?text=${encodeURIComponent(`Hello ${d.name}, thank you for your enquiry. `)}` : null;
  return (
    <Sheet open onClose={onClose} title={d?.name ?? 'Enquiry'} footer={manage && d ? (
      <button className="btn-primary w-full sm:w-auto" disabled={!changed || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</button>
    ) : undefined}>
      {q.isLoading ? <Skeleton rows={4} /> : q.isError ? <ErrorState message={(q.error as Error).message} /> : d && (
        <div className="space-y-5">
          <div>
            <p className="text-sm text-ink-muted">Sent {when(d.createdAt)}{d.mobile && <> · {d.mobile}</>}</p>
            <p className="mt-2 whitespace-pre-line rounded-lg bg-chalk p-3 text-[15px]">{d.message}</p>
            {d.mobile && (
              <div className="mt-3 flex flex-wrap gap-2">
                <a className="btn-quiet" href={`tel:${d.mobile}`}><Phone size={16} aria-hidden />Call</a>
                <a className="btn-quiet" href={wa!} target="_blank" rel="noreferrer"><MessageCircle size={16} aria-hidden />WhatsApp</a>
              </div>
            )}
          </div>
          {manage && (
            <div className="space-y-4">
              <fieldset>
                <legend className="label">Where it stands</legend>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                    <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}
                      className={clsx('rounded-lg border px-3 py-2 text-sm font-semibold', status === s ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-ink-muted')}>{STATUS_LABEL[s]}</button>
                  ))}
                </div>
              </fieldset>
              <Field label="Follow up on" hint="Optional. Shown in red on the list when it is due." error={errors.followUpOn}>
                <div className="flex gap-2"><input type="date" className="field max-w-48" value={follow} onChange={(e) => setFollow(e.target.value)} />{follow && <button type="button" className="btn-quiet" onClick={() => setFollow('')}>Clear</button>}</div>
              </Field>
              <Field label="Add a note" hint="e.g. Called, mother will visit on Saturday with the child." error={errors.note}>
                <textarea className="field min-h-20" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
          )}
          <div>
            <h3 className="mb-2 font-semibold">History</h3>
            {!d.notes.length ? <p className="text-sm text-ink-muted">No notes yet.</p> : (
              <ol className="space-y-2">
                {d.notes.map((n) => (
                  <li key={n.id} className="rounded-lg border border-line p-3 text-[15px]">
                    <p className="text-xs text-ink-muted">{when(n.at)}{n.by && <> · {n.by}</>}{n.statusTo && <> · moved to <strong className="text-ink">{STATUS_LABEL[n.statusTo]}</strong></>}</p>
                    {n.note && <p className="mt-1 whitespace-pre-line">{n.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
