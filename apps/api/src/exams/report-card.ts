import PDFDocument from 'pdfkit';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Database } from '../database/database.module';
import { STORAGE_DIR } from '../common/files.service';
import { iso, SchoolCalendar, summarise, type AttStatus } from '../attendance/calendar';
import type { ExamsService } from './exams.service';

const FONT_DIR = [resolve(__dirname, '../../assets/fonts'), resolve(__dirname, '../../../assets/fonts')].find((d) => existsSync(join(d, 'DejaVuSans.ttf')))!;
const RATING: Record<string, string> = { excellent: 'Excellent', good: 'Good', needs_practice: 'Needs practice' };

async function image(db: Database, fileId: number | null): Promise<Buffer | null> {
  if (!fileId) return null;
  const f = await db.selectFrom('files').select(['storage_path', 'mime_type']).where('id', '=', fileId).executeTakeFirst();
  if (!f || !/jpe?g|png/.test(f.mime_type)) return null; // PDFKit supports JPEG and PNG
  const p = join(STORAGE_DIR, f.storage_path);
  return existsSync(p) ? readFileSync(p) : null;
}

/** Everything one report card shows. `publishedOnly` = what families may see. */
export async function reportCardData(db: Database, exams: ExamsService, yearId: number, studentId: number, publishedOnly: boolean) {
  const st = await db.selectFrom('students as s').innerJoin('families as f', 'f.id', 's.family_id')
    .innerJoin('enrollments as en', (j) => j.onRef('en.student_id', '=', 's.id').on('en.academic_year_id', '=', yearId))
    .innerJoin('sections as sec', 'sec.id', 'en.section_id').innerJoin('classes as c', 'c.id', 'en.class_id')
    .select(['s.id', 's.public_id', 's.first_name', 's.last_name', 's.admission_no', 's.dob', 's.photo_file_id', 'f.father_name', 'f.mother_name', 'en.roll_no', 'en.section_id', 'en.class_id', 'c.name as class_name', 'sec.name as section'])
    .where('s.id', '=', studentId).executeTakeFirstOrThrow();
  const year = await db.selectFrom('academic_years').select(['name']).where('id', '=', yearId).executeTakeFirstOrThrow();
  const inst = await db.selectFrom('institution_settings').select(['name', 'address', 'phone', 'contact_email', 'brand_primary', 'logo_file_id']).where('id', '=', 1).executeTakeFirstOrThrow();
  const rule = await exams.rule(yearId, st.class_id);
  const cal = await SchoolCalendar.load(db, yearId);
  // Term 1 ends with the last SA1 paper (or mid-year if no schedule), term 2 is the rest.
  const sa1 = await db.selectFrom('exam_schedule as s').innerJoin('exams as e', 'e.id', 's.exam_id').select((eb) => eb.fn.max('s.exam_date').as('d'))
    .where('e.academic_year_id', '=', yearId).where('e.kind', '=', 'sa').where('e.term', '=', 1).where('s.class_id', '=', st.class_id).executeTakeFirst();
  const mid = iso(sa1?.d as any) ?? new Date((new Date(cal.start).getTime() + new Date(cal.end).getTime()) / 2).toISOString().slice(0, 10);
  const att = (await db.selectFrom('student_attendance').select(['att_date', 'status']).where('student_id', '=', studentId).where('academic_year_id', '=', yearId).execute())
    .map((r) => ({ date: iso(r.att_date)!, status: r.status as AttStatus }));
  const terms = [1, 2];
  const [remarks, coAreas, coGrades] = await Promise.all([
    db.selectFrom('term_remarks').select(['term', 'remarks']).where('student_id', '=', studentId).where('academic_year_id', '=', yearId).execute(),
    db.selectFrom('co_areas').select(['id', 'name']).where('academic_year_id', '=', yearId).where((eb) => eb.or([eb('class_id', 'is', null), eb('class_id', '=', st.class_id)])).orderBy('position').execute(),
    db.selectFrom('co_grades').select(['area_id', 'term', 'grade']).where('student_id', '=', studentId).execute(),
  ]);
  // A term's class-teacher entries are visible to families once that term's SA is published.
  const pubTerms = new Set((await db.selectFrom('exam_publications as p').innerJoin('exams as e', 'e.id', 'p.exam_id').select('e.term')
    .where('p.section_id', '=', st.section_id).where('e.academic_year_id', '=', yearId).where('e.kind', '=', 'sa').execute()).map((r) => r.term));
  const termVisible = (t: number) => !publishedOnly || pubTerms.has(t);
  const base = {
    yearName: year.name, institution: { ...inst, logo: await image(db, inst.logo_file_id) },
    student: { id: st.public_id, name: [st.first_name, st.last_name].filter(Boolean).join(' '), admissionNo: st.admission_no, rollNo: st.roll_no, className: `${st.class_name} ${st.section}`,
      father: st.father_name, mother: st.mother_name, dob: iso(st.dob), photo: await image(db, st.photo_file_id) },
    assessment: rule.assessment, display: rule.display, bands: rule.bands, passPct: rule.passPct,
    attendance: terms.map((t) => ({ term: t, ...summarise(att.filter((a) => (t === 1 ? a.date <= mid : a.date > mid)), cal) })).filter((a) => termVisible(a.term)),
    remarks: terms.filter(termVisible).map((t) => ({ term: t, text: remarks.find((r) => r.term === t)?.remarks ?? '' })),
    co: coAreas.map((a) => ({ name: a.name, terms: terms.map((t) => (termVisible(t) ? coGrades.find((g) => g.area_id === a.id && g.term === t)?.grade ?? '' : '')) })),
  };
  if (rule.assessment === 'skills') {
    const skills = await db.selectFrom('skills').select(['id', 'group_name', 'name']).where('academic_year_id', '=', yearId).where((eb) => eb.or([eb('class_id', 'is', null), eb('class_id', '=', st.class_id)])).orderBy('position').execute();
    const ratings = await db.selectFrom('skill_ratings').select(['skill_id', 'term', 'rating']).where('student_id', '=', studentId).execute();
    return { ...base, skills: skills.map((s) => ({ group: s.group_name, name: s.name, terms: terms.map((t) => (termVisible(t) ? RATING[ratings.find((r) => r.skill_id === s.id && r.term === t)?.rating ?? ''] ?? '' : '')) })), marks: null };
  }
  const cr = await exams.classResults(yearId, st.class_id, publishedOnly);
  const mine = cr.results.find((r) => r.result.studentId === studentId)!;
  const sectionSize = cr.results.filter((r) => r.sectionId === st.section_id && r.result.totalPct != null).length;
  return { ...base, skills: null, marks: { exams: mine.exams.filter((e) => e.onCard), allExams: mine.exams, result: mine.result, sectionSize, classSize: cr.classSize } };
}

