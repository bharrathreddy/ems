import type { Paise } from '../fees/money';

export type Kind = 'earning' | 'deduction' | 'employer';
export type Calc = 'fixed' | 'pct_basic' | 'pct_gross';

export interface PayItem {
  componentId: number; code: string; name: string; kind: Kind; calc: Calc;
  /** Paise for fixed amounts; percent x 100 (e.g. 1200 = 12%) for percentages. */
  value: number;
  maxAmount: Paise | null; prorate: boolean; isBasic: boolean; sortOrder: number;
}
export interface Adjustment { label: string; kind: 'earning' | 'deduction'; amount: Paise }
export interface SlipLine { componentId: number | null; code: string; name: string; kind: Kind; amount: Paise; full: Paise }
export interface Slip {
  lines: SlipLine[]; gross: Paise; totalDeductions: Paise; employerTotal: Paise; net: Paise; paidDays: number; lopDays: number; divisor: number;
}

/** Whole rupees, as on most Indian payslips. */
const rupee = (p: number) => Math.round(p / 100) * 100;
const cap = (p: number, max: Paise | null) => (max != null && max > 0 ? Math.min(p, max) : p);
const pct = (base: number, v: number) => (base * v) / 10000;

/**
 * Agreed R6 rules:
 * - every pay item is a fixed amount or a percentage (earnings: of Basic; deductions and employer
 *   contributions: of Basic or of Gross), with an optional cap;
 * - loss-of-pay days are entered by the accountant; fixed items marked "prorate" are reduced by
 *   (divisor - LOP) / divisor, and percentages follow the reduced Basic or Gross;
 * - "% of Gross" uses the salary gross (pay items only), not one-off additions.
 */
export function calculateSlip(items: PayItem[], lopDays: number, divisor: number, adjustments: Adjustment[] = []): Slip {
  if (divisor <= 0) throw new Error('divisor must be positive');
  const lop = Math.min(Math.max(lopDays, 0), divisor);
  const factor = (divisor - lop) / divisor;
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.componentId - b.componentId);
  const basic = sorted.find((i) => i.isBasic && i.kind === 'earning');
  const basicFull = basic ? basic.value : 0;
  const basicEarned = rupee(basicFull * factor);
  const lines: SlipLine[] = [];

  for (const i of sorted.filter((x) => x.kind === 'earning')) {
    let full: number, amount: number;
    if (i.isBasic) { full = basicFull; amount = basicEarned; }
    else if (i.calc === 'pct_basic') { full = pct(basicFull, i.value); amount = pct(basicEarned, i.value); }
    else { full = i.value; amount = i.prorate ? i.value * factor : i.value; }
    lines.push({ componentId: i.componentId, code: i.code, name: i.name, kind: 'earning', full: rupee(cap(full, i.maxAmount)), amount: rupee(cap(amount, i.maxAmount)) });
  }
  const salaryGross = lines.reduce((t, l) => t + l.amount, 0);
  const salaryGrossFull = lines.reduce((t, l) => t + l.full, 0);

  for (const i of sorted.filter((x) => x.kind !== 'earning')) {
    let full: number, amount: number;
    if (i.calc === 'pct_basic') { full = pct(basicFull, i.value); amount = pct(basicEarned, i.value); }
    else if (i.calc === 'pct_gross') { full = pct(salaryGrossFull, i.value); amount = pct(salaryGross, i.value); }
    else { full = i.value; amount = i.prorate ? i.value * factor : i.value; }
    lines.push({ componentId: i.componentId, code: i.code, name: i.name, kind: i.kind, full: rupee(cap(full, i.maxAmount)), amount: rupee(cap(amount, i.maxAmount)) });
  }
  for (const a of adjustments) {
    lines.push({ componentId: null, code: '', name: a.label, kind: a.kind, full: a.amount, amount: a.amount });
  }
  const sum = (k: Kind) => lines.filter((l) => l.kind === k).reduce((t, l) => t + l.amount, 0);
  const gross = sum('earning'), totalDeductions = sum('deduction'), employerTotal = sum('employer');
  return { lines, gross, totalDeductions, employerTotal, net: gross - totalDeductions, paidDays: divisor - lop, lopDays: lop, divisor };
}
