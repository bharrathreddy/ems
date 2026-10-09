import { api, ApiError } from './api';

/**
 * Attendance works without a connection (agreed): a save that cannot reach the server is kept
 * on the phone and sent automatically when the connection returns. Sends are idempotent on the
 * server, so sending twice is harmless.
 */
const KEY = 'ems.attendance.queue';
export interface QueuedMark { sectionId: number; sectionName: string; date: string; entries: Array<{ studentId: string; status: string }>; savedAt: string }

const read = (): QueuedMark[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
const write = (q: QueuedMark[]) => { try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* storage full or blocked */ } window.dispatchEvent(new Event('ems-queue')); };
export const queued = read;

export function enqueue(m: QueuedMark) {
  write([...read().filter((x) => !(x.sectionId === m.sectionId && x.date === m.date)), m]);
}

/** True when the error means "no connection" rather than "the server said no". */
export const isOffline = (e: unknown) => !navigator.onLine || (e instanceof ApiError && (e.status === 0 || e.status >= 502));

let flushing = false;
export async function flushQueue(): Promise<{ sent: number; failed: Array<{ item: QueuedMark; message: string }> }> {
  if (flushing || !navigator.onLine) return { sent: 0, failed: [] };
  flushing = true;
  const failed: Array<{ item: QueuedMark; message: string }> = [];
  let sent = 0;
  try {
    for (const item of read()) {
      try {
        await api(`/attendance/sections/${item.sectionId}`, { method: 'PUT', body: { date: item.date, entries: item.entries } });
        write(read().filter((x) => !(x.sectionId === item.sectionId && x.date === item.date)));
        sent++;
      } catch (e) {
        if (isOffline(e)) break;
        // The server refused (e.g. edit window closed): drop it and report, so it does not retry forever.
        write(read().filter((x) => !(x.sectionId === item.sectionId && x.date === item.date)));
        failed.push({ item, message: (e as Error).message });
      }
    }
  } finally { flushing = false; }
  return { sent, failed };
}

/** Last-loaded class list per section/day, so a teacher can still mark when the connection drops. */
export const cacheRoster = (sectionId: number, date: string, data: unknown) => { try { localStorage.setItem(`ems.att.roster.${sectionId}.${date}`, JSON.stringify(data)); } catch { /* ignore */ } };
export const cachedRoster = <T,>(sectionId: number, date: string): T | null => { try { const v = localStorage.getItem(`ems.att.roster.${sectionId}.${date}`); return v ? JSON.parse(v) : null; } catch { return null; } };

/** Started once by the app shell: sends saved sheets on reconnect and every minute, on any screen. */
export function startAutoFlush(report: (r: Awaited<ReturnType<typeof flushQueue>>) => void) {
  const go = () => { if (read().length) flushQueue().then(report).catch(() => undefined); };
  window.addEventListener('online', go);
  const t = window.setInterval(go, 60_000);
  go();
  return () => { window.removeEventListener('online', go); window.clearInterval(t); };
}
