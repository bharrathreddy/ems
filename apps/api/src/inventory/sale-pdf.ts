import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { amountInWords, formatINR, toPaise } from '../fees/money';
import type { InventoryService } from './inventory.service';

type Sale = Awaited<ReturnType<InventoryService['sale']>>;

const FONT_DIR = [resolve(__dirname, '../../assets/fonts'), resolve(__dirname, '../../../assets/fonts')].find((d) => existsSync(join(d, 'DejaVuSans.ttf')))!;
const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', cheque: 'Cheque', bank_transfer: 'Bank transfer', card: 'Card' };
const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** A5 sale receipt for books, uniforms and other items; generated on demand. */
export function renderSalePdf(s: Sale): Promise<Buffer> {
  return new Promise((done, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 32, info: { Title: `Receipt ${s.receipt_no}`, Author: s.institution.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => done(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('R', join(FONT_DIR, 'DejaVuSans.ttf'));
    doc.registerFont('B', join(FONT_DIR, 'DejaVuSans-Bold.ttf'));

    const brand = s.institution.brand_primary || '#1F5F4A';
    const ink = '#17201C', muted = '#5B6660', line = '#DDE2DC';
    const W = doc.page.width, L = 32, R = W - 32, CW = R - L;

    doc.rect(0, 0, W, 6).fill(brand);
    doc.fillColor(ink).font('B').fontSize(14).text(s.institution.name, L, 24, { width: CW * 0.62 });
    const afterName = doc.y;
    doc.font('R').fontSize(7.5).fillColor(muted)
      .text([s.institution.address, s.institution.phone && `Ph: ${s.institution.phone}`, s.institution.contact_email].filter(Boolean).join('  ·  '), L, afterName + 2, { width: CW * 0.62 });
    doc.font('B').fontSize(9).fillColor(brand).text('SALE RECEIPT', L + CW * 0.62, 26, { width: CW * 0.38, align: 'right' });
    doc.font('B').fontSize(10).fillColor(ink).text(s.receipt_no, L + CW * 0.62, 40, { width: CW * 0.38, align: 'right' });
    doc.font('R').fontSize(8).fillColor(muted).text(fmtDate(s.sale_date), L + CW * 0.62, 55, { width: CW * 0.38, align: 'right' });
    let y = Math.max(doc.y, 74) + 10;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(line).lineWidth(0.8).stroke();
    y += 10;

    const field = (label: string, value: string | null | undefined, x: number, yy: number, w: number) => {
      doc.font('R').fontSize(7).fillColor(muted).text(label, x, yy, { width: w });
      doc.font('B').fontSize(9).fillColor(ink).text(value || '-', x, yy + 9, { width: w });
    };
    if (s.admission_no) {
      field('Student', s.buyer, L, y, CW * 0.5);
      field('Admission no', s.admission_no, L + CW * 0.5, y, CW * 0.25);
      field('Class', s.class_name ? `${s.class_name} ${s.section_name ?? ''}` : '-', L + CW * 0.75, y, CW * 0.25);
      y += 30;
      field('Parent', s.father_name || s.family_name, L, y, CW * 0.5);
      field('Academic year', s.year, L + CW * 0.5, y, CW * 0.25);
      field('Mobile', s.primary_mobile, L + CW * 0.75, y, CW * 0.25);
    } else {
      field('Sold to', s.buyer, L, y, CW * 0.75);
      field('Academic year', s.year, L + CW * 0.75, y, CW * 0.25);
    }
    y += 34;

    doc.rect(L, y, CW, 18).fill('#F1F4F1');
    doc.font('B').fontSize(7.5).fillColor(muted);
    doc.text('Item', L + 6, y + 5.5, { width: CW * 0.5 });
    doc.text('Qty', L + CW * 0.52, y + 5.5, { width: CW * 0.1, align: 'right' });
    doc.text('Rate', L + CW * 0.62, y + 5.5, { width: CW * 0.16, align: 'right' });
    doc.text('Amount', L + CW * 0.78, y + 5.5, { width: CW * 0.22 - 6, align: 'right' });
    y += 18;
    for (const li of s.lines) {
      doc.font('R').fontSize(8.5).fillColor(ink);
      const h = Math.max(16, doc.heightOfString(li.label, { width: CW * 0.5 }) + 7);
      doc.text(li.label, L + 6, y + 4.5, { width: CW * 0.5 });
      doc.text(qty(li.qty), L + CW * 0.52, y + 4.5, { width: CW * 0.1, align: 'right' });
      doc.fillColor(muted).text(formatINR(toPaise(li.unitPrice)), L + CW * 0.62, y + 4.5, { width: CW * 0.16, align: 'right' });
      doc.fillColor(ink).text(formatINR(toPaise(li.amount)), L + CW * 0.78, y + 4.5, { width: CW * 0.22 - 6, align: 'right' });
      y += h;
      doc.moveTo(L, y).lineTo(R, y).strokeColor(line).lineWidth(0.5).stroke();
      if (y > doc.page.height - 140) { doc.addPage(); y = 40; }
    }
    y += 6;
    const total = toPaise(s.total);
    doc.font('B').fontSize(11).fillColor(ink).text('Total paid', L + 6, y, { width: CW * 0.5 });
    doc.text(formatINR(total), L + CW * 0.5, y, { width: CW * 0.5 - 6, align: 'right' });
    y = doc.y + 3;
    doc.font('R').fontSize(7.5).fillColor(muted).text(amountInWords(total), L + 6, y, { width: CW - 12 });
    y = doc.y + 12;
    const pay = [`Paid by ${METHOD[s.method] ?? s.method}`, s.reference_no && `Ref: ${s.reference_no}`, `Sold by ${s.sold_by}`].filter(Boolean).join('   ·   ');
    doc.font('R').fontSize(8).fillColor(ink).text(pay, L, y, { width: CW });

    const fy = doc.page.height - 58;
    doc.moveTo(R - 110, fy).lineTo(R, fy).strokeColor(muted).lineWidth(0.6).stroke();
    doc.font('R').fontSize(7).fillColor(muted).text('Authorised signature', R - 110, fy + 3, { width: 110, align: 'center' });
    doc.text('Computer-generated receipt.', L, fy + 3, { width: CW - 120 });

    if (s.status === 'cancelled') {
      doc.save();
      doc.rotate(-30, { origin: [W / 2, doc.page.height / 2] });
      doc.font('B').fontSize(60).fillColor('#B42318').opacity(0.18).text('CANCELLED', 0, doc.page.height / 2 - 34, { width: W, align: 'center' });
      doc.restore();
      doc.opacity(1).font('B').fontSize(8).fillColor('#B42318')
        .text(`Cancelled on ${fmtDate(s.cancelled_at!)} by ${s.cancelled_by}: ${s.cancel_reason}`, L, fy - 18, { width: CW });
    }
    doc.end();
  });
}
