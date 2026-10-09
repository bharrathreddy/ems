/** Pure result calculation (agreed E2, E3, E6, E9). No database access, so it is easy to test. */
export interface ExamDef { id: number; code: string; name: string; kind: 'fa' | 'sa' | 'unit' | 'prefinal'; term: number | null; max: number; onCard: boolean }
export interface Band { grade: string; min: number; label?: string | null }
export interface ClassRule { formula: 'term' | 'year_end' | 'weights'; faWeight: number; passPct: number; bands: Band[]; display: 'marks' | 'grades' | 'both' }
export interface MarkCell { marks: number | null; absent: boolean }

export function gradeFor(pct: number | null, bands: Band[]) {
  if (pct == null) return null;
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  return sorted.find((b) => pct >= b.min - 1e-9)?.grade ?? sorted[sorted.length - 1]?.grade ?? null;
}
const r1 = (n: number) => Math.round(n * 10) / 10;
const pctOf = (c: MarkCell | undefined, max: number) => (!c ? null : c.absent ? 0 : c.marks == null ? null : (c.marks / max) * 100);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Weighted average of the parts that have marks (so a result exists after the first exams too). */
function blend(fa: number | null, sa: number | null, faWeight: number) {
  if (fa == null && sa == null) return null;
  if (fa == null) return sa;
  if (sa == null) return fa;
  return (fa * faWeight + sa * (100 - faWeight)) / 100;
}

/** One subject's final percentage from its exam marks, using the class formula. */
export function subjectFinal(exams: ExamDef[], cells: Map<number, MarkCell>, rule: ClassRule): number | null {
  const card = exams.filter((e) => e.onCard && (e.kind === 'fa' || e.kind === 'sa'));
  const p = (e: ExamDef) => pctOf(cells.get(e.id), e.max);
  const vals = (list: ExamDef[]) => list.map(p).filter((x): x is number => x != null);
  if (rule.formula === 'term') {
    const terms = [...new Set(card.map((e) => e.term).filter((t): t is number => t != null))].sort();
    const totals = terms.map((t) => blend(avg(vals(card.filter((e) => e.kind === 'fa' && e.term === t))), avg(vals(card.filter((e) => e.kind === 'sa' && e.term === t))), rule.faWeight))
      .filter((x): x is number => x != null);
    return totals.length ? r1(avg(totals)!) : null;
  }
  if (rule.formula === 'year_end') {
    const sas = card.filter((e) => e.kind === 'sa').sort((a, b) => (b.term ?? 0) - (a.term ?? 0));
    const lastSa = sas.find((e) => p(e) != null);
    return (() => { const x = blend(avg(vals(card.filter((e) => e.kind === 'fa'))), lastSa ? p(lastSa) : null, rule.faWeight); return x == null ? null : r1(x); })();
  }
  const x = blend(avg(vals(card.filter((e) => e.kind === 'fa'))), avg(vals(card.filter((e) => e.kind === 'sa'))), rule.faWeight);
  return x == null ? null : r1(x);
}

/** Competition ranking: equal scores share a rank, the next rank skips (1, 1, 3). */
export function rank<T>(items: T[], score: (t: T) => number | null): Map<T, number> {
  const scored = items.filter((t) => score(t) != null).sort((a, b) => score(b)! - score(a)!);
  const out = new Map<T, number>();
  scored.forEach((t, i) => out.set(t, i > 0 && Math.abs(score(scored[i - 1])! - score(t)!) < 1e-9 ? out.get(scored[i - 1])! : i + 1));
  return out;
}

export interface StudentResult {
  studentId: number;
  subjects: Array<{ subjectId: number; name: string; cells: Record<string, { marks: number | null; absent: boolean; pct: number | null; grade: string | null }>; finalPct: number | null; grade: string | null; pass: boolean | null }>;
  totalPct: number | null; grade: string | null; failed: number;
  examTotals: Record<string, { marks: number; max: number; pct: number | null }>;
  rankSection?: number; rankClass?: number;
}

export function studentResult(studentId: number, subjects: Array<{ id: number; name: string }>, exams: ExamDef[], marks: Map<string, MarkCell>, rule: ClassRule): StudentResult {
  const rows = subjects.map((s) => {
    const cells = new Map<number, MarkCell>();
    const out: StudentResult['subjects'][number]['cells'] = {};
    for (const e of exams) {
      const c = marks.get(`${e.id}:${s.id}`);
      if (c) cells.set(e.id, c);
      const pct = pctOf(c, e.max);
      out[e.code] = { marks: c ? c.marks : null, absent: !!c?.absent, pct: pct == null ? null : r1(pct), grade: gradeFor(pct, rule.bands) };
    }
    const finalPct = subjectFinal(exams, cells, rule);
    return { subjectId: s.id, name: s.name, cells: out, finalPct, grade: gradeFor(finalPct, rule.bands), pass: finalPct == null ? null : finalPct >= rule.passPct };
  });
  const finals = rows.map((r) => r.finalPct).filter((x): x is number => x != null);
  const totalPct = finals.length ? r1(avg(finals)!) : null;
  const examTotals: StudentResult['examTotals'] = {};
  for (const e of exams) {
    let got = 0, max = 0, any = false;
    for (const s of subjects) { const c = marks.get(`${e.id}:${s.id}`); if (c && (c.absent || c.marks != null)) { any = true; got += c.absent ? 0 : c.marks!; max += e.max; } }
    examTotals[e.code] = { marks: r1(got), max, pct: any && max ? r1((got / max) * 100) : null };
  }
  return { studentId, subjects: rows, totalPct, grade: gradeFor(totalPct, rule.bands), failed: rows.filter((r) => r.pass === false).length, examTotals };
}
