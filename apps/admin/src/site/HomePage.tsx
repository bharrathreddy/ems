import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, MapPin, Quote } from 'lucide-react';
import clsx from 'clsx';
import { useSite } from './SiteRoot';
import { fmtDay, img, usePub } from './siteApi';
import { Container, CTA, PhotoGrid, SectionTitle, Video } from './parts';

type Section = { key: string; content: any; data: any };

function Banner({ c }: { c: any }) {
  const site = useSite();
  const slides: any[] = c.slides?.length ? c.slides : [{ heading: site.school.name, text: '' }];
  const [i, setI] = useState(0);
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (slides.length < 2 || reduce) return;
    const t = setInterval(() => setI((x) => (x + 1) % slides.length), (c.autoplaySeconds ?? 6) * 1000);
    return () => clearInterval(t);
  }, [slides.length, c.autoplaySeconds, reduce]);
  return (
    <section className="relative h-[68svh] min-h-[420px] overflow-hidden bg-brand" aria-roledescription="carousel" aria-label="Highlights">
      {slides.map((s, j) => (
        <div key={j} className={clsx('absolute inset-0 transition-opacity duration-700', j === i ? 'opacity-100' : 'pointer-events-none opacity-0')} aria-hidden={j !== i}>
          {s.imageId ? <img src={img(s.imageId)} alt="" className="h-full w-full object-cover" fetchPriority={j === 0 ? 'high' : 'auto'} />
            : <div className="h-full w-full" style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0 39px, rgba(255,255,255,.06) 39px 40px)' }} />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/10" />
          <Container className="absolute inset-x-0 bottom-0 pb-16 sm:pb-20">
            <h1 className="max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl">{s.heading}</h1>
            {s.text && <p className="mt-4 max-w-xl text-lg text-white/85 sm:text-xl">{s.text}</p>}
            {s.buttonLabel && s.buttonLink && <div className="mt-7"><CTA href={s.buttonLink} light>{s.buttonLabel}</CTA></div>}
          </Container>
        </div>
      ))}
      {slides.length > 1 && (
        <div className="absolute bottom-6 right-6 flex gap-2">
          {slides.map((_, j) => <button key={j} onClick={() => setI(j)} aria-label={`Show slide ${j + 1}`} aria-current={j === i} className={clsx('h-2.5 rounded-full transition-all', j === i ? 'w-8 bg-white' : 'w-2.5 bg-white/50')} />)}
        </div>
      )}
    </section>
  );
}

function Welcome({ c }: { c: any }) {
  return (
    <Container className="grid items-center gap-10 py-20 md:grid-cols-2">
      <div>
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{c.heading}</h2>
        <p className="mt-5 whitespace-pre-line text-lg leading-relaxed text-ink/80">{c.text}</p>
        {c.link && c.linkLabel && <div className="mt-7"><CTA href={c.link}>{c.linkLabel}</CTA></div>}
      </div>
      {c.imageId ? <img src={img(c.imageId)} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-2xl object-cover" />
        : <div className="aspect-[4/3] w-full rounded-2xl bg-brand-soft" />}
    </Container>
  );
}

function Principal({ c }: { c: any }) {
  return (
    <div className="bg-chalk">
      <Container className="grid items-center gap-10 py-20 md:grid-cols-[280px_1fr]">
        <div className="mx-auto w-56 md:w-full">
          {c.photoId ? <img src={img(c.photoId)} alt={c.name} loading="lazy" className="aspect-[4/5] w-full rounded-2xl object-cover" />
            : <div className="grid aspect-[4/5] w-full place-items-center rounded-2xl bg-brand-soft text-5xl font-bold text-brand">{c.name?.[0]}</div>}
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand">{c.heading}</p>
          <Quote size={40} className="mt-4 text-tangedu" aria-hidden />
          <p className="mt-2 whitespace-pre-line text-xl leading-relaxed text-ink/85 sm:text-2xl">{c.message}</p>
          <p className="mt-6 text-lg font-bold">{c.name}</p><p className="text-ink-muted">{c.designation}</p>
          <Link to="/about" className="mt-5 inline-block font-semibold text-brand hover:underline">Read the full message →</Link>
        </div>
      </Container>
    </div>
  );
}

