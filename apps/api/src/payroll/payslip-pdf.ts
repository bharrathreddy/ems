import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { amountInWords, formatINR } from '../fees/money';
import type { PayrollService } from './payroll.service';

type Slip = Awaited<ReturnType<PayrollService['payslip']>>;
const FONT_DIR = [resolve(__dirname, '../../assets/fonts'), resolve(__dirname, '../../../assets/fonts')].find((d) => existsSync(join(d, 'DejaVuSans.ttf')))!;
const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '-');

/** A4 payslip, generated on demand. */
export function renderPayslipPdf(p: Slip): Promise<Buffer> {
  return new Promise((done, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Payslip ${p.label} ${p.name}`, Author: p.school.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => done(Buffer.concat(chunks))); doc.on('error', reject);
    doc.registerFont('R', join(FONT_DIR, 'DejaVuSans.ttf'));
    doc.registerFont('B', join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
    const brand = p.school.brand_primary || '#1F5F4A', ink = '#17201C', muted = '#5B6660', line = '#DDE2DC';
    const W = doc.page.width, L = 40, R = W - 40, CW = R - L;

    doc.rect(0, 0, W, 6).fill(brand);
    doc.fillColor(ink).font('B').fontSize(15).text(p.school.name, L, 28, { width: CW * 0.65 });
    doc.font('R').fontSize(8).fillColor(muted).text([p.school.address, p.school.phone && `Ph: ${p.school.phone}`, p.school.contact_email].filter(Boolean).join('  ·  '), L, doc.y + 2, { width: CW * 0.65 });
    doc.font('B').fontSize(10).fillColor(brand).text('PAYSLIP', L + CW * 0.65, 30, { width: CW * 0.35, align: 'right' });
    doc.font('B').fontSize(12).fillColor(ink).text(p.label, L + CW * 0.65, 45, { width: CW * 0.35, align: 'right' });
    if (p.draft) doc.font('B').fontSize(9).fillColor('#B42318').text('DRAFT - not final', L + CW * 0.65, 63, { width: CW * 0.35, align: 'right' });
    let y = Math.max(doc.y, 80) + 12;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(line).lineWidth(0.8).stroke();
    y += 12;

    const field = (label: string, value: string | null | undefined, x: number, yy: number, w: number) => {
      doc.font('R').fontSize(7.5).fillColor(muted).text(label, x, yy, { width: w });
      doc.font('B').fontSize(9.5).fillColor(ink).text(value || '-', x, yy + 10, { width: w });
    };
    const col = CW / 4;
    field('Name', p.name, L, y, col * 2); field('Employee code', p.code, L + col * 2, y, col); field('Designation', p.designation, L + col * 3, y, col);
    y += 32;
    field('Date of joining', fmtDate(p.joiningDate), L, y, col); field('Bank', p.bankName, L + col, y, col); field('Account', p.account, L + col * 2, y, col); field('PAN', p.pan, L + col * 3, y, col);
    y += 32;
    field('Days in month', String(p.divisor), L, y, col); field('Paid days', String(p.paidDays), L + col, y, col); field('Loss-of-pay days', String(p.lopDays), L + col * 2, y, col);
    field('UAN / ESI', [p.uan, p.esi].filter(Boolean).join(' / ') || null, L + col * 3, y, col);
    y += 40;

    // Earnings | Deductions side by side
    const half = (CW - 16) / 2;
    const earn = p.lines.filter((l) => l.kind === 'earning'), ded = p.lines.filter((l) => l.kind === 'deduction'), emp = p.lines.filter((l) => l.kind === 'employer');
    const table = (x: number, title: string, rows: typeof p.lines, total: number, totalLabel: string) => {
      doc.rect(x, y, half, 20).fill('#F1F4F1');
      doc.font('B').fontSize(8.5).fillColor(muted).text(title, x + 8, y + 6, { width: half - 90 }).text('Amount', x + half - 88, y + 6, { width: 80, align: 'right' });
      let yy = y + 26;
      for (const r of rows) {
        doc.font('R').fontSize(9).fillColor(ink).text(r.name, x + 8, yy, { width: half - 100 });
        doc.text(formatINR(r.amount), x + half - 88, yy, { width: 80, align: 'right' });
        yy += 17;
      }
      return { yy, draw: (at: number) => {
        doc.moveTo(x, at).lineTo(x + half, at).strokeColor(line).stroke();
        doc.font('B').fontSize(9.5).fillColor(ink).text(totalLabel, x + 8, at + 7, { width: half - 100 }).text(formatINR(total), x + half - 88, at + 7, { width: 80, align: 'right' });
      } };
    };
    const a = table(L, 'Earnings', earn, p.gross, 'Gross pay');
    const b = table(L + half + 16, 'Deductions', ded, p.deductions, 'Total deductions');
    const end = Math.max(a.yy, b.yy) + 4;
    a.draw(end); b.draw(end);
    doc.rect(L, y, half, end + 26 - y).strokeColor(line).stroke();
    doc.rect(L + half + 16, y, half, end + 26 - y).strokeColor(line).stroke();
    y = end + 42;

    doc.rect(L, y, CW, 44).fill(brand);
    doc.font('R').fontSize(8.5).fillColor('#FFFFFF').text('NET PAY', L + 14, y + 9);
    doc.font('B').fontSize(16).text(formatINR(p.net), L + 14, y + 20);
    doc.font('R').fontSize(8.5).text(amountInWords(p.net), L + CW * 0.35, y + 17, { width: CW * 0.63, align: 'right' });
    y += 60;

    if (emp.length) {
      doc.font('B').fontSize(8.5).fillColor(muted).text('Paid by the school in addition (not deducted from your pay)', L, y);
      y += 14;
      for (const r of emp) { doc.font('R').fontSize(9).fillColor(ink).text(r.name, L, y, { width: CW - 120 }).text(formatINR(r.amount), R - 110, y, { width: 110, align: 'right' }); y += 15; }
      y += 6;
    }
    if (p.note) { doc.font('R').fontSize(8.5).fillColor(muted).text(`Note: ${p.note}`, L, y, { width: CW }); y = doc.y + 8; }
    doc.font('R').fontSize(7.5).fillColor(muted).text('This is a computer-generated payslip and does not need a signature.', L, Math.max(y + 20, doc.page.height - 70), { width: CW, align: 'center' });
    doc.end();
  });
}
