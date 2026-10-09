import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { amountInWords, formatINR, toPaise } from './money';
import type { PaymentsService } from './payments.service';

type Receipt = Awaited<ReturnType<PaymentsService['receipt']>>;

const FONT_DIR = [resolve(__dirname, '../../assets/fonts'), resolve(__dirname, '../../../assets/fonts')].find((d) => existsSync(join(d, 'DejaVuSans.ttf')))!;
const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', cheque: 'Cheque', bank_transfer: 'Bank transfer', card: 'Card' };
const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** A5 receipt, generated on demand and streamed; never written to disk (rule R2). */
export function renderReceiptPdf(r: Receipt): Promise<Buffer> {
  return new Promise((resolvePdf, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 32, info: { Title: `Receipt ${r.receipt_no}`, Author: r.institution.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolvePdf(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('R', join(FONT_DIR, 'DejaVuSans.ttf'));
    doc.registerFont('B', join(FONT_DIR, 'DejaVuSans-Bold.ttf'));

    const brand = r.institution.brand_primary || '#1F5F4A';
    const ink = '#17201C', muted = '#5B6660', line = '#DDE2DC';
    const W = doc.page.width, L = 32, R = W - 32, CW = R - L;

    // Header band
    doc.rect(0, 0, W, 6).fill(brand);
    doc.fillColor(ink).font('B').fontSize(14).text(r.institution.name, L, 24, { width: CW * 0.62 });
    const afterName = doc.y;
    doc.font('R').fontSize(7.5).fillColor(muted)
      .text([r.institution.address, r.institution.phone && `Ph: ${r.institution.phone}`, r.institution.contact_email].filter(Boolean).join('  ·  '), L, afterName + 2, { width: CW * 0.62 });
    const title = r.receipt_type === 'opening_balance' ? 'OPENING BALANCE' : 'FEE RECEIPT';
    doc.font('B').fontSize(9).fillColor(brand).text(title, L + CW * 0.62, 26, { width: CW * 0.38, align: 'right' });
    doc.font('B').fontSize(10).fillColor(ink).text(r.receipt_no, L + CW * 0.62, 40, { width: CW * 0.38, align: 'right' });
    doc.font('R').fontSize(8).fillColor(muted).text(fmtDate(r.payment_date), L + CW * 0.62, 55, { width: CW * 0.38, align: 'right' });
    let y = Math.max(doc.y, 74) + 10;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(line).lineWidth(0.8).stroke();
    y += 10;

    // Student block
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ');
    const field = (label: string, value: string, x: number, yy: number, w: number) => {
      doc.font('R').fontSize(7).fillColor(muted).text(label, x, yy, { width: w });
      doc.font('B').fontSize(9).fillColor(ink).text(value || '-', x, yy + 9, { width: w });
    };
    field('Student', name, L, y, CW * 0.5);
    field('Admission no', r.admission_no, L + CW * 0.5, y, CW * 0.25);
    field('Class', r.class_name ? `${r.class_name} ${r.section_name ?? ''}` : '-', L + CW * 0.75, y, CW * 0.25);
    y += 30;
    field('Parent', r.father_name || r.family_name, L, y, CW * 0.5);
    field('Academic year', r.year, L + CW * 0.5, y, CW * 0.25);
    field('Mobile', r.primary_mobile, L + CW * 0.75, y, CW * 0.25);
    y += 34;

    // Lines table
    doc.rect(L, y, CW, 18).fill('#F1F4F1');
    doc.font('B').fontSize(7.5).fillColor(muted);
    doc.text('#', L + 6, y + 5.5, { width: 14 });
    doc.text('Description', L + 22, y + 5.5, { width: CW * 0.55 });
    doc.text('Year', L + CW * 0.62, y + 5.5, { width: CW * 0.15 });
    doc.text('Amount', L + CW * 0.75, y + 5.5, { width: CW * 0.25 - 6, align: 'right' });
    y += 18;
    r.line_items.forEach((li, i) => {
      doc.font('R').fontSize(8.5).fillColor(ink);
      const h = Math.max(16, doc.heightOfString(li.label, { width: CW * 0.55 }) + 7);
      doc.text(String(i + 1), L + 6, y + 4.5, { width: 14 });
      doc.text(li.label, L + 22, y + 4.5, { width: CW * 0.55 });
      doc.fillColor(muted).text(li.year, L + CW * 0.62, y + 4.5, { width: CW * 0.15 });
      doc.fillColor(ink).text(formatINR(toPaise(li.amount)), L + CW * 0.75, y + 4.5, { width: CW * 0.25 - 6, align: 'right' });
      y += h;
      doc.moveTo(L, y).lineTo(R, y).strokeColor(line).lineWidth(0.5).stroke();
    });
    y += 6;
    const total = toPaise(r.total_amount);
    doc.font('B').fontSize(11).fillColor(ink).text('Total paid', L + 22, y, { width: CW * 0.5 });
    doc.text(formatINR(total), L + CW * 0.5, y, { width: CW * 0.5 - 6, align: 'right' });
    y = doc.y + 3;
    doc.font('R').fontSize(7.5).fillColor(muted).text(amountInWords(total), L + 22, y, { width: CW - 28 });
    y = doc.y + 12;

    // Payment details
    const pay = [`Paid by ${METHOD[r.method] ?? r.method}`, r.reference_no && `Ref: ${r.reference_no}`, `Collected by ${r.collected_by}`].filter(Boolean).join('   ·   ');
    doc.font('R').fontSize(8).fillColor(ink).text(pay, L, y, { width: CW });
    y = doc.y + 6;
    const due = toPaise(r.balance_due);
    doc.roundedRect(L, y, CW, 22, 4).fill(due > 0 ? '#FBF1D3' : '#E6EFEB');
    doc.font('B').fontSize(8.5).fillColor(due > 0 ? '#7A5A00' : brand)
      .text(due > 0 ? `Balance still due: ${formatINR(due)}` : 'No dues pending', L + 8, y + 7, { width: CW - 16 });
    y += 30;
    if (r.remarks) { doc.font('R').fontSize(7.5).fillColor(muted).text(`Note: ${r.remarks}`, L, y, { width: CW }); y = doc.y + 6; }

    // Footer
    const fy = doc.page.height - 58;
    doc.moveTo(R - 110, fy).lineTo(R, fy).strokeColor(muted).lineWidth(0.6).stroke();
    doc.font('R').fontSize(7).fillColor(muted).text('Authorised signature', R - 110, fy + 3, { width: 110, align: 'center' });
    doc.text('Computer-generated receipt.', L, fy + 3, { width: CW - 120 });

    if (r.status === 'void') {
      doc.save();
      doc.rotate(-30, { origin: [W / 2, doc.page.height / 2] });
      doc.font('B').fontSize(72).fillColor('#B42318').opacity(0.18).text('VOID', 0, doc.page.height / 2 - 40, { width: W, align: 'center' });
      doc.restore();
      doc.opacity(1).font('B').fontSize(8).fillColor('#B42318')
        .text(`VOID on ${fmtDate(r.voided_at!)} by ${r.voided_by}: ${r.void_reason}`, L, fy - 18, { width: CW });
    }
    doc.end();
  });
}
