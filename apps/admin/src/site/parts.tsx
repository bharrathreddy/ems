import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Play, X } from 'lucide-react';
import clsx from 'clsx';
import { img } from './siteApi';

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('mx-auto max-w-6xl px-4 sm:px-6', className)}>{children}</div>;
}
export function SectionTitle({ title, link, linkLabel = 'See all' }: { title: string; link?: string; linkLabel?: string }) {
  return (
    <div className="mb-8 flex items-end justify-between gap-4">
      <h2 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">{title}</h2>
      {link && <Link to={link} className="shrink-0 font-semibold text-brand hover:underline">{linkLabel} →</Link>}
    </div>
  );
}
export function PageHero({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="bg-brand text-white" style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0 39px, rgba(255,255,255,.06) 39px 40px)' }}>
      <Container className="py-14 sm:py-20"><h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{title}</h1>{subtitle && <p className="mt-3 max-w-2xl text-lg text-white/80">{subtitle}</p>}</Container>
    </div>
  );
}
export const isInternal = (href: string) => href.startsWith('/') && !href.startsWith('/app') && !href.startsWith('/api');
export function CTA({ href, children, light }: { href: string; children: ReactNode; light?: boolean }) {
  const cls = light ? 'inline-flex min-h-12 items-center rounded-lg bg-white px-6 text-base font-semibold text-ink hover:bg-white/90' : 'btn-primary min-h-12 px-6 text-base';
  return isInternal(href) ? <Link to={href} className={cls}>{children}</Link> : <a href={href} className={cls} {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>;
}

/** Full-screen photo viewer with keyboard and swipe support. */
export function Lightbox({ photos, start, onClose }: { photos: Array<{ image: string; caption?: string | null }>; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const go = useCallback((d: number) => setI((x) => (x + d + photos.length) % photos.length), [photos.length]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); };
    document.addEventListener('keydown', k); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [go, onClose]);
  let x0 = 0;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label="Photo viewer"
      onTouchStart={(e) => { x0 = e.touches[0].clientX; }} onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); }}>
      <div className="flex items-center justify-between p-4 text-white/80"><span className="text-sm">{i + 1} / {photos.length}</span>
        <button onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-white/10"><X size={26} /></button></div>
      <div className="relative flex flex-1 items-center justify-center px-2">
        <img src={img(photos[i].image)} alt={photos[i].caption ?? ''} className="max-h-full max-w-full object-contain" />
        {photos.length > 1 && <>
          <button onClick={() => go(-1)} aria-label="Previous" className="absolute left-2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"><ChevronLeft /></button>
          <button onClick={() => go(1)} aria-label="Next" className="absolute right-2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"><ChevronRight /></button>
        </>}
      </div>
      {photos[i].caption && <p className="p-4 text-center text-white/90">{photos[i].caption}</p>}
    </div>
  );
}

export function PhotoGrid({ photos }: { photos: Array<{ image: string; caption?: string | null }> }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((p, i) => (
          <button key={p.image} onClick={() => setOpen(i)} className="group relative aspect-square overflow-hidden rounded-xl bg-chalk">
            <img src={img(p.image)} alt={p.caption ?? ''} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
          </button>
        ))}
      </div>
      {open !== null && <Lightbox photos={photos} start={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** YouTube thumbnail that turns into the player on tap (privacy-friendly youtube-nocookie, nothing loads until tapped). */
export function Video({ id, title }: { id: string; title: string }) {
  const [play, setPlay] = useState(false);
  return (
    <figure>
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
        {play ? <iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`} title={title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
          : <button onClick={() => setPlay(true)} className="group h-full w-full" aria-label={`Play ${title}`}>
              <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
              <span className="absolute inset-0 grid place-items-center"><span className="grid h-16 w-16 place-items-center rounded-full bg-white/95 text-brand shadow-lg transition-transform group-hover:scale-110"><Play size={28} fill="currentColor" className="ml-1" /></span></span>
            </button>}
      </div>
      <figcaption className="mt-3 font-semibold text-ink">{title}</figcaption>
    </figure>
  );
}