type Card = Awaited<ReturnType<typeof reportCardData>>;

/** A4 report card(s); several students make one PDF with a page each (for printing a whole section). */
export function renderReportCards(cards: Card[]): Promise<Buffer> {
  return new Promise((done, fail) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, autoFirstPage: false, info: { Title: 'Progress report' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => done(Buffer.concat(chunks))); doc.on('error', fail);
    doc.registerFont('R', join(FONT_DIR, 'DejaVuSans.ttf')); doc.registerFont('B', join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
    for (const c of cards) page(doc, c);
    doc.end();
  });
}

function page(doc: PDFKit.PDFDocument, c: Card) {
  doc.addPage();
  const brand = c.institution.brand_primary || '#1F5F4A', ink = '#17201C', muted = '#5B6660', line = '#D5DBD3', soft = '#F1F4EF';
  const W = doc.page.width, L = 36, R = W - 36, CW = R - L;
  doc.rect(0, 0, W, 8).fill(brand);
  let x0 = L;
  if (c.institution.logo) { try { doc.image(c.institution.logo, L, 22, { fit: [46, 46] }); x0 = L + 56; } catch { /* unreadable logo */ } }
  doc.fillColor(ink).font('B').fontSize(16).text(c.institution.name, x0, 24, { width: CW * 0.68 - (x0 - L) });
  doc.font('R').fontSize(8).fillColor(muted).text([c.institution.address, c.institution.phone && `Ph: ${c.institution.phone}`].filter(Boolean).join('  ·  '), x0, doc.y + 2, { width: CW * 0.68 - (x0 - L) });
  doc.font('B').fontSize(11).fillColor(brand).text(c.assessment === 'skills' ? 'PROGRESS REPORT' : 'PROGRESS REPORT', L + CW * 0.68, 26, { width: CW * 0.32, align: 'right' });
  doc.font('R').fontSize(9).fillColor(ink).text(`Academic year ${c.yearName}`, L + CW * 0.68, 42, { width: CW * 0.32, align: 'right' });
  let y = Math.max(doc.y, 72) + 10;
  doc.moveTo(L, y).lineTo(R, y).strokeColor(line).lineWidth(0.8).stroke();
  y += 12;

  // Student details with photo
  const photoW = 64, photoH = 78;
  const fields: Array<[string, string]> = [['Student', c.student.name], ['Class & section', c.student.className], ['Admission no', c.student.admissionNo], ['Roll no', c.student.rollNo ?? '-'],
    ['Father', c.student.father ?? '-'], ['Mother', c.student.mother ?? '-'], ['Date of birth', c.student.dob ? new Date(`${c.student.dob}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '-']];
  const colW = (CW - photoW - 16) / 2;
  fields.forEach(([k, v], i) => {
    const fx = L + (i % 2) * colW, fy = y + Math.floor(i / 2) * 22;
    doc.font('R').fontSize(7).fillColor(muted).text(k, fx, fy, { width: colW - 8 });
    doc.font('B').fontSize(9.5).fillColor(ink).text(v, fx, fy + 8, { width: colW - 8, lineBreak: false, ellipsis: true });
  });
  if (c.student.photo) { try { doc.image(c.student.photo, R - photoW, y, { fit: [photoW, photoH], align: 'center' }); } catch { doc.rect(R - photoW, y, photoW, photoH).strokeColor(line).stroke(); } }
  else doc.rect(R - photoW, y, photoW, photoH).strokeColor(line).stroke();
  y += Math.max(Math.ceil(fields.length / 2) * 22, photoH) + 12;

  const table = (cols: Array<{ label: string; sub?: string; w: number; align?: 'left' | 'center' | 'right' }>, rows: Array<Array<{ text: string; bold?: boolean; color?: string }>>, startY: number, opts: { totalRow?: boolean } = {}) => {
    let ty = startY;
    doc.rect(L, ty, CW, 24).fill(soft);
    let cx = L;
    for (const col of cols) {
      doc.font('B').fontSize(8).fillColor(ink).text(col.label, cx + 4, ty + (col.sub ? 4 : 8), { width: col.w - 8, align: col.align ?? 'center' });
      if (col.sub) doc.font('R').fontSize(6.5).fillColor(muted).text(col.sub, cx + 4, ty + 14, { width: col.w - 8, align: col.align ?? 'center' });
      cx += col.w;
    }
    ty += 24;
    rows.forEach((row, ri) => {
      const isTotal = opts.totalRow && ri === rows.length - 1;
      if (isTotal) doc.rect(L, ty, CW, 18).fill(soft);
      let rx = L;
      row.forEach((cell, ci) => {
        doc.font(cell.bold || isTotal ? 'B' : 'R').fontSize(8.5).fillColor(cell.color ?? ink).text(cell.text, rx + 4, ty + 5, { width: cols[ci].w - 8, align: cols[ci].align ?? 'center', lineBreak: false, ellipsis: true });
        rx += cols[ci].w;
      });
      ty += 18;
      doc.moveTo(L, ty).lineTo(R, ty).strokeColor(line).lineWidth(0.5).stroke();
    });
    return ty;
  };

  if (c.marks) {
    const ex = c.marks.exams;
    const showMarks = c.display !== 'grades', showGrades = c.display !== 'marks';
    const subjW = 110, finalW = showMarks ? 52 : 0, gradeW = showGrades ? 44 : 0;
    const exW = (CW - subjW - finalW - gradeW) / Math.max(1, ex.length);
    const cols = [{ label: 'Subject', w: subjW, align: 'left' as const }, ...ex.map((e) => ({ label: e.code, sub: showMarks ? `out of ${e.max}` : undefined, w: exW })),
      ...(showMarks ? [{ label: 'Final', sub: 'out of 100', w: finalW }] : []), ...(showGrades ? [{ label: 'Grade', w: gradeW }] : [])];
    const res = c.marks.result;
    type Cell = { text: string; bold?: boolean; color?: string };
    const rows: Cell[][] = res.subjects.map((s): Cell[] => [
      { text: s.name, bold: true },
      ...ex.map((e) => { const cell = s.cells[e.code]; return { text: !cell || (cell.marks == null && !cell.absent) ? '' : cell.absent ? 'AB' : showMarks ? String(cell.marks) : cell.grade ?? '', color: cell?.absent ? '#B42318' : undefined }; }),
      ...(showMarks ? [{ text: s.finalPct == null ? '' : String(s.finalPct), color: s.pass === false ? '#B42318' : undefined, bold: true }] : []),
      ...(showGrades ? [{ text: s.grade ?? '', bold: true, color: s.pass === false ? '#B42318' : undefined }] : []),
    ]);
    rows.push([{ text: 'Total' }, ...ex.map((e) => { const t = res.examTotals[e.code]; return { text: t.pct == null ? '' : showMarks ? `${t.marks}/${t.max}` : `${t.pct}%` }; }),
      ...(showMarks ? [{ text: res.totalPct == null ? '' : `${res.totalPct}%` }] : []), ...(showGrades ? [{ text: res.grade ?? '' }] : [])]);
    y = table(cols, rows, y, { totalRow: true }) + 10;
    const summary = [
      res.totalPct != null && showMarks ? `Overall: ${res.totalPct}%` : null, res.grade && showGrades ? `Grade ${res.grade}` : null,
      res.rankSection ? `Rank in section: ${res.rankSection} of ${c.marks.sectionSize}` : null, res.rankClass ? `Rank in class: ${res.rankClass} of ${c.marks.classSize}` : null,
      res.totalPct == null ? null : res.failed ? `Needs improvement in ${res.failed} subject${res.failed > 1 ? 's' : ''} (below ${c.passPct}%)` : 'Passed in all subjects',
    ].filter(Boolean).join('     ');
    doc.font('B').fontSize(9).fillColor(ink).text(summary, L, y, { width: CW }); y = doc.y + 12;
  }

  if (c.skills) {
    const cols = [{ label: 'Area', w: 110, align: 'left' as const }, { label: 'Skill', w: CW - 110 - 2 * 90, align: 'left' as const }, { label: 'Term 1', w: 90 }, { label: 'Term 2', w: 90 }];
    let last = '';
    y = table(cols, c.skills.map((s) => { const g = s.group !== last ? s.group : ''; last = s.group; return [{ text: g, bold: true }, { text: s.name }, { text: s.terms[0] }, { text: s.terms[1] }]; }), y) + 12;
  }

  // Co-scholastic and attendance side by side
  const half = (CW - 16) / 2;
  if (c.co.length) {
    const startY = y;
    doc.font('B').fontSize(9.5).fillColor(ink).text('Co-scholastic areas', L, y); y += 14;
    let ty = y;
    for (const a of c.co) {
      doc.font('R').fontSize(8.5).fillColor(ink).text(a.name, L, ty, { width: half - 80 });
      doc.font('B').text(a.terms[0] || '-', L + half - 80, ty, { width: 40, align: 'center' }).text(a.terms[1] || '-', L + half - 40, ty, { width: 40, align: 'center' });
      ty += 15;
    }
    doc.font('R').fontSize(7).fillColor(muted).text('Term 1', L + half - 80, startY + 2, { width: 40, align: 'center' }).text('Term 2', L + half - 40, startY + 2, { width: 40, align: 'center' });
    const ax = L + half + 16;
    doc.font('B').fontSize(9.5).fillColor(ink).text('Attendance', ax, startY);
    let ay = startY + 14;
    for (const a of c.attendance) {
      doc.font('R').fontSize(8.5).fillColor(ink).text(`Term ${a.term}`, ax, ay, { width: 60 });
      doc.text(a.workingDays ? `${a.presentDays} of ${a.workingDays} days (${a.percentage}%)` : '-', ax + 60, ay, { width: half - 60 });
      ay += 15;
    }
    y = Math.max(ty, ay) + 10;
  }

  const rem = c.remarks.filter((r) => r.text);
  if (rem.length) {
    doc.font('B').fontSize(9.5).fillColor(ink).text("Class teacher's remarks", L, y); y = doc.y + 4;
    for (const r of rem) { doc.font('B').fontSize(8.5).text(`Term ${r.term}: `, L, y, { continued: true }).font('R').text(r.text, { width: CW }); y = doc.y + 4; }
  }

  // Grade key and signatures at the bottom
  const bottom = doc.page.height - 36;
  if (c.marks && c.bands.length) {
    const key = [...c.bands].sort((a, b) => b.min - a.min).map((b, i, arr) => `${b.grade}: ${b.min}-${i === 0 ? 100 : Math.max(b.min, Math.ceil(arr[i - 1].min) - 1)}`).join('   ');
    doc.font('R').fontSize(7).fillColor(muted).text(`Grades (%): ${key}`, L, bottom - 70, { width: CW });
  }
  const sw = (CW - 40) / 3;
  ['Class teacher', 'Principal', 'Parent / guardian'].forEach((s, i) => {
    const sx = L + i * (sw + 20);
    doc.moveTo(sx, bottom - 22).lineTo(sx + sw, bottom - 22).strokeColor(line).stroke();
    doc.font('R').fontSize(8).fillColor(muted).text(s, sx, bottom - 18, { width: sw, align: 'center' });
  });
  doc.rect(0, doc.page.height - 6, W, 6).fill(brand);
}
