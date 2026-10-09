import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Calendar, CheckCircle2, Clock, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { Markdown } from '../lib/markdown';
import { useSite } from './SiteRoot';
import { fmtDay, img, NotFound, usePub } from './siteApi';
import { Container, PageHero, PhotoGrid, Video } from './parts';
import { EventCard } from './HomePage';

const Loading = () => <div className="h-64 animate-pulse bg-chalk" aria-busy="true" />;
function useTitle(t?: string) { const { school } = useSite(); if (t) document.title = `${t} | ${school.name}`; }

export function NotFoundPage() {
  return (
    <Container className="py-28 text-center">
      <h1 className="text-4xl font-bold">Page not found</h1>
      <p className="mt-3 text-lg text-ink-muted">This page does not exist or has been moved.</p>
      <Link to="/" className="btn-primary mt-8">Go to home page</Link>
    </Container>
  );
}

interface PageData { slug: string; kind: string; title: string; body: string | null; principal: null | { name: string; designation: string; photoId: string | null; heading: string; message: string } }

export function CustomPage({ slug: fixed }: { slug?: string }) {
  const { slug } = useParams();
  const q = usePub<PageData>(`page-${fixed ?? slug}`, `/pages/${fixed ?? slug}`);
  useTitle(q.data?.title);
  if (q.isLoading) return <Loading />;
  if (q.error instanceof NotFound || !q.data) return <NotFoundPage />;
  return (<><PageHero title={q.data.title} /><Container className="max-w-3xl py-14"><Markdown text={q.data.body} /></Container></>);
}

export function AboutPage() {
  const q = usePub<PageData>('page-about', '/pages/about');
  useTitle(q.data?.title);
  if (q.isLoading) return <Loading />;
  if (q.error instanceof NotFound || !q.data) return <NotFoundPage />;
  const p = q.data.principal;
  return (
    <>
      <PageHero title={q.data.title} />
      <Container className="max-w-3xl py-14"><Markdown text={q.data.body} /></Container>
      {p && p.message && (
        <div className="bg-chalk">
          <Container className="grid max-w-5xl gap-10 py-16 md:grid-cols-[240px_1fr]">
            <div className="mx-auto w-48 md:w-full">{p.photoId ? <img src={img(p.photoId)} alt={p.name} className="aspect-[4/5] w-full rounded-2xl object-cover" /> : <div className="aspect-[4/5] rounded-2xl bg-brand-soft" />}
              <p className="mt-4 text-lg font-bold">{p.name}</p><p className="text-ink-muted">{p.designation}</p></div>
            <div><h2 className="mb-5 text-3xl font-bold tracking-tight">{p.heading}</h2><Markdown text={p.message} /></div>
          </Container>
        </div>
      )}
    </>
  );
}

