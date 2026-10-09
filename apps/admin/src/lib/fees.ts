import { ApiError, refreshAccessTokenPublic, authHeadersPublic } from './api';

/** ₹1,23,456 (paise only when present). */
export function inr(v: number | string | null | undefined) {
  const n = typeof v === 'string' ? Number(v) : v ?? 0;
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
export const todayISO = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

export async function fetchReceiptPdf(publicId: string, retried = false): Promise<Blob> {
  const res = await fetch(`/api/v1/payments/${publicId}/pdf`, { headers: authHeadersPublic(), credentials: 'include' });
  if (res.status === 401 && !retried && (await refreshAccessTokenPublic())) return fetchReceiptPdf(publicId, true);
  if (!res.ok) throw new ApiError(res.status, 'PDF_FAILED', 'Could not create the receipt PDF.');
  return res.blob();
}

const fileName = (receiptNo: string) => `Receipt-${receiptNo.replace(/\//g, '-')}.pdf`;

/** Phones: share sheet with the PDF attached (choose WhatsApp). Computers: download, then attach in WhatsApp. */
export async function shareReceipt(publicId: string, receiptNo: string, text: string) {
  const blob = await fetchReceiptPdf(publicId);
  const file = new File([blob], fileName(receiptNo), { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], text }).catch(() => undefined);
    return 'shared';
  }
  downloadBlob(blob, file.name);
  return 'downloaded';
}
export async function downloadReceipt(publicId: string, receiptNo: string) {
  downloadBlob(await fetchReceiptPdf(publicId), fileName(receiptNo));
}
export async function openReceipt(publicId: string) {
  const w = window.open('', '_blank');
  const url = URL.createObjectURL(await fetchReceiptPdf(publicId));
  if (w) w.location.href = url; else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const whatsappLink = (mobile: string, text: string) => `https://wa.me/91${mobile}?text=${encodeURIComponent(text)}`;

export interface FeeItem {
  id: number; academic_year_id: number; year: string; category: 'tuition' | 'bus' | 'one_time'; installment_no: number | null; label: string;
  due_date: string | null; amount: string; paid_amount: string; balance: string; previous_year: boolean; status: 'paid' | 'waived' | 'partial' | 'due' | 'not_due'; overdue: boolean; waived_amount: string; year_status: string;
}
export interface StudentFees {
  academicYearId: number; configured: boolean;
  account: null | { id: number; plan_key: string; plan_name: string; tuition_gross: string; tuition_discount: string; tuition_concession: string | null; tuition_concession_type_id: number | null;
    bus_route_id: number | null; bus_route: string | null; bus_gross: string; bus_discount: string; bus_concession: string | null; bus_concession_type_id: number | null;
    has_payments: boolean; plan_change_allowed: boolean; details_locked: boolean; year: string };
  items: FeeItem[];
  totals: { thisYear: { amount: number; paid: number; balance: number }; previousYears: number; waived: number; overdue: number; totalDue: number };
  waivers: Array<{ id: number; year: string; amount: string; reason: string; by: string; created_at: string }>;
  payments: Array<{ public_id: string; receipt_no: string; receipt_type: string; payment_date: string; total_amount: string; method: string; status: string; void_reason: string | null; collected_by: string; year: string }>;
}
export const METHOD_LABEL: Record<string, string> = { cash: 'Cash', upi: 'UPI', cheque: 'Cheque', bank_transfer: 'Bank transfer', card: 'Card' };
