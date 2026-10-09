import { useEffect, useState } from 'react';

/**
 * Warns when the server answering is a different version from these screens, which happens when
 * an older copy of the app is still running (for example a forgotten window on port 3000).
 */
export function useServerVersion() {
  const [state, setState] = useState<{ server: string | null; reachable: boolean; status?: number } | null>(null);
  useEffect(() => {
    fetch('/api/v1/public/version').then(async (r) => {
      if (r.status === 404) return setState({ server: 'older', reachable: true });
      const j = await r.json().catch(() => null);
      // No proper answer (e.g. the dev screen server could not reach the app server): treat as not running.
      if (!r.ok || !j?.data?.version) return setState({ server: null, reachable: false, status: r.status });
      setState({ server: j.data.version, reachable: true });
    }).catch(() => setState({ server: null, reachable: false }));
  }, []);
  return state;
}

export function ServerProblem({ detail }: { detail?: string }) {
  const v = useServerVersion();
  const mismatch = v?.reachable && v.server !== __APP_VERSION__;
  return (
    <div className="mx-auto max-w-xl p-6 text-left">
      <h1 className="text-xl font-semibold">The school server is not answering correctly</h1>
      {!v ? <p className="mt-2 text-ink-muted">Checking…</p> : !v.reachable ? (
        <div className="mt-3 space-y-2">
          <p>The app server is not running{v.status ? ` (status ${v.status})` : ''}. It probably stopped while starting.</p>
          <p>Look in the window where you ran <code className="rounded bg-chalk px-1.5">npm run dev</code> or <code className="rounded bg-chalk px-1.5">npm start</code> for a line with <strong>Startup failed</strong>: it says what to fix. Check that MySQL is green in XAMPP.</p>
          <p>Or stop the app and run <code className="rounded bg-chalk px-1.5">npm run doctor</code>.</p>
        </div>
      ) : mismatch ? (
        <div className="mt-3 space-y-2">
          <p>An <strong>older copy of the app</strong> is answering (server {v.server === 'older' ? 'is an older release' : `version ${v.server}`}, these screens are version {__APP_VERSION__}).</p>
          <p>Close every window running the app, or run <code className="rounded bg-chalk px-1.5">taskkill /F /IM node.exe</code> in Command Prompt, then start again with <code className="rounded bg-chalk px-1.5">npm run build</code> and <code className="rounded bg-chalk px-1.5">npm start</code>.</p>
        </div>
      ) : <p className="mt-3">{detail ?? 'The server returned an error.'} Look at the window where the app is running for the message, or run <code className="rounded bg-chalk px-1.5">npm run doctor</code>.</p>}
      <p className="mt-6 text-sm"><a className="font-semibold text-brand" href="/app/login">Go to sign in</a></p>
    </div>
  );
}

/** Small banner for logged-in screens when the server version differs. */
export function VersionBanner() {
  const v = useServerVersion();
  if (!v?.reachable || v.server === __APP_VERSION__) return null;
  return (
    <div className="bg-tangedu-soft px-4 py-2 text-center text-sm text-[#7A5A00]" role="alert">
      The server is {v.server === 'older' ? 'an older version' : `version ${v.server}`}, these screens are version {__APP_VERSION__}. Close other running copies of the app (or run <code>taskkill /F /IM node.exe</code>) and start it again.
    </div>
  );
}