function Highlights({ c }: { c: any }) {
  if (!c.items?.length) return null;
  return (
    <div className="bg-brand text-white">
      <Container className={clsx('grid gap-8 py-14 text-center', c.items.length >= 4 ? 'grid-cols-2 md:grid-cols-4' : ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3'][c.items.length])}>
        {c.items.map((h: any, i: number) => <div key={i}><p className="text-4xl font-bold sm:text-5xl">{h.value}</p><p className="mt-1 text-white/80">{h.label}</p></div>)}
      </Container>
    </div>
  );
}

function Facilities({ c }: { c: any }) {
  if (!c.items?.length) return null;
  return (
    <Container className="py-20">
      <SectionTitle title={c.heading} />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {c.items.map((f: any, i: number) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-line bg-surface">
            {f.imageId ? <img src={img(f.imageId)} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" /> : <div className="aspect-[4/3] w-full bg-brand-soft" />}
            <div className="p-5"><h3 className="text-lg font-bold">{f.title}</h3><p className="mt-1.5 text-ink-muted">{f.text}</p></div>
          </div>
        ))}
      </div>
    </Container>
  );
}

function Notices({ c, data }: { c: any; data: any[] }) {
  if (!data?.length) return null;
  return (
    <div className="bg-chalk">
      <Container className="py-20">
        <SectionTitle title={c.heading} link="/notices" />
        <div className="grid gap-4 md:grid-cols-3">
          {data.map((n) => (
            <article key={n.id} className="rounded-2xl bg-surface p-6">
              <p className="text-sm font-semibold text-brand">{n.publish_at ? fmtDay(n.publish_at) : ''}</p>
              <h3 className="mt-2 text-lg font-bold">{n.title}</h3>
              <p className="mt-2 line-clamp-4 whitespace-pre-line text-ink-muted">{n.body}</p>
            </article>
          ))}
        </div>
      </Container>
    </div>
  );
}

export function EventCard({ e }: { e: any }) {
  return (
    <Link to={`/events/${e.slug}`} className="group block overflow-hidden rounded-2xl border border-line bg-surface">
      {e.cover ? <img src={img(e.cover)} alt="" loading="lazy" className="aspect-[16/10] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        : <div className="grid aspect-[16/10] w-full place-items-center bg-brand-soft text-5xl font-bold text-brand/40">{new Date(e.event_date).getDate()}</div>}
      <div className="p-5">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-brand"><Calendar size={15} aria-hidden />{fmtDay(e.event_date)}</p>
        <h3 className="mt-1.5 text-lg font-bold group-hover:text-brand">{e.title}</h3>
        {e.location && <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted"><MapPin size={14} aria-hidden />{e.location}</p>}
      </div>
    </Link>
  );
}

function Testimonials({ c }: { c: any }) {
  if (!c.items?.length) return null;
  return (
    <Container className="py-20">
      <SectionTitle title={c.heading} />
      <div className="grid gap-5 md:grid-cols-3">
        {c.items.map((t: any, i: number) => (
          <figure key={i} className="rounded-2xl bg-chalk p-6">
            <Quote size={28} className="text-tangedu" aria-hidden />
            <blockquote className="mt-3 text-lg leading-relaxed text-ink/85">{t.text}</blockquote>
            <figcaption className="mt-4"><span className="font-bold">{t.name}</span>{t.relation && <span className="block text-sm text-ink-muted">{t.relation}</span>}</figcaption>
          </figure>
        ))}
      </div>
    </Container>
  );
}

function Admissions({ c }: { c: any }) {
  return (
    <Container className="py-16">
      <div className="flex flex-col items-start gap-6 rounded-3xl bg-tangedu-soft p-8 sm:p-12 md:flex-row md:items-center md:justify-between">
        <div><h2 className="text-3xl font-bold tracking-tight">{c.heading}</h2><p className="mt-2 max-w-xl text-lg text-ink/75">{c.text}</p></div>
        {c.buttonLabel && c.buttonLink && <CTA href={c.buttonLink}>{c.buttonLabel}</CTA>}
      </div>
    </Container>
  );
}

export function HomePage() {
  const q = usePub<Section[]>('home', '/home');
  if (q.isLoading) return <div className="h-[68svh] animate-pulse bg-brand/20" aria-busy="true" />;
  if (!q.data) return null;
  return (
    <>
      {q.data.map((s) => {
        switch (s.key) {
          case 'banner': return <Banner key={s.key} c={s.content} />;
          case 'welcome': return <Welcome key={s.key} c={s.content} />;
          case 'principal': return <Principal key={s.key} c={s.content} />;
          case 'highlights': return <Highlights key={s.key} c={s.content} />;
          case 'facilities': return <Facilities key={s.key} c={s.content} />;
          case 'notices': return <Notices key={s.key} c={s.content} data={s.data} />;
          case 'events': return s.data?.length ? <Container key={s.key} className="py-20"><SectionTitle title={s.content.heading} link="/events" /><div className="grid gap-5 md:grid-cols-3">{s.data.map((e: any) => <EventCard key={e.slug} e={e} />)}</div></Container> : null;
          case 'gallery': return s.data?.length ? <div key={s.key} className="bg-chalk"><Container className="py-20"><SectionTitle title={s.content.heading} link="/gallery" /><PhotoGrid photos={s.data} /></Container></div> : null;
          case 'videos': return s.data?.length ? <Container key={s.key} className="py-20"><SectionTitle title={s.content.heading} link="/videos" /><div className="grid gap-6 md:grid-cols-3">{s.data.map((v: any) => <Video key={v.youtube_id} id={v.youtube_id} title={v.title} />)}</div></Container> : null;
          case 'testimonials': return <Testimonials key={s.key} c={s.content} />;
          case 'admissions': return <Admissions key={s.key} c={s.content} />;
          default: return null;
        }
      })}
    </>
  );
}
