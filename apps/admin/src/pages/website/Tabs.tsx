import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ExternalLink, ImagePlus, MessageCircle, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, ApiError, fieldErrors } from '../../lib/api';
import { fileUrl, uploadImage } from '../../lib/images';
import { Markdown } from '../../lib/markdown';
import { Badge, EmptyState, Field, Sheet, Skeleton, Toggle } from '../../components/ui';
import ImageField from '../../components/ImageField';

const err = (e: unknown) => toast.error((e as ApiError).details?.[0]?.message ?? (e as ApiError).message);
const viewHref = (slug: string) => (slug === 'home' ? '/' : ['about', 'contact', 'privacy'].includes(slug) ? `/${slug}` : `/p/${slug}`);
const FORMAT_HELP = '# Heading · ## Subheading · **bold** · *italic* · - list item · [link text](https://...) · blank line = new paragraph';

// ---------------- Pages ----------------
interface Page { id: number; slug: string; kind: string; title: string; body: string | null; seo_title: string | null; seo_description: string | null; is_published: number }

function PageEditor({ page, onClose }: { page: Page | 'new'; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = page === 'new';
  const [f, setF] = useState({ title: isNew ? '' : page.title, body: isNew ? '' : page.body ?? '', seoTitle: isNew ? '' : page.seo_title ?? '', seoDescription: isNew ? '' : page.seo_description ?? '' });
  const [preview, setPreview] = useState(false);
  const save = useMutation({
    mutationFn: () => isNew ? api('/cms/pages', { method: 'POST', body: f }) : api(`/cms/pages/${page.id}`, { method: 'PATCH', body: f }),
    onSuccess: () => { toast.success('Page saved'); qc.invalidateQueries({ queryKey: ['cms-pages'] }); onClose(); }, onError: err,
  });
  const contentless = !isNew && ['home', 'contact'].includes(page.kind);
  return (
    <Sheet open onClose={onClose} title={isNew ? 'New page' : `Edit ${page.title}`} footer={<button className="btn-primary w-full" disabled={save.isPending || f.title.trim().length < 2} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save page'}</button>}>
      <div className="space-y-4">
        <Field label="Title"><input className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        {contentless ? <p className="rounded-lg bg-chalk px-3 py-2.5 text-sm text-ink-muted">{page.kind === 'home' ? 'The home page is built from sections (Home page tab).' : 'The contact page shows the form, address and map (Contact & social tab).'} Here you can set its title for search engines.</p> : (
          <div>
            <div className="mb-1.5 flex items-center justify-between"><span className="label mb-0">Text</span>
              <div className="inline-flex rounded-md border border-line text-xs font-semibold">{['Write', 'Preview'].map((t, i) => <button key={t} type="button" onClick={() => setPreview(i === 1)} className={clsx('px-2.5 py-1', preview === (i === 1) && 'bg-brand-soft text-brand')}>{t}</button>)}</div></div>
            {preview ? <div className="min-h-64 rounded-lg border border-line p-4"><Markdown text={f.body} /></div>
              : <textarea className="field min-h-64 font-mono text-sm" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}
            <p className="mt-1.5 text-xs text-ink-muted">{FORMAT_HELP}</p>
          </div>
        )}
        <details className="rounded-lg border border-line p-3"><summary className="cursor-pointer text-sm font-semibold">Search engines (optional)</summary>
          <div className="mt-3 space-y-3">
            <Field label="Title in Google" hint="Leave empty to use the page title."><input className="field" value={f.seoTitle} onChange={(e) => setF({ ...f, seoTitle: e.target.value })} maxLength={150} /></Field>
            <Field label="Description in Google" hint="One or two sentences, up to 160 characters."><textarea className="field" value={f.seoDescription} onChange={(e) => setF({ ...f, seoDescription: e.target.value })} maxLength={300} /></Field>
          </div></details>
      </div>
    </Sheet>
  );
}

export function PagesTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cms-pages'], queryFn: () => api<Page[]>('/cms/pages').then((r) => r.data) });
  const [edit, setEdit] = useState<Page | 'new' | null>(null);
  const pub = useMutation({ mutationFn: (v: { id: number; on: boolean }) => api(`/cms/pages/${v.id}`, { method: 'PATCH', body: { isPublished: v.on } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['cms-pages'] }), onError: err });
  const del = useMutation({ mutationFn: (id: number) => api(`/cms/pages/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['cms-pages'] }), onError: err });
  if (q.isLoading) return <Skeleton rows={4} />;
  return (
    <>
      <ul className="panel divide-y divide-line">
        {q.data!.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1"><p className="font-semibold">{p.title} {p.kind !== 'custom' && <Badge>Built-in</Badge>}</p><p className="text-sm text-ink-muted">{viewHref(p.slug)}</p></div>
            <a href={viewHref(p.slug)} target="_blank" rel="noreferrer" className="p-2 text-ink-muted hover:text-brand" aria-label={`View ${p.title}`}><ExternalLink size={16} /></a>
            <button className="btn-quiet min-h-9 px-3 text-sm" onClick={() => setEdit(p)}><Pencil size={14} aria-hidden />Edit</button>
            {p.kind !== 'home' && <Toggle checked={p.is_published === 1} label={`Publish ${p.title}`} onChange={(on) => pub.mutate({ id: p.id, on })} />}
            {p.kind === 'custom' && <button aria-label={`Delete ${p.title}`} className="p-2 text-ink-muted hover:text-danger" onClick={() => confirm(`Delete the page "${p.title}"? Menu links to it are removed too.`) && del.mutate(p.id)}><Trash2 size={16} /></button>}
          </li>
        ))}
      </ul>
      <button className="btn-quiet mt-3" onClick={() => setEdit('new')}><Plus size={16} aria-hidden />New page</button>
      {edit && <PageEditor page={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

// ---------------- Menus ----------------
interface MenuItem { label: string; linkType: 'page' | 'builtin' | 'url'; target: string; isVisible: boolean; newTab: boolean }
const BUILTIN_LABEL: Record<string, string> = { home: 'Home', events: 'Events', gallery: 'Gallery', videos: 'Videos', contact: 'Contact' };

function MenuEditor({ location, rows, pages }: { location: 'header' | 'footer'; rows: any[]; pages: Page[] }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<MenuItem[]>([]);
  useEffect(() => setItems(rows.map((r) => ({ label: r.label, linkType: r.link_type, target: r.target, isVisible: r.is_visible === 1, newTab: r.new_tab === 1 }))), [rows]);
  const save = useMutation({ mutationFn: () => api(`/cms/menus/${location}`, { method: 'PUT', body: { items } }), onSuccess: () => { toast.success('Menu saved'); qc.invalidateQueries({ queryKey: ['cms-menus'] }); }, onError: err });
  const upd = (i: number, p: Partial<MenuItem>) => setItems(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => { const a = [...items]; [a[i], a[i + d]] = [a[i + d], a[i]]; setItems(a); };
  const encode = (it: MenuItem) => (it.linkType === 'url' ? 'url:' : `${it.linkType}:${it.target}`);
  return (
    <section className="panel p-4">
      <h3 className="mb-3 font-semibold">{location === 'header' ? 'Top menu' : 'Footer menu'}</h3>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className={clsx('grid grid-cols-[auto_1fr_1fr_auto_auto] items-center gap-2', !it.isVisible && 'opacity-60')}>
            <div className="flex flex-col text-ink-muted"><button aria-label="Up" disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30"><ArrowUp size={14} /></button><button aria-label="Down" disabled={i === items.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30"><ArrowDown size={14} /></button></div>
            <input className="field py-1.5 text-sm" aria-label="Label" value={it.label} onChange={(e) => upd(i, { label: e.target.value })} />
            {it.linkType === 'url' ? <input className="field py-1.5 text-sm" aria-label="Link" placeholder="https://" value={it.target} onChange={(e) => upd(i, { target: e.target.value })} />
              : <select className="field py-1.5 text-sm" aria-label="Goes to" value={encode(it)} onChange={(e) => { const [t, ...rest] = e.target.value.split(':'); upd(i, { linkType: t as any, target: t === 'url' ? 'https://' : rest.join(':'), newTab: t === 'url' }); }}>
                  <optgroup label="Sections">{Object.entries(BUILTIN_LABEL).map(([k, v]) => <option key={k} value={`builtin:${k}`}>{v}</option>)}</optgroup>
                  <optgroup label="Pages">{pages.filter((p) => p.kind !== 'home' && p.kind !== 'contact').map((p) => <option key={p.slug} value={`page:${p.slug}`}>{p.title}</option>)}</optgroup>
                  <option value="url:">Other website…</option>
                </select>}
            <Toggle checked={it.isVisible} label={`Show ${it.label}`} onChange={(v) => upd(i, { isVisible: v })} />
            <button aria-label="Remove" className="p-1 text-ink-muted hover:text-danger" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button className="btn-quiet min-h-9 text-sm" onClick={() => setItems([...items, { label: 'New link', linkType: 'builtin', target: 'home', isVisible: true, newTab: false }])}><Plus size={14} aria-hidden />Add link</button>
        <button className="btn-primary ml-auto min-h-9 text-sm" disabled={save.isPending} onClick={() => save.mutate()}>Save menu</button>
      </div>
    </section>
  );
}

export function MenusTab() {
  const q = useQuery({ queryKey: ['cms-menus'], queryFn: () => api<{ header: any[]; footer: any[] }>('/cms/menus').then((r) => r.data) });
  const pages = useQuery({ queryKey: ['cms-pages'], queryFn: () => api<Page[]>('/cms/pages').then((r) => r.data) });
  if (q.isLoading || pages.isLoading) return <Skeleton rows={4} />;
  return <div className="space-y-4"><MenuEditor location="header" rows={q.data!.header} pages={pages.data!} /><MenuEditor location="footer" rows={q.data!.footer} pages={pages.data!} /><p className="text-sm text-ink-muted">The Login button is always shown.</p></div>;
}

// ---------------- Events ----------------
interface Ev { id: number; slug: string; title: string; event_date: string; end_date: string | null; location: string | null; description: string | null; is_published: number; cover: string | null }
const iso = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function EventEditor({ ev, onClose }: { ev: Ev | 'new'; onClose: () => void }) {
  const qc = useQueryClient();
  const n = ev === 'new';
  const [f, setF] = useState({ title: n ? '' : ev.title, eventDate: n ? '' : iso(ev.event_date), endDate: n ? '' : iso(ev.end_date), location: n ? '' : ev.location ?? '', description: n ? '' : ev.description ?? '', coverId: n ? null : ev.cover, isPublished: n ? true : ev.is_published === 1 });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => { const body = { ...f, endDate: f.endDate || null }; return n ? api('/cms/events', { method: 'POST', body }) : api(`/cms/events/${ev.id}`, { method: 'PATCH', body }); },
    onSuccess: () => { toast.success('Event saved'); qc.invalidateQueries({ queryKey: ['cms-events'] }); onClose(); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(fe); if (!Object.keys(fe).length) err(e); },
  });
  return (
    <Sheet open onClose={onClose} title={n ? 'New event' : 'Edit event'} footer={<button className="btn-primary w-full" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save event'}</button>}>
      <div className="space-y-4">
        <Field label="Event name" error={errors.title}><input className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Date" error={errors.eventDate}><input type="date" className="field" value={f.eventDate} onChange={(e) => setF({ ...f, eventDate: e.target.value })} /></Field>
          <Field label="Ends (optional)" error={errors.endDate}><input type="date" className="field" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field></div>
        <Field label="Place"><input className="field" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <ImageField label="Cover photo" value={f.coverId} onChange={(coverId) => setF({ ...f, coverId })} />
        <Field label="Description" hint={FORMAT_HELP}><textarea className="field min-h-40" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <label className="flex items-center gap-3"><Toggle checked={f.isPublished} label="Show on website" onChange={(v) => setF({ ...f, isPublished: v })} /><span>Show on website</span></label>
      </div>
    </Sheet>
  );
}

export function EventsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cms-events'], queryFn: () => api<Ev[]>('/cms/events').then((r) => r.data) });
  const [edit, setEdit] = useState<Ev | 'new' | null>(null);
  const del = useMutation({ mutationFn: (id: number) => api(`/cms/events/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['cms-events'] }), onError: err });
  if (q.isLoading) return <Skeleton rows={4} />;
  return (
    <>
      <button className="btn-primary mb-3" onClick={() => setEdit('new')}><Plus size={16} aria-hidden />New event</button>
      {!q.data!.length ? <EmptyState title="No events yet" body="Add sports day, annual day, exhibitions and more. Link photo albums and videos to them." /> : (
        <ul className="panel divide-y divide-line">{q.data!.map((e) => (
          <li key={e.id} className="flex items-center gap-3 px-4 py-3">
            {e.cover ? <img src={fileUrl(e.cover)} alt="" className="h-12 w-16 rounded-md object-cover" /> : <div className="h-12 w-16 rounded-md bg-chalk" />}
            <div className="min-w-0 flex-1"><p className="font-semibold">{e.title} {!e.is_published && <Badge>Hidden</Badge>}</p><p className="text-sm text-ink-muted">{new Date(e.event_date).toLocaleDateString('en-IN', { dateStyle: 'medium' })}{e.location ? ` · ${e.location}` : ''}</p></div>
            <a href={`/events/${e.slug}`} target="_blank" rel="noreferrer" className="p-2 text-ink-muted hover:text-brand" aria-label="View"><ExternalLink size={16} /></a>
            <button className="btn-quiet min-h-9 px-3 text-sm" onClick={() => setEdit(e)}><Pencil size={14} aria-hidden />Edit</button>
            <button aria-label={`Delete ${e.title}`} className="p-2 text-ink-muted hover:text-danger" onClick={() => confirm(`Delete "${e.title}"? Its albums and videos stay, unlinked.`) && del.mutate(e.id)}><Trash2 size={16} /></button>
          </li>))}</ul>
      )}
      {edit && <EventEditor ev={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

// ---------------- Gallery ----------------
function AlbumSheet({ id, events, onClose }: { id: number; events: Ev[]; onClose: () => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['cms-album', id], queryFn: () => api<any>(`/cms/albums/${id}`).then((r) => r.data) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['cms-album', id] }); qc.invalidateQueries({ queryKey: ['cms-albums'] }); };
  const patch = useMutation({ mutationFn: (b: object) => api(`/cms/albums/${id}`, { method: 'PATCH', body: b }), onSuccess: refresh, onError: err });
  const delPhoto = useMutation({ mutationFn: (pid: number) => api(`/cms/photos/${pid}`, { method: 'DELETE' }), onSuccess: refresh });
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    for (const [i, f] of list.entries()) {
      setProgress(`Uploading ${i + 1} of ${list.length}…`);
      try { await uploadImage(`/cms/albums/${id}/photos`, f); } catch (e) { toast.error(`${f.name}: ${(e as Error).message}`); }
    }
    setProgress(null); refresh(); if (input.current) input.current.value = '';
    toast.success(`${list.length} photo${list.length > 1 ? 's' : ''} added`);
  };
  if (!q.data) return <Sheet open onClose={onClose} title="Album"><Skeleton rows={3} /></Sheet>;
  const a = q.data;
  return (
    <Sheet open onClose={onClose} title={a.title}>
      <div className="space-y-4">
        <Field label="Linked event"><select className="field" value={a.eventSlug ?? ''} onChange={(e) => patch.mutate({ eventSlug: e.target.value || null })}>
          <option value="">No event</option>{events.map((e) => <option key={e.slug} value={e.slug}>{e.title}</option>)}</select></Field>
        <label className="flex items-center gap-3"><Toggle checked={a.is_published === 1} label="Show on website" onChange={(v) => patch.mutate({ isPublished: v })} /><span>Show on website</span></label>
        <button className="btn-primary w-full" disabled={!!progress} onClick={() => input.current?.click()}><ImagePlus size={18} aria-hidden />{progress ?? 'Add photos'}</button>
        <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => upload(e.target.files)} />
        <p className="text-xs text-ink-muted">Choose many photos at once. They are resized on this device before upload.</p>
        <div className="grid grid-cols-3 gap-2">
          {a.photos.map((p: any) => (
            <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg bg-chalk">
              <img src={fileUrl(p.image)} alt="" className="h-full w-full object-cover" />
              {a.cover === p.image && <span className="absolute left-1 top-1 rounded bg-brand px-1.5 text-[10px] font-bold text-white">COVER</span>}
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 p-1">
                <button className="text-[11px] font-semibold text-white" onClick={() => patch.mutate({ coverId: p.image })}>Cover</button>
                <button aria-label="Delete photo" className="text-white" onClick={() => confirm('Delete this photo?') && delPhoto.mutate(p.id)}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

export function GalleryTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cms-albums'], queryFn: () => api<any[]>('/cms/albums').then((r) => r.data) });
  const events = useQuery({ queryKey: ['cms-events'], queryFn: () => api<Ev[]>('/cms/events').then((r) => r.data) });
  const [title, setTitle] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const create = useMutation({ mutationFn: () => api<{ id: number }>('/cms/albums', { method: 'POST', body: { title } }), onSuccess: ({ data }) => { setTitle(''); qc.invalidateQueries({ queryKey: ['cms-albums'] }); setOpen(data.id); }, onError: err });
  const del = useMutation({ mutationFn: (id: number) => api(`/cms/albums/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['cms-albums'] }) });
  if (q.isLoading) return <Skeleton rows={4} />;
  return (
    <>
      <form className="mb-4 flex max-w-lg gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim().length >= 2) create.mutate(); }}>
        <input className="field" placeholder="New album, e.g. Annual Day 2026" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="New album name" />
        <button className="btn-primary" disabled={title.trim().length < 2}><Plus size={16} aria-hidden />Create</button>
      </form>
      {!q.data!.length ? <EmptyState title="No albums yet" body="Create an album, then add photos to it." /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {q.data!.map((a) => (
            <div key={a.id} className="panel overflow-hidden">
              <button className="block w-full text-left" onClick={() => setOpen(a.id)}>
                <div className="aspect-[4/3] bg-chalk">{a.cover && <img src={fileUrl(a.cover)} alt="" className="h-full w-full object-cover" />}</div>
                <div className="p-3"><p className="truncate font-semibold">{a.title}</p><p className="text-sm text-ink-muted">{Number(a.photos)} photos{a.event ? ` · ${a.event}` : ''}{!a.is_published ? ' · hidden' : ''}</p></div>
              </button>
              <button className="w-full border-t border-line py-2 text-xs font-semibold text-danger" onClick={() => confirm(`Delete album "${a.title}" and its photos?`) && del.mutate(a.id)}>Delete album</button>
            </div>
          ))}
        </div>
      )}
      {open && <AlbumSheet id={open} events={events.data ?? []} onClose={() => setOpen(null)} />}
    </>
  );
}

// ---------------- Videos ----------------
export function VideosTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cms-videos'], queryFn: () => api<any[]>('/cms/videos').then((r) => r.data) });
  const events = useQuery({ queryKey: ['cms-events'], queryFn: () => api<Ev[]>('/cms/events').then((r) => r.data) });
  const [f, setF] = useState({ url: '', title: '', eventSlug: '' });
  const add = useMutation({ mutationFn: () => api('/cms/videos', { method: 'POST', body: { ...f, eventSlug: f.eventSlug || null } }), onSuccess: () => { toast.success('Video added'); setF({ url: '', title: '', eventSlug: '' }); qc.invalidateQueries({ queryKey: ['cms-videos'] }); }, onError: err });
  const del = useMutation({ mutationFn: (id: number) => api(`/cms/videos/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['cms-videos'] }) });
  return (
    <>
      <div className="panel mb-4 grid gap-3 p-4 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-end">
        <Field label="YouTube link"><input className="field" placeholder="https://youtu.be/..." value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
        <Field label="Title"><input className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Event (optional)"><select className="field" value={f.eventSlug} onChange={(e) => setF({ ...f, eventSlug: e.target.value })}><option value="">None</option>{events.data?.map((e) => <option key={e.slug} value={e.slug}>{e.title}</option>)}</select></Field>
        <button className="btn-primary" disabled={add.isPending || !f.url || f.title.trim().length < 2} onClick={() => add.mutate()}>Add</button>
      </div>
      {q.isLoading ? <Skeleton rows={3} /> : !q.data!.length ? <EmptyState title="No videos yet" body="Upload videos to the school's YouTube channel, then paste their links here." /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{q.data!.map((v) => (
          <div key={v.id} className="panel overflow-hidden">
            <img src={`https://i.ytimg.com/vi/${v.youtube_id}/mqdefault.jpg`} alt="" className="aspect-video w-full object-cover" />
            <div className="flex items-start gap-2 p-3"><div className="min-w-0 flex-1"><p className="font-semibold">{v.title}</p>{v.event && <p className="text-sm text-ink-muted">{v.event}</p>}</div>
              <button aria-label={`Delete ${v.title}`} className="p-1 text-ink-muted hover:text-danger" onClick={() => confirm('Remove this video from the website?') && del.mutate(v.id)}><Trash2 size={16} /></button></div>
          </div>))}</div>
      )}
    </>
  );
}

// ---------------- Messages ----------------
export function MessagesTab() {
  const qc = useQueryClient();
  const [archived, setArchived] = useState(false);
  const q = useQuery({ queryKey: ['cms-messages', archived], queryFn: () => api<any[]>('/cms/messages', { query: { status: archived ? 'archived' : undefined } }).then((r) => r.data) });
  const set = useMutation({ mutationFn: (v: { id: number; status: string }) => api(`/cms/messages/${v.id}`, { method: 'PATCH', body: { status: v.status } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['cms-messages'] }) });
  return (
    <>
      <div className="mb-3 inline-flex rounded-lg border border-line bg-chalk p-0.5">{['Inbox', 'Archived'].map((t, i) => <button key={t} aria-pressed={archived === (i === 1)} onClick={() => setArchived(i === 1)} className={clsx('rounded-md px-4 py-1.5 text-sm font-semibold', archived === (i === 1) ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted')}>{t}</button>)}</div>
      {q.isLoading ? <Skeleton rows={3} /> : !q.data!.length ? <EmptyState title="No messages" body="Messages sent from the website's contact page appear here and are emailed to the school." /> : (
        <ul className="space-y-2">{q.data!.map((m) => (
          <li key={m.id} className={clsx('panel p-4', m.status === 'new' && 'border-l-4 border-l-tangedu')} onClick={() => m.status === 'new' && set.mutate({ id: m.id, status: 'read' })}>
            <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="font-semibold">{m.name}{m.mobile && <span className="font-normal text-ink-muted"> · {m.mobile}</span>}</p>
              <p className="text-xs text-ink-muted">{new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p></div>
            <p className="mt-2 whitespace-pre-line">{m.message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {m.mobile && <a className="btn-quiet min-h-9 text-sm" href={`https://wa.me/91${m.mobile}`} target="_blank" rel="noreferrer"><MessageCircle size={14} aria-hidden />WhatsApp</a>}
              {m.mobile && <a className="btn-quiet min-h-9 text-sm" href={`tel:${m.mobile}`}><Phone size={14} aria-hidden />Call</a>}
              <button className="btn-quiet min-h-9 text-sm" onClick={(e) => { e.stopPropagation(); set.mutate({ id: m.id, status: archived ? 'read' : 'archived' }); }}>{archived ? 'Move to inbox' : 'Archive'}</button>
            </div>
          </li>))}</ul>
      )}
    </>
  );
}

// ---------------- Contact & social ----------------
export function ContactTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cms-settings'], queryFn: () => api<any>('/cms/settings').then((r) => r.data) });
  const [c, setC] = useState({ mapEmbedUrl: '', officeHours: '' });
  const [s, setS] = useState({ facebook: '', instagram: '', youtube: '', x: '' });
  useEffect(() => { if (q.data) { setC({ mapEmbedUrl: q.data.contact.mapEmbedUrl ?? '', officeHours: q.data.contact.officeHours ?? '' }); setS({ facebook: '', instagram: '', youtube: '', x: '', ...q.data.social }); } }, [q.data]);
  const save = useMutation({ mutationFn: () => api('/cms/settings', { method: 'PUT', body: { contact: c, social: s } }), onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['cms-settings'] }); }, onError: err });
  if (q.isLoading) return <Skeleton rows={4} />;
  return (
    <div className="max-w-2xl space-y-4">
      <p className="rounded-lg bg-chalk px-4 py-3 text-sm text-ink-muted">Address, phone, email, WhatsApp number and logo are set in <Link to="/settings" className="font-semibold text-brand underline">School settings</Link>.</p>
      <section className="panel space-y-4 p-5">
        <Field label="Google map" hint="In Google Maps, find the school, choose Share > Embed a map > Copy HTML, and paste it here.">
          <textarea className="field min-h-24 font-mono text-xs" value={c.mapEmbedUrl} onChange={(e) => setC({ ...c, mapEmbedUrl: e.target.value })} placeholder='<iframe src="https://www.google.com/maps/embed?pb=...' /></Field>
        {c.mapEmbedUrl.includes('google.com/maps/embed') && <iframe title="Map preview" className="h-56 w-full rounded-lg border border-line" src={(/src=["']([^"']+)/.exec(c.mapEmbedUrl)?.[1] ?? c.mapEmbedUrl).replace(/&amp;/g, '&')} loading="lazy" />}
        <Field label="Office hours"><input className="field" value={c.officeHours} onChange={(e) => setC({ ...c, officeHours: e.target.value })} /></Field>
      </section>
      <section className="panel space-y-3 p-5">
        <h3 className="font-semibold">Social media</h3>
        {(['facebook', 'instagram', 'youtube', 'x'] as const).map((k) => (
          <Field key={k} label={k === 'x' ? 'X (Twitter)' : k[0].toUpperCase() + k.slice(1)}><input className="field" placeholder="https://" value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} /></Field>
        ))}
      </section>
      <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
    </div>
  );
}
