export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Array<{ field: string; message: string }>) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const WS_KEY = 'ems.workspace';
/** "Login as" is per browser tab: this tab remembers whose login it is using; other tabs keep the developer's own. */
const PROXY_KEY = 'ems.proxy';
const PROXY_WS_KEY = 'ems.proxy.workspace';
const tabStore = { get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string | null) => { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch { /* storage unavailable */ } } };

export const session = {
  setToken: (t: string | null) => { accessToken = t; },
  hasToken: () => accessToken !== null,
  proxyName: () => tabStore.get(PROXY_KEY),
  setProxy: (name: string | null) => { tabStore.set(PROXY_KEY, name); tabStore.set(PROXY_WS_KEY, null); },
  getWorkspace: () => { if (tabStore.get(PROXY_KEY)) return tabStore.get(PROXY_WS_KEY); try { return localStorage.getItem(WS_KEY); } catch { return null; } },
  setWorkspace: (w: string | null) => { if (tabStore.get(PROXY_KEY)) return tabStore.set(PROXY_WS_KEY, w); try { w ? localStorage.setItem(WS_KEY, w) : localStorage.removeItem(WS_KEY); } catch { /* storage unavailable */ } },
};

const doRefresh = (proxy: boolean) => fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...(proxy ? { 'X-Proxy': '1' } : {}) }, body: '{}' })
  .then(async (r) => { if (!r.ok) return false; accessToken = (await r.json()).data.accessToken; return true; });

/** Single-flight refresh using the httpOnly cookie. If a "Login as" session has ended, the tab returns to the developer's own login. */
export function refreshAccessToken(): Promise<boolean> {
  refreshing ??= (async () => {
    if (session.proxyName()) {
      if (await doRefresh(true)) return true;
      session.setProxy(null);
    }
    return doRefresh(false);
  })()
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

type Opts = { method?: string; body?: unknown; query?: Record<string, string | number | undefined> };

export async function api<T = unknown>(path: string, opts: Opts = {}, retried = false): Promise<{ data: T; meta?: any }> {
  const qs = opts.query
    ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))
    : '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const ws = session.getWorkspace();
  if (ws) headers['X-Workspace'] = ws;

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}${qs}`, {
      method: opts.method ?? 'GET', headers, credentials: 'include',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No connection. Check your internet and try again.');
  }

  if (res.status === 401 && !retried && !path.startsWith('/auth/login') && (await refreshAccessToken())) {
    return api<T>(path, opts, true);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    if (json?.code === 'WORKSPACE_UNAVAILABLE') session.setWorkspace(null);
    throw new ApiError(res.status, json?.code ?? 'NETWORK', json?.message ?? 'Could not reach the server. Check your connection.', json?.details);
  }
  return { data: json.data as T, meta: json.meta };
}

/** Field-level errors from VALIDATION_FAILED, keyed by field name. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !e.details) return {};
  return Object.fromEntries(e.details.map((d) => [d.field, d.message]));
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (accessToken) h.Authorization = `Bearer ${accessToken}`;
  const ws = session.getWorkspace();
  if (ws) h['X-Workspace'] = ws;
  return h;
}

/** Downloads a protected file (e.g. an Excel template) and saves it with the given name. */
export async function downloadFile(path: string, filename: string, retried = false): Promise<void> {
  const res = await fetch(`/api/v1${path}`, { headers: authHeaders(), credentials: 'include' });
  if (res.status === 401 && !retried && (await refreshAccessToken())) return downloadFile(path, filename, true);
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD_FAILED', 'Could not download the file.');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Uploads one file as multipart/form-data under the field name "file". */
export async function uploadFile<T>(path: string, file: File, retried = false): Promise<{ data: T }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/v1${path}`, { method: 'POST', body: fd, headers: authHeaders(), credentials: 'include' });
  if (res.status === 401 && !retried && (await refreshAccessToken())) return uploadFile<T>(path, file, true);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new ApiError(res.status, json?.code ?? 'NETWORK', json?.message ?? 'Upload failed.', json?.details);
  return { data: json.data as T };
}

export const HIDDEN = '__hidden__';
/** Displays a value that may be hidden by field permissions. */
export const shown = (v: unknown, empty = '-') => (v === HIDDEN ? 'Hidden' : v === null || v === undefined || v === '' ? empty : String(v));

export const refreshAccessTokenPublic = refreshAccessToken;
export const authHeadersPublic = () => authHeaders();
