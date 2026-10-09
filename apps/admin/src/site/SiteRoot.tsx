import { createContext, useContext, useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { applyBrand } from '../lib/brand';
import { pub, type Site } from './siteApi';
import Layout from './Layout';
import { ServerProblem } from '../components/ServerCheck';
import { HomePage } from './HomePage';
import { AboutPage, ContactPage, CustomPage, EventPage, EventsPage, GalleryPage, AlbumPage, VideosPage, NoticesPage, NotFoundPage } from './Pages';

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } } });
const SiteCtx = createContext<Site | null>(null);
export const useSite = () => useContext(SiteCtx)!;

function Shell() {
  const q = useQuery({ queryKey: ['pub', 'site'], queryFn: () => pub<Site>('/site'), retry: 1 });
  useEffect(() => { if (q.data) applyBrand(q.data.school.brandPrimary); }, [q.data]);
  if (q.isLoading) return <div className="grid min-h-dvh place-items-center text-ink-muted" aria-busy="true">Loading…</div>;
  if (q.isError) return <div className="grid min-h-dvh place-items-center"><ServerProblem detail={(q.error as Error)?.message} /></div>;
  if (!q.data!.enabled) { window.location.replace('/app/login'); return null; }
  return (
    <SiteCtx.Provider value={q.data!}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="contact" element={<ContactPage />} />
          <Route path="privacy" element={<CustomPage slug="privacy" />} />
          <Route path="p/:slug" element={<CustomPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="events/:slug" element={<EventPage />} />
          <Route path="gallery" element={<GalleryPage />} />
          <Route path="gallery/:slug" element={<AlbumPage />} />
          <Route path="videos" element={<VideosPage />} />
          <Route path="notices" element={<NoticesPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </SiteCtx.Provider>
  );
}

export default function SiteRoot() {
  return <QueryClientProvider client={qc}><BrowserRouter><Shell /></BrowserRouter></QueryClientProvider>;
}
