import { gradeFor, rank, subjectFinal, type ClassRule, type ExamDef } from '../src/exams/results';

// Pure calculation checks (no database needed, but they run with the e2e suite).
const E = (id: number, code: string, kind: 'fa' | 'sa', term: number, max: number): ExamDef => ({ id, code, name: code, kind, term, max, onCard: true });
const exams = [E(1, 'FA1', 'fa', 1, 20), E(2, 'FA2', 'fa', 1, 20), E(3, 'SA1', 'sa', 1, 80), E(4, 'FA3', 'fa', 2, 20), E(5, 'FA4', 'fa', 2, 20), E(6, 'SA2', 'sa', 2, 80)];
const high = [{ grade: 'A1', min: 91 }, { grade: 'A2', min: 81 }, { grade: 'B1', min: 71 }, { grade: 'B2', min: 61 }, { grade: 'C1', min: 51 }, { grade: 'C2', min: 41 }, { grade: 'D', min: 35 }, { grade: 'E', min: 0 }];
const rule = (formula: ClassRule['formula']): ClassRule => ({ formula, faWeight: 20, passPct: 35, bands: high, display: 'both' });
const cells = (m: Record<number, number | 'AB'>) => new Map(Object.entries(m).map(([k, v]) => [Number(k), v === 'AB' ? { marks: null, absent: true } : { marks: v as number, absent: false }]));

describe('Result calculation', () => {
  it('grades by percentage bands', () => {
    expect([gradeFor(91, high), gradeFor(90.9, high), gradeFor(35, high), gradeFor(34.9, high), gradeFor(null, high)]).toEqual(['A1', 'A2', 'D', 'E', null]);
  });
  it('term formula: (avg of 2 FAs out of 20) + SA out of 80 per term, final = average of terms', () => {
    // Term 1: FAs 18,16 -> avg 17/20; SA1 60/80 -> 77. Term 2: FAs 20,20 -> 20; SA2 72 -> 92. Final 84.5
    expect(subjectFinal(exams, cells({ 1: 18, 2: 16, 3: 60, 4: 20, 5: 20, 6: 72 }), rule('term'))).toBe(84.5);
  });
  it('gives an interim result after the first exams, and AB counts as zero', () => {
    expect(subjectFinal(exams, cells({ 1: 18, 2: 'AB' }), rule('term'))).toBe(45);
    expect(subjectFinal(exams, cells({}), rule('term'))).toBeNull();
  });
  it('year-end formula: average of all FAs + SA2', () => {
    // FAs 18,16,20,20 -> 18.5/20 ; SA2 72/80 -> 18.5 + 72 = 90.5
    expect(subjectFinal(exams, cells({ 1: 18, 2: 16, 3: 60, 4: 20, 5: 20, 6: 72 }), rule('year_end'))).toBe(90.5);
  });
  it('ranks with ties sharing a place', () => {
    const r = rank(['a', 'b', 'c', 'd'], (x) => ({ a: 90, b: 95, c: 90, d: null } as any)[x]);
    expect([r.get('b'), r.get('a'), r.get('c'), r.get('d')]).toEqual([1, 2, 2, undefined]);
  });
});