export function ContactPage() {
  const site = useSite();
  useTitle('Contact us');
  const [f, setF] = useState({ name: '', mobile: '', message: '', website: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ whatsappUrl: string | null } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErrors({});
    try {
      const r = await fetch('/api/v1/public/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, mobile: f.mobile || undefined }) });
      const j = await r.json();
      if (!j.success) setErrors(j.details ? Object.fromEntries(j.details.map((d: any) => [d.field, d.message])) : { form: j.message });
      else setSent(j.data);
    } catch { setErrors({ form: 'Could not send. Check your connection and try again.' }); } finally { setBusy(false); }
  };
  const s = site.school;
  return (
    <>
      <PageHero title="Contact us" subtitle="Questions about admissions, fees or anything else? Send us a message or visit the school office." />
      <Container className="grid gap-12 py-14 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-5 text-lg">
          {s.address && <p className="flex gap-4"><MapPin className="mt-1 shrink-0 text-brand" aria-hidden /><span>{s.address}</span></p>}
          {s.phone && <p className="flex gap-4"><Phone className="mt-1 shrink-0 text-brand" aria-hidden /><a href={`tel:${s.phone}`} className="hover:text-brand">{s.phone}</a></p>}
          {s.email && <p className="flex gap-4"><Mail className="mt-1 shrink-0 text-brand" aria-hidden /><a href={`mailto:${s.email}`} className="break-all hover:text-brand">{s.email}</a></p>}
          {site.contact.officeHours && <p className="flex gap-4"><Clock className="mt-1 shrink-0 text-brand" aria-hidden /><span>{site.contact.officeHours}</span></p>}
          {s.whatsapp && <a href={`https://wa.me/91${s.whatsapp}`} target="_blank" rel="noopener noreferrer" className="btn mt-2 bg-[#1F7A4D] text-white hover:brightness-110"><MessageCircle size={18} aria-hidden />Chat on WhatsApp</a>}
          {site.contact.mapEmbedUrl && (
            <div className="overflow-hidden rounded-2xl border border-line">
              <iframe src={site.contact.mapEmbedUrl} title={`Map to ${s.name}`} className="h-80 w-full" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            </div>
          )}
        </div>
        <div className="rounded-3xl bg-chalk p-6 sm:p-8">
          {sent ? (
            <div className="py-8 text-center">
              <CheckCircle2 size={48} className="mx-auto text-brand" aria-hidden />
              <h2 className="mt-4 text-2xl font-bold">Thank you, your message is sent</h2>
              <p className="mt-2 text-ink-muted">The school office will get back to you soon.</p>
              {sent.whatsappUrl && <a href={sent.whatsappUrl} target="_blank" rel="noopener noreferrer" className="btn mt-6 bg-[#1F7A4D] text-white hover:brightness-110"><MessageCircle size={18} aria-hidden />Also send it on WhatsApp</a>}
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <h2 className="text-2xl font-bold">Send a message</h2>
              <label className="block"><span className="label">Your name</span><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />{errors.name && <span className="mt-1 block text-sm text-danger">{errors.name}</span>}</label>
              <label className="block"><span className="label">Mobile number (optional)</span><input className="field" inputMode="tel" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} autoComplete="tel" />{errors.mobile && <span className="mt-1 block text-sm text-danger">{errors.mobile}</span>}</label>
              <label className="block"><span className="label">Message</span><textarea className="field min-h-36" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />{errors.message && <span className="mt-1 block text-sm text-danger">{errors.message}</span>}</label>
              <input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} className="hidden" aria-hidden />
              {errors.form && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger" role="alert">{errors.form}</p>}
              <button className="btn-primary min-h-12 w-full text-base" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</button>
            </form>
          )}
        </div>
      </Container>
    </>
  );
}

export function EventsPage() {
  useTitle('Events');
  const q = usePub<{ upcoming: any[]; past: any[] }>('events', '/events');
  if (q.isLoading) return <Loading />;
  if (q.error instanceof NotFound) return <NotFoundPage />;
  const { upcoming = [], past = [] } = q.data ?? {};
  return (
    <>
      <PageHero title="Events" />
      <Container className="py-14">
        {upcoming.length > 0 && <><h2 className="mb-6 text-2xl font-bold">Coming up</h2><div className="mb-14 grid gap-5 md:grid-cols-3">{upcoming.map((e) => <EventCard key={e.slug} e={e} />)}</div></>}
        <h2 className="mb-6 text-2xl font-bold">Past events</h2>
        {past.length ? <div className="grid gap-5 md:grid-cols-3">{past.map((e) => <EventCard key={e.slug} e={e} />)}</div> : <p className="text-ink-muted">No past events yet.</p>}
      </Container>
    </>
  );
}

