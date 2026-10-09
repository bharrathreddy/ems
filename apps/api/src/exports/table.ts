import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** A list ready to export. The same table becomes an Excel sheet or a printable PDF. */
export interface ExportColumn { key: string; label: string; width?: number; align?: 'left' | 'center' | 'right'; money?: boolean }
export interface ExportTable { title: string; subtitle?: string; fileName: string; columns: ExportColumn[]; rows: Array<Record<string, unknown>>; totals?: Record<string, unknown> }
export interface School { name: string; address?: string | null; brand_primary?: string | null }

const HIDDEN = '__hidden__';
const FONT_DIR = [resolve(__dirname, '../../assets/fonts'), resolve(__dirname, '../../../assets/fonts')].find((d) => existsSync(join(d, 'DejaVuSans.ttf')))!;
const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n);

/** Text for a cell. Values the viewer may not see (field rules) stay hidden in exports too. */
export function cellText(v: unknown, money?: boolean): string {
  if (v === HIDDEN) return 'Hidden';
  if (v === null || v === undefined || v === '') return '';
  if (money && !isNaN(Number(v))) return inr(Number(v));
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export async function toXlsx(t: ExportTable): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, '-'));
  ws.columns = t.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(8, (c.width ?? 12)) }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5F4A' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const value = (c: ExportColumn, v: unknown) => (v === HIDDEN ? 'Hidden' : c.money && v !== null && v !== '' && !isNaN(Number(v)) ? Number(v) : v instanceof Date ? v : v ?? '');
  for (const r of t.rows) ws.addRow(Object.fromEntries(t.columns.map((c) => [c.key, value(c, r[c.key])])));
  if (t.totals) ws.addRow(Object.fromEntries(t.columns.map((c) => [c.key, value(c, t.totals![c.key])]))).font = { bold: true };
  for (const c of t.columns) {
    if (c.money) ws.getColumn(c.key).numFmt = '#,##,##0.##';
    if (c.align) ws.getColumn(c.key).alignment = { horizontal: c.align };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A4 table with the school's name, the title and page numbers; landscape when the table is wide. */
export function toPdf(t: ExportTable, school: School): Promise<Buffer> {
  return new Promise((done, fail) => {
    const wide = t.columns.reduce((s, c) => s + (c.width ?? 12), 0) > 95;
    const doc = new PDFDocument({ size: 'A4', layout: wide ? 'landscape' : 'portrait', margin: 32, bufferPages: true, info: { Title: t.title, Author: school.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => done(Buffer.concat(chunks))); doc.on('error', fail);
    doc.registerFont('R', join(FONT_DIR, 'DejaVuSans.ttf')); doc.registerFont('B', join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
    const brand = school.brand_primary || '#1F5F4A', ink = '#17201C', muted = '#5B6660', line = '#DDE2DC', soft = '#F1F4EF';
    const L = 32, R = doc.page.width - 32, CW = R - L, bottom = doc.page.height - 40;
    const totalW = t.columns.reduce((s, c) => s + (c.width ?? 12), 0);
    const widths = t.columns.map((c) => ((c.width ?? 12) / totalW) * CW);
    const size = t.columns.length > 10 ? 7 : 8;
    const rowH = size + 9;

    const header = (first: boolean) => {
      doc.rect(0, 0, doc.page.width, 5).fill(brand);
      doc.font('B').fontSize(first ? 13 : 10).fillColor(ink).text(school.name, L, 18, { width: CW * 0.6 });
      doc.font('B').fontSize(first ? 11 : 9).fillColor(brand).text(t.title, L + CW * 0.4, 18, { width: CW * 0.6, align: 'right' });
      let y = Math.max(doc.y, 34);
      if (first && t.subtitle) { doc.font('R').fontSize(8).fillColor(muted).text(t.subtitle, L, y + 2, { width: CW }); y = doc.y; }
      return y + 8;
    };
    const colHead = (y: number) => {
      doc.rect(L, y, CW, rowH + 2).fill(soft);
      let x = L;
      t.columns.forEach((c, i) => { doc.font('B').fontSize(size).fillColor(ink).text(c.label, x + 3, y + 5, { width: widths[i] - 6, align: c.align ?? (c.money ? 'right' : 'left'), lineBreak: false, ellipsis: true }); x += widths[i]; });
      return y + rowH + 2;
    };
    const drawRow = (r: Record<string, unknown>, y: number, bold = false) => {
      let x = L;
      t.columns.forEach((c, i) => { doc.font(bold ? 'B' : 'R').fontSize(size).fillColor(r[c.key] === HIDDEN ? muted : ink).text(cellText(r[c.key], c.money), x + 3, y + 4, { width: widths[i] - 6, align: c.align ?? (c.money ? 'right' : 'left'), lineBreak: false, ellipsis: true }); x += widths[i]; });
      doc.moveTo(L, y + rowH).lineTo(R, y + rowH).strokeColor(line).lineWidth(0.4).stroke();
      return y + rowH;
    };

    let y = colHead(header(true));
    if (!t.rows.length) { doc.font('R').fontSize(9).fillColor(muted).text('Nothing to show.', L, y + 8); }
    for (const r of t.rows) {
      if (y + rowH > bottom) { doc.addPage(); y = colHead(header(false)); }
      y = drawRow(r, y);
    }
    if (t.totals) { if (y + rowH > bottom) { doc.addPage(); y = colHead(header(false)); } doc.rect(L, y, CW, rowH).fill(soft); drawRow(t.totals, y, true); }

    const stamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.font('R').fontSize(7).fillColor(muted)
        .text(`${t.rows.length} row${t.rows.length === 1 ? '' : 's'} · printed ${stamp}`, L, doc.page.height - 26, { width: CW / 2, lineBreak: false })
        .text(`Page ${i + 1} of ${pages.count}`, L + CW / 2, doc.page.height - 26, { width: CW / 2, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
