import PDFDocument from 'pdfkit';
import { sql } from 'kysely';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { STORAGE_DIR } from '../common/files.service';
import { iso } from '../attendance/calendar';

const FONT_DIR = [resolve(__dirname, '../../assets/fonts'), resolve(__dirname, '../../../assets/fonts')].find((d) => existsSync(join(d, 'DejaVuSans.ttf')))!;

/** Printed when the school has not written its own instructions for an exam. */
export const DEFAULT_HALL_TICKET_NOTE = [
  'Bring this hall ticket to every exam and show it when asked.',
  'Reach the school at least 15 minutes before the exam starts.',
  'Bring your own pens, pencils, eraser, scale and other things you need.',
  'Mobile phones, smart watches and notes are not allowed in the exam hall.',
].join('\n');

async function image(db: Database, fileId: number | null): Promise<Buffer | null> {
  if (!fileId) return null;
  const f = await db.selectFrom('files').select(['storage_path', 'mime_type']).where('id', '=', fileId).executeTakeFirst();
  if (!f || !/jpe?g|png/.test(f.mime_type)) return null;
  const p = join(STORAGE_DIR, f.storage_path);
  return existsSync(p) ? readFileSync(p) : null;
}

export interface Paper { date: string; subject: string; start: string | null; end: string | null }

/** The exam's timetable for one class, in date and time order. */
export async function classPapers(db: Database, examId: number, classId: number): Promise<Paper[]> {
  const rows = await db.selectFrom('exam_schedule as s').innerJoin('subjects as sub', 'sub.id', 's.subject_id')
    .leftJoin('class_subjects as cs', (j) => j.onRef('cs.subject_id', '=', 's.subject_id').onRef('cs.class_id', '=', 's.class_id'))
    .select(['s.exam_date', 's.start_time', 's.end_time', 'sub.name']).where('s.exam_id', '=', examId).where('s.class_id', '=', classId)
    .orderBy('s.exam_date').orderBy('s.start_time').orderBy('cs.display_order').execute();
  const seen = new Set<string>();
  return rows.map((r) => ({ date: iso(r.exam_date)!, subject: r.name, start: r.start_time?.slice(0, 5) ?? null, end: r.end_time?.slice(0, 5) ?? null }))
    .filter((p) => { const k = `${p.date}|${p.subject}|${p.start}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Everything printed on the hall tickets of these students for one exam (students must be enrolled this year). */
export async function hallTicketData(db: Database, examId: number, studentIds: number[]) {
  const exam = await db.selectFrom('exams as e').innerJoin('academic_years as y', 'y.id', 'e.academic_year_id')
    .select(['e.id', 'e.code', 'e.name', 'e.academic_year_id', 'e.hall_ticket_note', 'y.name as year']).where('e.id', '=', examId).executeTakeFirst();
  if (!exam) throw Errors.notFound('Exam');
  const inst = await db.selectFrom('institution_settings').select(['name', 'address', 'phone', 'brand_primary', 'logo_file_id']).where('id', '=', 1).executeTakeFirstOrThrow();
  const students = studentIds.length ? await db.selectFrom('students as s').innerJoin('families as f', 'f.id', 's.family_id')
    .innerJoin('enrollments as en', (j) => j.onRef('en.student_id', '=', 's.id').on('en.academic_year_id', '=', exam.academic_year_id))
    .innerJoin('sections as sec', 'sec.id', 'en.section_id').innerJoin('classes as c', 'c.id', 'en.class_id')
    .select(['s.id', 's.first_name', 's.last_name', 's.admission_no', 's.photo_file_id', 'f.father_name', 'en.roll_no', 'en.class_id', 'c.name as class_name', 'sec.name as section'])
    .where('s.id', 'in', studentIds).orderBy(sql`CAST(en.roll_no AS UNSIGNED)`).orderBy('s.first_name').execute() : [];
  const papers = new Map<number, Paper[]>();
  for (const cid of new Set(students.map((s) => s.class_id))) papers.set(cid, await classPapers(db, examId, cid));
  const logo = await image(db, inst.logo_file_id);
  const out = [];
  for (const s of students) {
    out.push({
      name: [s.first_name, s.last_name].filter(Boolean).join(' '), admissionNo: s.admission_no, rollNo: s.roll_no, className: `${s.class_name} ${s.section}`,
      father: s.father_name, photo: await image(db, s.photo_file_id), papers: papers.get(s.class_id) ?? [],
    });
  }
  return {
    institution: { name: inst.name, address: inst.address, phone: inst.phone, brand: inst.brand_primary || '#1F5F4A', logo },
    exam: { code: exam.code, name: exam.name, year: exam.year }, note: (exam.hall_ticket_note ?? DEFAULT_HALL_TICKET_NOTE).trim(), students: out,
  };
}


type Data = Awaited<ReturnType<typeof hallTicketData>>;

const time12 = (t: string | null) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
const dayOf = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });
const dateOf = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Two hall tickets per A4 page (top and bottom half, with a cut line). */
export function renderHallTickets(d: Data): Promise<Buffer> {
  return new Promise((done, fail) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: `Hall tickets ${d.exam.name}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => done(Buffer.concat(chunks))); doc.on('error', fail);
    doc.registerFont('R', join(FONT_DIR, 'DejaVuSans.ttf')); doc.registerFont('B', join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
    d.students.forEach((s, i) => {
      if (i % 2 === 0) doc.addPage();
      const half = doc.page.height / 2;
      ticket(doc, d, s, i % 2 === 0 ? 0 : half, half);
      if (i % 2 === 0) {
        doc.save().moveTo(18, half).lineTo(doc.page.width - 18, half).dash(4, { space: 4 }).strokeColor('#9AA39D').lineWidth(0.6).stroke().restore();
        doc.font('R').fontSize(6).fillColor('#9AA39D').text('cut here', 0, half - 3.5, { width: doc.page.width, align: 'center', lineBreak: false });
      }
    });
    doc.end();
  });
}

