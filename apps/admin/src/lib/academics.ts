import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Section { id: number; name: string; is_active: number }
export interface Klass { id: number; name: string; level_order: number; is_active: number; sections: Section[] }

export const useClasses = (enabled = true) =>
  useQuery({ queryKey: ['classes'], enabled, staleTime: 5 * 60_000, queryFn: () => api<Klass[]>('/classes').then((r) => r.data) });

export const fullName = (s: { first_name: string; last_name?: string | null }) => [s.first_name, s.last_name].filter(Boolean).join(' ');
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
export const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
