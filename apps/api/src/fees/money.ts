/** Money is handled in integer paise everywhere in code; DECIMAL(12,2) strings only at the database edge. */
export type Paise = number;

export function toPaise(v: string | number | null | undefined): Paise {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Math.round(v * 100);
  const [r, p = ''] = v.trim().split('.');
  const sign = r.startsWith('-') ? -1 : 1;
  return sign * (Math.abs(parseInt(r, 10) || 0) * 100 + parseInt((p + '00').slice(0, 2), 10));
}
export const toDb = (p: Paise) => (p / 100).toFixed(2);
export const rupees = (p: Paise) => p / 100;

/** Indian grouping: 1,23,456 (no paise shown when whole rupees). */
export function formatINR(p: Paise, symbol = '₹') {
  const neg = p < 0; const abs = Math.abs(p);
  const r = Math.floor(abs / 100); const ps = abs % 100;
  const s = String(r);
  const grouped = s.length > 3 ? s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3) : s;
  return `${neg ? '-' : ''}${symbol}${grouped}${ps ? '.' + String(ps).padStart(2, '0') : ''}`;
}

/**
 * Rule F12 to F14: split net tuition equally in whole hundreds; the first installment absorbs the remainder.
 *   27,000 / 4 -> 6,900 + 6,700 + 6,700 + 6,700
 */
export function splitInstallments(net: Paise, count: number): Paise[] {
  if (count < 1) throw new Error('count must be >= 1');
  if (net <= 0) return Array(count).fill(0);
  const hundred = 100 * 100;
  const base = Math.floor(net / count / hundred) * hundred;
  return [net - base * (count - 1), ...Array(count - 1).fill(base)];
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function twoDigits(n: number) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`; }
function threeDigits(n: number) {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ');
}
/** Indian system words for receipts: 1,25,000 -> "One Lakh Twenty Five Thousand Rupees Only". */
export function amountInWords(p: Paise): string {
  let n = Math.floor(Math.abs(p) / 100);
  const paise = Math.abs(p) % 100;
  if (n === 0 && paise === 0) return 'Zero Rupees Only';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000); n %= 10_000_000;
  const lakh = Math.floor(n / 100_000); n %= 100_000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  const r = parts.length ? `${parts.join(' ')} Rupees` : '';
  const ps = paise ? `${r ? ' and ' : ''}${twoDigits(paise)} Paise` : '';
  return `${r}${ps} Only`;
}
