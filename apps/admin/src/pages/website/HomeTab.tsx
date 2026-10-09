import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '../../lib/api';
import { Field, Sheet, Skeleton, Toggle } from '../../components/ui';
import ImageField from '../../components/ImageField';

interface Section { key: string; position: number; visible: boolean; content: any }
const NAMES: Record<string, [string, string]> = {
  banner: ['Banner slider', 'Large photos at the top, with heading and button'], welcome: ['Welcome', 'Short introduction with a photo'],
  principal: ["Principal's message", 'Photo, name and message'], highlights: ['Highlights', 'Numbers such as students and teachers'],
  facilities: ['Facilities', 'Cards with photo and a line each'], notices: ['Latest notices', 'Notices marked "Show on website"'],
  events: ['Events', 'Upcoming and recent events'], gallery: ['Gallery', 'Latest photos'], videos: ['Videos', 'Latest YouTube videos'],
  testimonials: ['Parents say', 'Quotes from parents'], admissions: ['Admissions band', 'Call to action with a button'],
};

function ListEditor({ items, onChange, blank, max, render, addLabel }: { items: any[]; onChange: (v: any[]) => void; blank: any; max: number; render: (it: any, set: (p: any) => void) => ReactNode; addLabel: string }) {
  const move = (i: number, d: number) => { const a = [...items]; [a[i], a[i + d]] = [a[i + d], a[i]]; onChange(a); };
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center justify-end gap-1 text-ink-muted">
            <span className="mr-auto text-xs font-semibold">#{i + 1}</span>
            <button type="button" aria-label="Move up" disabled={i === 0} className="p-1 disabled:opacity-30" onClick={() => move(i, -1)}><ArrowUp size={16} /></button>
            <button type="button" aria-label="Move down" disabled={i === items.length - 1} className="p-1 disabled:opacity-30" onClick={() => move(i, 1)}><ArrowDown size={16} /></button>
            <button type="button" aria-label="Remove" className="p-1 hover:text-danger" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
          </div>
          {render(it, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))))}
        </div>
      ))}
      {items.length < max && <button type="button" className="btn-quiet w-full" onClick={() => onChange([...items, { ...blank }])}><Plus size={16} aria-hidden />{addLabel}</button>}
    </div>
  );
}

const T = ({ label, value, onChange, area, hint }: { label: string; value: string; onChange: (v: string) => void; area?: boolean; hint?: string }) => (
  <Field label={label} hint={hint}>{area ? <textarea className="field min-h-24" value={value ?? ''} onChange={(e) => onChange(e.target.value)} /> : <input className="field" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />}</Field>
);