export function EventPage() {
  const { slug } = useParams();
  const q = usePub<any>(`event-${slug}`, `/events/${slug}`);
  useTitle(q.data?.title);
  if (q.isLoading) return <Loading />;
  if (q.error instanceof NotFound || !q.data) return <NotFoundPage />;
  const e = q.data;
  return (
    <>
      <div className="relative bg-brand">
        {e.cover && <img src={img(e.cover)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />}
        <Container className="relative py-16 text-white sm:py-24">
          <Link to="/events" className="text-sm font-semibold text-white/80 hover:text-white">← All events</Link>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{e.title}</h1>
          <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-lg text-white/90">
            <span className="flex items-center gap-2"><Calendar size={18} aria-hidden />{fmtDay(e.event_date)}{e.end_date && e.end_date !== e.event_date ? ` to ${fmtDay(e.end_date)}` : ''}</span>
            {e.location && <span className="flex items-center gap-2"><MapPin size={18} aria-hidden />{e.location}</span>}
          </p>
        </Container>
      </div>
      <Container className="py-14">
        {e.description && <div className="max-w-3xl"><Markdown text={e.description} /></div>}
        {e.photos.length > 0 && <><h2 className="mb-6 mt-12 text-2xl font-bold">Photos</h2><PhotoGrid photos={e.photos} /></>}
        {e.videos.length > 0 && <><h2 className="mb-6 mt-12 text-2xl font-bold">Videos</h2><div className="grid gap-6 md:grid-cols-2">{e.videos.map((v: any) => <Video key={v.youtube_id} id={v.youtube_id} title={v.title} />)}</div></>}
      </Container>
    </>
  );
}

export function GalleryPage() {
  useTitle('Gallery');
  const q = usePub<any[]>('gallery', '/gallery');
  if (q.isLoading) return <Loading />;
  if (q.error instanceof NotFound) return <NotFoundPage />;
  return (
    <>
      <PageHero title="Gallery" />
      <Container className="py-14">
        {!q.data?.length ? <p className="text-ink-muted">Photos will appear here soon.</p> : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {q.data.map((a) => (
              <Link key={a.slug} to={`/gallery/${a.slug}`} className="group block">
                <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-chalk">{a.cover && <img src={img(a.cover)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />}</div>
                <h2 className="mt-3 text-lg font-bold group-hover:text-brand">{a.title}</h2>
                <p className="text-sm text-ink-muted">{a.photos} photo{a.photos === 1 ? '' : 's'}{a.event_date ? ` · ${fmtDay(a.event_date)}` : ''}</p>
              </Link>
            ))}
          </div>
        )}
      </Container>
    </>
  );
}

export function AlbumPage() {
  const { slug } = useParams();
  const q = usePub<any>(`album-${slug}`, `/gallery/${slug}`);
  useTitle(q.data?.title);
  if (q.isLoading) return <Loading />;
  if (q.error instanceof NotFound || !q.data) return <NotFoundPage />;
  return (
    <>
      <PageHero title={q.data.title} subtitle={q.data.event_date ? fmtDay(q.data.event_date) : undefined} />
      <Container className="py-12">
        <div className="mb-6 flex gap-4 text-sm font-semibold"><Link to="/gallery" className="text-brand">← All albums</Link>{q.data.eventSlug && <Link to={`/events/${q.data.eventSlug}`} className="text-brand">About this event</Link>}</div>
        <PhotoGrid photos={q.data.photos} />
      </Container>
    </>
  );
}

export function VideosPage() {
  useTitle('Videos');
  const q = usePub<any[]>('videos', '/videos');
  if (q.isLoading) return <Loading />;
  if (q.error instanceof NotFound) return <NotFoundPage />;
  return (
    <>
      <PageHero title="Videos" />
      <Container className="py-14">
        {!q.data?.length ? <p className="text-ink-muted">Videos will appear here soon.</p> : <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">{q.data.map((v) => <Video key={v.youtube_id} id={v.youtube_id} title={v.title} />)}</div>}
      </Container>
    </>
  );
}

export function NoticesPage() {
  useTitle('Notices');
  const q = usePub<any[]>('notices', '/notices');
  if (q.isLoading) return <Loading />;
  if (q.error instanceof NotFound) return <NotFoundPage />;
  return (
    <>
      <PageHero title="Notices" />
      <Container className="max-w-3xl py-14">
        {!q.data?.length ? <p className="text-ink-muted">No notices right now.</p> : (
          <div className="space-y-4">{q.data.map((n) => (
            <article key={n.id} className="rounded-2xl border border-line p-6">
              <p className="text-sm font-semibold text-brand">{n.publish_at ? fmtDay(n.publish_at) : ''}</p>
              <h2 className="mt-1 text-xl font-bold">{n.title}</h2><p className="mt-2 whitespace-pre-line text-ink/80">{n.body}</p>
            </article>
          ))}</div>
        )}
      </Container>
    </>
  );
}
