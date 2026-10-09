import ExcelJS from 'exceljs';
import { normalizeMobile } from '../auth/passwords';

export interface Column { key: string; header: string; required?: boolean; example: string; note?: string; width?: number }

/** Template with a header row, one example row (marked), and an Instructions sheet. */
export async function buildTemplate(title: string, columns: Column[], lists: Record<string, string[]> = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.columns = columns.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: c.width ?? Math.max(14, c.header.length + 4) }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5F4A' } };
  ws.addRow(Object.fromEntries(columns.map((c) => [c.key, c.example])));
  ws.getRow(2).font = { italic: true, color: { argb: 'FF5B6660' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  // Keep mobile numbers and codes as text so Excel does not turn them into 9.85E+09
  columns.forEach((c, i) => { if (/mobile|code|admission|roll/i.test(c.key)) ws.getColumn(i + 1).numFmt = '@'; });

  const info = wb.addWorksheet('Instructions');
  info.columns = [{ width: 28 }, { width: 90 }];
  info.addRow([title]).font = { bold: true, size: 14 };
  info.addRow(['1. Fill one row per record in the "Data" sheet. Delete the grey example row (row 2).']);
  info.addRow(['2. Columns marked * are required. Keep the header row unchanged.']);
  info.addRow(['3. Dates: YYYY-MM-DD or DD-MM-YYYY (for example 2016-05-14 or 14-05-2016).']);
  info.addRow(['4. Upload the file. Nothing is saved until every row is valid and you confirm.']);
  info.addRow([]);
  info.addRow(['Column', 'Notes']).font = { bold: true };
  for (const c of columns) info.addRow([c.header + (c.required ? ' *' : ''), c.note ?? '']);
  for (const [name, values] of Object.entries(lists)) {
    info.addRow([]);
    info.addRow([name]).font = { bold: true };
    for (const v of values) info.addRow(['', v]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as any;
    if (Array.isArray(o.richText)) return o.richText.map((t: any) => t.text).join('').trim();
    if ('text' in o) return String(o.text).trim();
    if ('result' in o) return cellText(o.result);
    return '';
  }
  return String(v).trim();
}

/** Reads the "Data" sheet (or the first sheet) into objects keyed by column key, skipping empty rows and the example row. */
export async function readRows(buf: Buffer, columns: Column[]) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.getWorksheet('Data') ?? wb.worksheets[0];
  if (!ws) throw new Error('The file has no sheets.');
  const headerRow = ws.getRow(1);
  const norm = (s: string) => s.toLowerCase().replace(/\*/g, '').replace(/[^a-z0-9]/g, '');
  const colIndex = new Map<string, number>();
  headerRow.eachCell((cell, idx) => {
    const h = norm(cellText(cell.value));
    const col = columns.find((c) => norm(c.header) === h || norm(c.key) === h);
    if (col) colIndex.set(col.key, idx);
  });
  const missing = columns.filter((c) => c.required && !colIndex.has(c.key)).map((c) => c.header);
  const rows: Array<{ row: number; data: Record<string, string> }> = [];
  ws.eachRow((r, rowNumber) => {
    if (rowNumber === 1) return;
    const data: Record<string, string> = {};
    for (const [key, idx] of colIndex) data[key] = cellText(r.getCell(idx).value);
    if (Object.values(data).every((v) => v === '')) return;
    const example = columns.every((c) => !colIndex.has(c.key) || data[c.key] === c.example || data[c.key] === '');
    if (example) return;
    rows.push({ row: rowNumber, data });
  });
  return { rows, missing };
}

export function parseDate(s: string): string | null | 'invalid' {
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return 'invalid';
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 1950 || y > 2100) return 'invalid';
  return dt.toISOString().slice(0, 10);
}

export function parseGender(s: string): 'male' | 'female' | 'other' | null | 'invalid' {
  if (!s) return null;
  const v = s.toLowerCase();
  if (['m', 'male', 'boy'].includes(v)) return 'male';
  if (['f', 'female', 'girl'].includes(v)) return 'female';
  if (['o', 'other'].includes(v)) return 'other';
  return 'invalid';
}

export const parseMobile = (s: string) => (s ? normalizeMobile(s.replace(/\.0$/, '')) : null);
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
export const classKey = (s: string) => s.toLowerCase().replace(/class|std|grade/g, '').replace(/[^a-z0-9]/g, '');
