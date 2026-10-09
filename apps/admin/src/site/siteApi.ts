import { useQuery } from '@tanstack/react-query';

export interface SiteLink { label: string; href: string; newTab: boolean; external: boolean }
export interface Site {
  enabled: boolean;
  school: { name: string; shortName: string | null; type: string; brandPrimary: string | null; logo: string | null; address: string | null; phone: string | null; email: string | null; whatsapp: string | null };
  menus: { header: SiteLink[]; footer: SiteLink[] };
  contact: { mapEmbedUrl?: string; officeHours?: string };
  social: Record<string, string>;
}
export class NotFound extends Error {}

export async function pub<T>(path: string): Promise<T> {
  const r = await fetch(`/api/v1/public${path}`);
  if (r.status === 404) throw new NotFound();
  const j = await r.json().catch(() => ({ success: false, message: `The server answered with status ${r.status}.` }));
  if (!j.success) throw new Error(j.message ?? 'Could not load this page.');
  return j.data as T;
}
export const usePub = <T,>(key: string, path: string) => useQuery({ queryKey: ['pub', key], queryFn: () => pub<T>(path), retry: (n, e) => !(e instanceof NotFound) && n < 1 });
export const img = (id?: string | null) => (id ? `/api/v1/files/${id}` : '');
export const fmtDay = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
