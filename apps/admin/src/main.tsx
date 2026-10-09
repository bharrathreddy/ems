import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

// The staff/family app lives under /app; everything else is the public school website.
// Each is a separate download, so website visitors never load the app code.
const isApp = window.location.pathname === '/app' || window.location.pathname.startsWith('/app/');
const Root = lazy(() => (isApp ? import('./AppRoot') : import('./site/SiteRoot')));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="grid min-h-dvh place-items-center text-ink-muted" aria-busy="true">Loading…</div>}>
      <Root />
    </Suspense>
  </StrictMode>,
);
