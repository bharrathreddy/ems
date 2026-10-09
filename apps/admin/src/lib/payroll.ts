import { ApiError, authHeadersPublic, refreshAccessTokenPublic } from './api';

export type Kind = 'earning' | 'deduction' | 'employer';
export type Calc = 'fixed' | 'pct_basic' | 'pct_gross';
export interface Component { id: number; code: string; name: string; kind: Kind; calc: Calc; defaultValue: number; maxAmount: number | null; prorate: boolean; isBasic: boolean; isActive: boolean; sortOrder: number; inUse: boolean }
export interface Line { componentId: number; value: number }
export interface Preview { gross: number; deductions: number; employer: number; net: number }
export interface Template { id: number; name: string; isActive: boolean; lines: Line[]; preview: Preview }

export const KIND_LABEL: Record<Kind, string> = { earning: 'Earning', deduction: 'Deduction', employer: 'Paid by school' };
export const CALC_LABEL: Record<Calc, string> = { fixed: 'Fixed amount', pct_basic: '% of Basic', pct_gross: '% of Gross' };
export const DIVISOR_LABEL: Record<string, string> = { month_days: 'Days in the month (28 to 31)', thirty: 'Always 30 days', working_days: 'School working days in the month' };

/** Same rules as the server (apps/api/src/payroll/calc.ts), for a live preview while typing. Whole rupees. */
export function previewSalary(components: Component[], lines: Line[], lopDays = 0, divisor = 30): Preview & { rows: Array<{ c: Component; amount: number }> } {
  const byId = new Map(components.map((c) => [c.id, c]));
  const items = lines.map((l) => ({ c: byId.get(l.componentId)!, v: l.value })).filter((x) => x.c && x.c.isActive)
    .sort((a, b) => a.c.sortOrder - b.c.sortOrder || a.c.id - b.c.id);
  const f = (divisor - Math.min(lopDays, divisor)) / divisor;
  const cap = (v: number, m: number | null) => (m != null && m > 0 ? Math.min(v, m) : v);
  const basicFull = items.find((x) => x.c.isBasic)?.v ?? 0;
  const basic = Math.round(basicFull * f);
  const rows: Array<{ c: Component; amount: number }> = [];
  for (const x of items.filter((i) => i.c.kind === 'earning')) {
    const a = x.c.isBasic ? basic : x.c.calc === 'pct_basic' ? (basic * x.v) / 100 : x.c.prorate ? x.v * f : x.v;
    rows.push({ c: x.c, amount: Math.round(cap(a, x.c.maxAmount)) });
  }
  const gross = rows.reduce((t, r) => t + r.amount, 0);
  for (const x of items.filter((i) => i.c.kind !== 'earning')) {
    const a = x.c.calc === 'pct_basic' ? (basic * x.v) / 100 : x.c.calc === 'pct_gross' ? (gross * x.v) / 100 : x.c.prorate ? x.v * f : x.v;
    rows.push({ c: x.c, amount: Math.round(cap(a, x.c.maxAmount)) });
  }
  const sum = (k: Kind) => rows.filter((r) => r.c.kind === k).reduce((t, r) => t + r.amount, 0);
  return { rows, gross, deductions: sum('deduction'), employer: sum('employer'), net: gross - sum('deduction') };
}

export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const prevMonthOf = (today: string) => { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCDate(0); return d.toISOString().slice(0, 7); };

/** Opens a protected PDF (payslip, bill) in a new tab. */
export async function openProtected(path: string, retried = false): Promise<void> {
  const w = retried ? null : window.open('', '_blank');
  const res = await fetch(`/api/v1${path}`, { headers: authHeadersPublic(), credentials: 'include' });
  if (res.status === 401 && !retried && (await refreshAccessTokenPublic())) { w?.close(); return openProtected(path, true); }
  if (!res.ok) { w?.close(); throw new ApiError(res.status, 'OPEN_FAILED', 'Could not open the file.'); }
  const url = URL.createObjectURL(await res.blob());
  if (w) w.location.href = url; else window.open(url, '_blank') ?? (window.location.href = url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