function Editor({ s, onClose }: { s: Section; onClose: () => void }) {
  const qc = useQueryClient();
  const [c, setC] = useState<any>(s.content);
  useEffect(() => setC(s.content), [s]);
  const set = (p: any) => setC({ ...c, ...p });
  const save = useMutation({
    mutationFn: () => api<Section[]>(`/cms/home/${s.key}`, { method: 'PATCH', body: { content: c } }),
    onSuccess: ({ data }) => { qc.setQueryData(['cms-home'], data); toast.success('Saved. The website shows it now.'); onClose(); },
    onError: (e) => toast.error((e as ApiError).details?.[0] ? `${(e as ApiError).details![0].field}: ${(e as ApiError).details![0].message}` : (e as ApiError).message),
  });
  const linkHint = 'A page like /contact or /about, or a full https:// link';
  let body: ReactNode = null;
  switch (s.key) {
    case 'banner': body = (<>
      <ListEditor items={c.slides ?? []} max={8} addLabel="Add slide" blank={{ imageId: null, heading: '', text: '', buttonLabel: '', buttonLink: '' }} onChange={(slides) => set({ slides })}
        render={(sl: any, u) => (<div className="space-y-3"><ImageField label="Photo (wide, 1920×900 or larger)" value={sl.imageId} onChange={(imageId) => u({ imageId })} />
          <T label="Heading" value={sl.heading} onChange={(v) => u({ heading: v })} /><T label="Text" value={sl.text} onChange={(v) => u({ text: v })} />
          <div className="grid grid-cols-2 gap-2"><T label="Button text" value={sl.buttonLabel} onChange={(v) => u({ buttonLabel: v })} /><T label="Button link" value={sl.buttonLink} onChange={(v) => u({ buttonLink: v })} hint={linkHint} /></div></div>)} />
      <Field label="Seconds per slide"><input type="number" min={3} max={20} className="field w-28" value={c.autoplaySeconds ?? 6} onChange={(e) => set({ autoplaySeconds: Number(e.target.value) })} /></Field></>); break;
    case 'welcome': body = (<><T label="Heading" value={c.heading} onChange={(v) => set({ heading: v })} /><T label="Text" area value={c.text} onChange={(v) => set({ text: v })} />
      <ImageField label="Photo" aspect="aspect-[4/3]" value={c.imageId} onChange={(imageId) => set({ imageId })} />
      <div className="grid grid-cols-2 gap-2"><T label="Link text" value={c.linkLabel} onChange={(v) => set({ linkLabel: v })} /><T label="Link" value={c.link} onChange={(v) => set({ link: v })} hint={linkHint} /></div></>); break;
    case 'principal': body = (<><T label="Section heading" value={c.heading} onChange={(v) => set({ heading: v })} />
      <div className="grid grid-cols-[140px_1fr] gap-3"><ImageField label="Photo" aspect="aspect-[4/5]" value={c.photoId} onChange={(photoId) => set({ photoId })} />
        <div className="space-y-3"><T label="Name" value={c.name} onChange={(v) => set({ name: v })} /><T label="Designation" value={c.designation} onChange={(v) => set({ designation: v })} /></div></div>
      <T label="Short message (home page)" area value={c.message} onChange={(v) => set({ message: v })} />
      <T label="Full message (About page)" area value={c.fullMessage} onChange={(v) => set({ fullMessage: v })} hint="Use a blank line between paragraphs." /></>); break;
    case 'highlights': body = <ListEditor items={c.items ?? []} max={6} addLabel="Add number" blank={{ value: '', label: '' }} onChange={(items) => set({ items })}
      render={(h: any, u) => <div className="grid grid-cols-[110px_1fr] gap-2"><T label="Number" value={h.value} onChange={(v) => u({ value: v })} /><T label="Label" value={h.label} onChange={(v) => u({ label: v })} /></div>} />; break;
    case 'facilities': body = (<><T label="Heading" value={c.heading} onChange={(v) => set({ heading: v })} />
      <ListEditor items={c.items ?? []} max={12} addLabel="Add facility" blank={{ title: '', text: '', imageId: null }} onChange={(items) => set({ items })}
        render={(f: any, u) => <div className="grid grid-cols-[140px_1fr] gap-3"><ImageField label="Photo" aspect="aspect-[4/3]" value={f.imageId} onChange={(imageId) => u({ imageId })} />
          <div className="space-y-2"><T label="Title" value={f.title} onChange={(v) => u({ title: v })} /><T label="One line" value={f.text} onChange={(v) => u({ text: v })} /></div></div>} /></>); break;
    case 'testimonials': body = (<><T label="Heading" value={c.heading} onChange={(v) => set({ heading: v })} />
      <ListEditor items={c.items ?? []} max={12} addLabel="Add quote" blank={{ name: '', relation: '', text: '' }} onChange={(items) => set({ items })}
        render={(t: any, u) => <div className="space-y-2"><T label="Quote" area value={t.text} onChange={(v) => u({ text: v })} /><div className="grid grid-cols-2 gap-2"><T label="Name" value={t.name} onChange={(v) => u({ name: v })} /><T label="Relation" value={t.relation} onChange={(v) => u({ relation: v })} /></div></div>} /></>); break;
    case 'admissions': body = (<><T label="Heading" value={c.heading} onChange={(v) => set({ heading: v })} /><T label="Text" area value={c.text} onChange={(v) => set({ text: v })} />
      <div className="grid grid-cols-2 gap-2"><T label="Button text" value={c.buttonLabel} onChange={(v) => set({ buttonLabel: v })} /><T label="Button link" value={c.buttonLink} onChange={(v) => set({ buttonLink: v })} hint={linkHint} /></div></>); break;
    default: body = (<><T label="Heading" value={c.heading} onChange={(v) => set({ heading: v })} />
      <Field label="How many to show"><input type="number" className="field w-28" min={1} max={12} value={c.count} onChange={(e) => set({ count: Number(e.target.value) })} /></Field>
      <p className="text-sm text-ink-muted">This section fills itself from {s.key === 'notices' ? 'Notices marked "Show on website"' : `the ${NAMES[s.key][0]} tab`}. It is hidden on the website while there is nothing to show.</p></>);
  }
  return <Sheet open onClose={onClose} title={NAMES[s.key][0]} footer={<button className="btn-primary w-full" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save section'}</button>}><div className="space-y-4">{body}</div></Sheet>;
}

export default function HomeTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cms-home'], queryFn: () => api<Section[]>('/cms/home').then((r) => r.data) });
  const [editing, setEditing] = useState<Section | null>(null);
  const order = useMutation({ mutationFn: (keys: string[]) => api<Section[]>('/cms/home/order', { method: 'PUT', body: { keys } }), onSuccess: ({ data }) => qc.setQueryData(['cms-home'], data) });
  const vis = useMutation({ mutationFn: (v: { key: string; visible: boolean }) => api<Section[]>(`/cms/home/${v.key}`, { method: 'PATCH', body: { visible: v.visible } }), onSuccess: ({ data }) => qc.setQueryData(['cms-home'], data) });
  if (q.isLoading) return <Skeleton rows={8} />;
  const rows = q.data!;
  const move = (i: number, d: number) => { const k = rows.map((r) => r.key); [k[i], k[i + d]] = [k[i + d], k[i]]; order.mutate(k); };
  return (
    <>
      <p className="mb-3 text-sm text-ink-muted">Sections appear on the home page in this order. Switch off what you don't need.</p>
      <ul className="panel divide-y divide-line">
        {rows.map((r, i) => (
          <li key={r.key} className="flex items-center gap-2 px-3 py-3 sm:px-4">
            <div className="flex flex-col text-ink-muted">
              <button aria-label={`Move ${NAMES[r.key][0]} up`} disabled={i === 0 || order.isPending} className="p-0.5 disabled:opacity-30" onClick={() => move(i, -1)}><ArrowUp size={16} /></button>
              <button aria-label={`Move ${NAMES[r.key][0]} down`} disabled={i === rows.length - 1 || order.isPending} className="p-0.5 disabled:opacity-30" onClick={() => move(i, 1)}><ArrowDown size={16} /></button>
            </div>
            <div className="min-w-0 flex-1"><p className={r.visible ? 'font-semibold' : 'font-semibold text-ink-muted'}>{NAMES[r.key][0]}</p><p className="truncate text-sm text-ink-muted">{NAMES[r.key][1]}</p></div>
            <button className="btn-quiet min-h-9 px-3 text-sm" onClick={() => setEditing(r)}><Pencil size={14} aria-hidden />Edit</button>
            <Toggle checked={r.visible} label={`Show ${NAMES[r.key][0]}`} onChange={(visible) => vis.mutate({ key: r.key, visible })} />
          </li>
        ))}
      </ul>
      {editing && <Editor s={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