function ticket(doc: PDFKit.PDFDocument, d: Data, s: Data['students'][number], top: number, height: number) {
  const ink = '#17201C', muted = '#5B6660', line = '#D5DBD3', soft = '#F1F4EF', brand = d.institution.brand;
  const W = doc.page.width, L = 34, R = W - 34, CW = R - L;
  const bottom = top + height - 22;
  // Frame and header
  doc.roundedRect(L - 10, top + 16, CW + 20, height - 32, 6).strokeColor(line).lineWidth(0.8).stroke();
  doc.rect(L - 10, top + 16, CW + 20, 5).fill(brand);
  let y = top + 30;
  let x0 = L;
  if (d.institution.logo) { try { doc.image(d.institution.logo, L, y, { fit: [38, 38] }); x0 = L + 46; } catch { /* unreadable logo */ } }
  const headW = CW * 0.66 - (x0 - L);
  let nameSize = 13;
  doc.font('B');
  while (nameSize > 9.5 && doc.fontSize(nameSize).widthOfString(d.institution.name) > headW) nameSize -= 0.5;
  doc.fillColor(ink).fontSize(nameSize).text(d.institution.name, x0, y, { width: headW, height: nameSize + 4, lineBreak: false, ellipsis: true });
  doc.font('R').fontSize(7.5).fillColor(muted).text([d.institution.address, d.institution.phone && `Ph: ${d.institution.phone}`].filter(Boolean).join('  ·  '), x0, y + 17, { width: headW, height: 20, ellipsis: true });
  doc.font('B').fontSize(13).fillColor(brand).text('HALL TICKET', L + CW * 0.66, y, { width: CW * 0.34, align: 'right' });
  doc.font('R').fontSize(8.5).fillColor(ink).text(`${d.exam.name} · ${d.exam.year}`, L + CW * 0.66, y + 17, { width: CW * 0.34, align: 'right', lineBreak: false, ellipsis: true });
  y += 44;
  doc.moveTo(L, y).lineTo(R, y).strokeColor(line).lineWidth(0.6).stroke();
  y += 8;

  // Student details, photo on the right
  const pw = 58, ph = 70;
  const fields: Array<[string, string, boolean?]> = [['Student', s.name], ['Class & section', s.className], ['Roll no', s.rollNo || '—', true], ['Admission no', s.admissionNo], ['Father', s.father || '—']];
  const colW = (CW - pw - 14) / 2;
  fields.forEach(([k, v, big], i) => {
    const col = i === 0 ? 0 : (i - 1) % 2, row = i === 0 ? 0 : Math.floor((i - 1) / 2) + 1;
    const fx = L + col * colW, fy = y + row * 22, w = i === 0 ? colW * 2 - 8 : colW - 8;
    doc.font('R').fontSize(6.5).fillColor(muted).text(k, fx, fy, { width: w });
    doc.font('B').fontSize(big ? 11 : 9.5).fillColor(ink).text(v, fx, fy + 7.5, { width: w, lineBreak: false, ellipsis: true });
  });
  if (s.photo) { try { doc.image(s.photo, R - pw, y, { fit: [pw, ph], align: 'center', valign: 'center' }); } catch { doc.rect(R - pw, y, pw, ph).strokeColor(line).stroke(); } }
  else {
    doc.rect(R - pw, y, pw, ph).strokeColor(line).lineWidth(0.6).stroke();
    doc.font('R').fontSize(6.5).fillColor(muted).text('Paste photo', R - pw, y + ph / 2 - 4, { width: pw, align: 'center' });
  }
  y += Math.max(66, ph) + 6;

  // Timetable
  const noteLines = d.note.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  const signH = 34;
  const cols = [{ label: 'Date', w: CW * 0.2 }, { label: 'Day', w: CW * 0.1 }, { label: 'Subject', w: CW * 0.4 }, { label: 'Time', w: CW * 0.3 }];
  const rows = s.papers.length ? s.papers : [];
  // Fit: shrink the table rows and the instructions to the space left in this half page.
  doc.font('R').fontSize(7);
  const noteH = (fs: number) => noteLines.reduce((h, t, i) => h + doc.fontSize(fs).heightOfString(`${i + 1}. ${t}`, { width: CW }) + 2, 0) + (noteLines.length ? 12 : 0);
  const avail = bottom - y - signH - 6;
  // The timetable stays readable (rows at least 11 pt); instructions get smaller, then are cut if there are too many.
  const n = Math.max(1, rows.length);
  let fs = 8;
  while (16 + n * 11 + noteH(fs) > avail && fs > 6.5) fs -= 0.25;
  const rowH = Math.max(11, Math.min(15.5, (avail - 16 - noteH(fs)) / n));
  doc.rect(L, y, CW, 15).fill(soft);
  let cx = L;
  for (const c of cols) { doc.font('B').fontSize(7.5).fillColor(ink).text(c.label, cx + 4, y + 4, { width: c.w - 8 }); cx += c.w; }
  y += 15;
  if (!rows.length) { doc.font('R').fontSize(8).fillColor(muted).text('The timetable for this exam is not set yet.', L + 4, y + 3); y += rowH; }
  for (const p of rows) {
    cx = L;
    const cells = [dateOf(p.date), dayOf(p.date), p.subject, p.start ? `${time12(p.start)}${p.end ? ` – ${time12(p.end)}` : ''}` : ''];
    cells.forEach((t, i) => { doc.font(i === 2 ? 'B' : 'R').fontSize(Math.min(8.5, rowH - 4.5)).fillColor(ink).text(t, cx + 4, y + (rowH - 8) / 2 + 0.5, { width: cols[i].w - 8, lineBreak: false, ellipsis: true }); cx += cols[i].w; });
    y += rowH;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(line).lineWidth(0.4).stroke();
  }
  y += 6;

  // Instructions (cut off rather than run into the next ticket)
  if (noteLines.length) {
    doc.font('B').fontSize(8).fillColor(ink).text('Instructions', L, y); y += 11;
    for (const [i, t] of noteLines.entries()) {
      const h = doc.font('R').fontSize(fs).heightOfString(`${i + 1}. ${t}`, { width: CW });
      if (y + h > bottom - signH) break;
      doc.fillColor(ink).text(`${i + 1}. ${t}`, L, y, { width: CW }); y += h + 2;
    }
  }

  // Signatures
  const sy = bottom - 12;
  const sig = (label: string, x: number, w: number) => { doc.moveTo(x, sy).lineTo(x + w, sy).strokeColor(muted).lineWidth(0.5).stroke(); doc.font('R').fontSize(7).fillColor(muted).text(label, x, sy + 3, { width: w, align: 'center' }); };
  sig('Student', L, 120); sig('Class teacher', L + CW / 2 - 60, 120); sig('Principal', R - 120, 120);
}
