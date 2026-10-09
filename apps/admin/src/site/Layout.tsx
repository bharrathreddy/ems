import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Mail, MapPin, Menu, Phone, X, Clock } from 'lucide-react';
import clsx from 'clsx';
import { useSite } from './SiteRoot';
import { img, type SiteLink } from './siteApi';

const SOCIAL: Record<string, { label: string; path: string }> = {
  facebook: { label: 'Facebook', path: 'M14 8h3V4h-3c-2.8 0-5 2.2-5 5v2H6v4h3v9h4v-9h3l1-4h-4V9c0-.6.4-1 1-1z' },
  instagram: { label: 'Instagram', path: 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm5 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm6-1.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z' },
  youtube: { label: 'YouTube', path: 'M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8zM9.8 15.1V8.9l5.4 3.1-5.4 3.1z' },
  x: { label: 'X', path: 'M17.7 3h3.4l-7.4 8.5L22.4 21h-6.8l-5.3-6.9L4.2 21H.8l7.9-9.1L.4 3h7l4.8 6.3L17.7 3zm-1.2 16h1.9L6.4 5H4.4l12.1 14z' },
};

export function SiteLinkA({ l, className, onClick }: { l: SiteLink; className?: string; onClick?: () => void }) {
  if (l.external || l.newTab) return <a href={l.href} target={l.newTab ? '_blank' : undefined} rel="noopener noreferrer" className={className} onClick={onClick}>{l.label}</a>;
  return <NavLink to={l.href} end={l.href === '/'} className={({ isActive }) => clsx(className, isActive && 'is-active')} onClick={onClick}>{l.label}</NavLink>;
}

function Logo() {
  const { school } = useSite();
  return (
    <Link to="/" className="flex min-w-0 items-center gap-3">
      {school.logo ? <img src={img(school.logo)} alt="" className="h-11 w-11 shrink-0 rounded-lg object-contain" />
        : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand text-lg font-bold text-white">{school.name[0]}</span>}
      <span className="min-w-0"><span className="block truncate text-[17px] font-bold leading-tight text-ink">{school.name}</span>
        {school.address && <span className="block truncate text-xs text-ink-muted">{school.address.split(',').slice(-2).join(',').trim()}</span>}</span>
    </Link>
  );
}

export default function Layout() {
  const site = useSite();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [pathname]);
  const nav = 'relative px-3 py-2 text-[15px] font-semibold text-ink/80 hover:text-brand [&.is-active]:text-brand';
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">Skip to content</a>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="ml-auto hidden items-center lg:flex" aria-label="Main">
            {site.menus.header.map((l) => <SiteLinkA key={l.href + l.label} l={l} className={nav} />)}
          </nav>
          <a href="/app/login" className="btn-primary ml-auto hidden min-h-10 px-5 text-sm lg:ml-2 lg:inline-flex">Login</a>
          <button className="ml-auto rounded-lg p-2 lg:hidden" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={26} /> : <Menu size={26} />}</button>
        </div>
        {open && (
          <nav className="border-t border-line bg-surface px-4 pb-5 pt-2 lg:hidden" aria-label="Main">
            {site.menus.header.map((l) => <SiteLinkA key={l.href + l.label} l={l} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-3 text-lg font-semibold text-ink [&.is-active]:bg-brand-soft [&.is-active]:text-brand" />)}
            <a href="/app/login" className="btn-primary mt-3 w-full">Login for parents and staff</a>
          </nav>
        )}
      </header>

      <main id="main" className="flex-1"><Outlet /></main>

      <footer className="bg-[#14201B] text-white/80">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="text-xl font-bold text-white">{site.school.name}</p>
            <ul className="mt-4 space-y-2.5 text-[15px]">
              {site.school.address && <li className="flex gap-3"><MapPin size={18} className="mt-0.5 shrink-0 text-white/50" aria-hidden />{site.school.address}</li>}
              {site.school.phone && <li className="flex gap-3"><Phone size={18} className="mt-0.5 shrink-0 text-white/50" aria-hidden /><a href={`tel:${site.school.phone}`} className="hover:text-white">{site.school.phone}</a></li>}
              {site.school.email && <li className="flex gap-3"><Mail size={18} className="mt-0.5 shrink-0 text-white/50" aria-hidden /><a href={`mailto:${site.school.email}`} className="hover:text-white">{site.school.email}</a></li>}
              {site.contact.officeHours && <li className="flex gap-3"><Clock size={18} className="mt-0.5 shrink-0 text-white/50" aria-hidden />{site.contact.officeHours}</li>}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-white/50">Explore</p>
            <ul className="mt-4 space-y-2.5">{site.menus.footer.map((l) => <li key={l.href + l.label}><SiteLinkA l={l} className="hover:text-white" /></li>)}</ul>
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-white/50">Parents and staff</p>
            <a href="/app/login" className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-white px-5 font-semibold text-ink hover:bg-white/90">Login</a>
            {Object.keys(site.social).length > 0 && (
              <div className="mt-6 flex gap-2">
                {Object.entries(site.social).map(([k, url]) => SOCIAL[k] && (
                  <a key={k} href={url} target="_blank" rel="noopener noreferrer" aria-label={SOCIAL[k].label} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden><path d={SOCIAL[k].path} /></svg>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-white/10 py-5 text-center text-sm text-white/50">© {new Date().getFullYear()} {site.school.name}</div>
      </footer>
    </div>
  );
}
