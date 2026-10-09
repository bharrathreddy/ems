import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface ExamDef { id: number; code: string; name: string; kind: 'fa' | 'sa' | 'unit' | 'prefinal'; term: number | null; maxMarks: number; onReportCard: boolean; classIds: number[] }
export interface ExamSetup {
  year: { id: number; name: string; editable: boolean }; exams: ExamDef[];
  scales: Array<{ id: number; name: string; bands: Array<{ grade: string; min: number; label: string | null }> }>;
  classes: Array<{ id: number; name: string; assessment: 'marks' | 'skills'; gradeScaleId: number | null; display: 'marks' | 'grades' | 'both'; formula: 'term' | 'year_end' | 'weights'; faWeight: number; passPct: number }>;
  coAreas: Array<{ id: number; name: string; classId: number | null }>; skills: Array<{ id: number; group: string; name: string; classId: number | null }>;
}
export const useExamSetup = (enabled = true) => useQuery({ queryKey: ['exam-setup'], enabled, queryFn: () => api<ExamSetup>('/exams/setup').then((r) => r.data) });

/** Exams a teacher works with (no exams.view needed): taken from the sheets endpoint per exam via the schedule list. */
export const SHEET_STATUS: Record<string, { label: string; tone: 'neutral' | 'attention' | 'brand' | 'danger' }> = {
  draft: { label: 'Not submitted', tone: 'neutral' }, submitted: { label: 'Waiting for approval', tone: 'attention' }, approved: { label: 'Approved', tone: 'brand' }, returned: { label: 'Sent back', tone: 'danger' },
};
export const RATINGS = [['excellent', 'Excellent'], ['good', 'Good'], ['needs_practice', 'Needs practice']] as const;

import { ApiError, authHeadersPublic, refreshAccessTokenPublic } from './api';

/** Open an authenticated PDF (report card) in a new tab; on phones, share it (e.g. WhatsApp). */
export async function openPdf(path: string, name: string, share = false, retried = false): Promise<void> {
  const w = share ? null : window.open('', '_blank');
  const res = await fetch(`/api/v1${path}`, { headers: authHeadersPublic(), credentials: 'include' });
  if (res.status === 401 && !retried && (await refreshAccessTokenPublic())) { w?.close(); return openPdf(path, name, share, true); }
  if (!res.ok) { w?.close(); throw new ApiError(res.status, 'PDF_FAILED', 'Could not create the report card.'); }
  const blob = await res.blob();
  const file = new File([blob], name, { type: 'application/pdf' });
  if (share && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }).catch(() => undefined); return; }
  const url = URL.createObjectURL(blob);
  if (w) w.location.href = url; else window.open(url, '_blank') ?? (window.location.href = url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
