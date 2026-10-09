import ExcelJS from 'exceljs';
import type { Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { currentYear } from '../common/academic-year';
import { cellText } from '../imports/excel';
import { iso, SchoolCalendar, schoolToday, type AttStatus } from './calendar';
import { monthEnd } from './attendance.service';

/** Agreed import format: one sheet per section and month, a row per student, a column per date. */
const CODES: Record<string, AttStatus> = { P: 'present', A: 'absent', L: 'late', LT: 'late', H: 'half_day', HD: 'half_day', LV: 'leave' };

export async function attendanceTemplate(db: Database, sectionId: number, month: string) {
  const year = await currentYear(db);
  const cal = await SchoolCalendar.load(db, year.id);
  const sec = await db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id').select(['s.name', 'c.name as class_name']).where('s.id', '=', sectionId).executeTakeFirst();
  if (!sec) throw Errors.notFound('Section');
  const students = await db.selectFrom('enrollments as e').innerJoin('students as s', 's.id', 'e.student_id')
    .select(['s.admission_no', 's.first_name', 's.last_name', 'e.roll_no']).where('e.section_id', '=', sectionId).where('e.academic_year_id', '=', year.id).where('s.status', '=', 'active')
    .orderBy('e.roll_no').orderBy('s.first_name').execute();
  const days = cal.workingDays(`${month}-01`, monthEnd(month));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.columns = [{ header: 'Admission No', key: 'adm', width: 13 }, { header: 'Student Name', key: 'name', width: 24 }, ...days.map((d) => ({ header: d, key: d, width: 11 }))];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5F4A' } };
  ws.getColumn(1).numFmt = '@';
  for (const s of students) ws.addRow({ adm: s.admission_no, name: [s.first_name, s.last_name].filter(Boolean).join(' ') });
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
  const info = wb.addWorksheet('Instructions');
  info.columns = [{ width: 14 }, { width: 70 }];
  info.addRow([`Attendance: ${sec.class_name} ${sec.name}, ${month}`]).font = { bold: true, size: 14 };
  info.addRow(['Only working days are listed (Sundays, holidays and Saturdays off are left out).']);
  info.addRow(['Fill each cell with a code. Leave a cell empty if attendance was not taken that day.']);
  info.addRow([]);
  for (const [k, v] of [['P', 'Present'], ['A', 'Absent'], ['L', 'Late'], ['H', 'Half day'], ['LV', 'Leave']]) info.addRow([k, v]);
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), name: `attendance-${sec.class_name}-${sec.name}-${month}.xlsx`.replace(/\s+/g, '-') };
}

export interface PlannedMark { row: number; studentId: number; sectionId: number; date: string; status: AttStatus }

/** Reads and checks every cell. Nothing is saved here. */
export async function planAttendanceImport(db: Database, buf: Buffer) {
  const year = await currentYear(db);
  const cal = await SchoolCalendar.load(db, year.id);
  const today = await schoolToday(db);
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as any); } catch { throw Errors.badRequest('UNREADABLE_FILE', 'Could not read this file. Save it as Excel (.xlsx) and try again.'); }
  const ws = wb.getWorksheet('Data') ?? wb.worksheets[0];
  const errors: Array<{ row: number; column: string; message: string }> = [];
  const header = ws.getRow(1);
  const dateCols: Array<{ col: number; date: string }> = [];
  let admCol = 0;
  header.eachCell((cell, col) => {
    const v = cell.value;
    const t = v instanceof Date ? v.toISOString().slice(0, 10) : cellText(v);
    if (/admission/i.test(t)) admCol = col;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(t)) dateCols.push({ col, date: t });
    else if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(t)) { const [d, m, y] = t.split(/[-/.]/); dateCols.push({ col, date: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` }); }
  });
  if (!admCol) throw Errors.badRequest('TEMPLATE_MISMATCH', 'The "Admission No" column is missing. Download the template and keep its header row.');
  if (!dateCols.length) throw Errors.badRequest('TEMPLATE_MISMATCH', 'No date columns found. Dates must be in the header row, like 2026-07-01.');
  for (const c of dateCols) {
    if (c.date > today) errors.push({ row: 1, column: c.date, message: 'Future date.' });
    else if (!cal.isWorking(c.date)) errors.push({ row: 1, column: c.date, message: `Not a working day (${cal.offReason(c.date)}).` });
  }
  const adms: Array<{ row: number; adm: string }> = [];
  ws.eachRow((r, n) => { if (n > 1) { const a = cellText(r.getCell(admCol).value).replace(/\.0$/, ''); if (a) adms.push({ row: n, adm: a }); } });
  const found = adms.length ? await db.selectFrom('students as s').innerJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 's.id').on('e.academic_year_id', '=', year.id))
    .select(['s.id', 's.admission_no', 'e.section_id']).where('s.admission_no', 'in', adms.map((a) => a.adm)).where('s.status', '=', 'active').execute() : [];
  const byAdm = new Map(found.map((f) => [f.admission_no, f]));
  const planned: PlannedMark[] = [];
  for (const a of adms) {
    const st = byAdm.get(a.adm);
    if (!st) { errors.push({ row: a.row, column: 'Admission No', message: `${a.adm} is not an active student in a class this year.` }); continue; }
    const r = ws.getRow(a.row);
    for (const c of dateCols) {
      const raw = cellText(r.getCell(c.col).value).toUpperCase().replace(/\s+/g, '');
      if (!raw) continue;
      const status = CODES[raw];
      if (!status) { errors.push({ row: a.row, column: c.date, message: `"${raw}" is not a code. Use P, A, L, H or LV.` }); continue; }
      planned.push({ row: a.row, studentId: st.id, sectionId: st.section_id, date: c.date, status });
    }
  }
  if (!adms.length) throw Errors.badRequest('EMPTY_FILE', 'No students found below the header row.');
  return { yearId: year.id, errors, planned, totalRows: adms.length, summary: { students: new Set(planned.map((p) => p.studentId)).size, days: new Set(planned.map((p) => p.date)).size, marks: planned.length } };
}

export async function commitAttendanceImport(db: Database, userId: number, plan: Awaited<ReturnType<typeof planAttendanceImport>>) {
  await db.transaction().execute(async (trx) => {
    for (const p of plan.planned) {
      await trx.insertInto('student_attendance').values({ academic_year_id: plan.yearId, student_id: p.studentId, section_id: p.sectionId, att_date: new Date(`${p.date}T00:00:00Z`), status: p.status, source: 'import', marked_by: userId })
        .onDuplicateKeyUpdate({ status: p.status, source: 'import', marked_by: userId }).execute();
    }
    const days = new Map<string, { sectionId: number; date: string }>();
    for (const p of plan.planned) days.set(`${p.sectionId}|${p.date}`, { sectionId: p.sectionId, date: p.date });
    for (const d of days.values()) {
      await trx.insertInto('attendance_days').values({ section_id: d.sectionId, att_date: new Date(`${d.date}T00:00:00Z`), academic_year_id: plan.yearId, marked_by: userId })
        .onDuplicateKeyUpdate({ updated_by: userId, updated_at: new Date() }).execute();
    }
  });
}
export { iso };
