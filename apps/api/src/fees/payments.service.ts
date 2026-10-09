import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { currentYear } from '../common/academic-year';
import { newPublicId } from '../common/ids';
import { readJson } from '../common/json';
import type { RequestUser } from '../common/request-user';
import { toDb, toPaise, type Paise } from './money';
import { FeeAccountsService } from './fee-accounts.service';
import { takeNext, withRetry } from '../common/sequences';
import { isInstitutionAdmin } from '../common/admin';

export type Line =
  | { category: 'tuition'; academicYearId: number; amount: number }
  | { category: 'bus'; academicYearId: number; amount: number }
  | { category: 'one_time'; feeItemId: number; amount: number };
export interface CollectInput {
  studentId: number; paymentDate: string; method: 'cash' | 'upi' | 'cheque' | 'bank_transfer' | 'card';
  referenceNo?: string | null; remarks?: string | null; lines: Line[];
}
export interface ReceiptLine { feeItemId: number; label: string; year: string; category: string; amount: string }
type Meta = { ip: string | null; userAgent: string | null };

/** Gapless receipt numbers per academic year, e.g. RCPT/2026-27/00001 (rule R1). Call inside a transaction. */
export async function nextReceiptNo(trx: Database, type: 'regular' | 'opening_balance', yearName: string) {
  const prefixSetting = await trx.selectFrom('settings').select('value').where('setting_group', '=', 'receipts').where('setting_key', '=', 'prefix').executeTakeFirst();
  const base = type === 'regular' ? (readJson<string>(prefixSetting?.value) || 'RCPT') : 'OPN';
  return takeNext(trx, type === 'regular' ? 'receipt' : 'opening_receipt', yearName, { prefix: `${base}/${yearName}/`, pad: 5 });
}

/**
 * Applies a receipt to fee items inside the caller's transaction (rules F23 to F31).
 * Tuition: oldest unpaid installment first within the chosen year (F25).
 * Any line above its outstanding balance is rejected (F27). Nothing is partially saved.
 */
export async function applyPayment(trx: Database, actorId: number, input: CollectInput, type: 'regular' | 'opening_balance') {
  const year = await currentYear(trx);
  if (!input.lines.length) throw Errors.validation([{ field: 'lines', message: 'Enter an amount for at least one fee.' }]);
  const items = await trx.selectFrom('fee_items as i').innerJoin('academic_years as y', 'y.id', 'i.academic_year_id')
    .select(['i.id', 'i.academic_year_id', 'y.name as year', 'i.category', 'i.installment_no', 'i.label', 'i.amount', 'i.paid_amount', 'i.waived_amount', 'i.student_fee_account_id'])
    .where('i.student_id', '=', input.studentId).orderBy('y.start_date').orderBy('i.installment_no').orderBy('i.id').forUpdate().execute();
  const balanceOf = (i: (typeof items)[number]) => toPaise(i.amount) - toPaise(i.paid_amount) - toPaise(i.waived_amount);
  const allocations: Array<{ item: (typeof items)[number]; amount: Paise }> = [];
  const errors: Array<{ field: string; message: string }> = [];

  input.lines.forEach((line, idx) => {
    const amt = Math.round(line.amount * 100);
    if (amt <= 0) return errors.push({ field: `lines.${idx}.amount`, message: 'Amount must be more than zero.' });
    let pool = line.category === 'one_time'
      ? items.filter((i) => i.id === line.feeItemId && i.category === 'one_time')
      : items.filter((i) => i.category === line.category && i.academic_year_id === line.academicYearId);
    pool = pool.filter((i) => balanceOf(i) > 0);
    const outstanding = pool.reduce((t, i) => t + balanceOf(i), 0) - allocations.filter((a) => pool.includes(a.item)).reduce((t, a) => t + a.amount, 0);
    if (outstanding <= 0) return errors.push({ field: `lines.${idx}.amount`, message: 'Nothing is due for this fee.' });
    if (amt > outstanding) return errors.push({ field: `lines.${idx}.amount`, message: `Only ₹${(outstanding / 100).toLocaleString('en-IN')} is due for this fee.` });
    let left = amt;
    for (const it of pool) {
      if (left <= 0) break;
      const already = allocations.filter((a) => a.item === it).reduce((t, a) => t + a.amount, 0);
      const take = Math.min(left, balanceOf(it) - already);
      if (take > 0) { allocations.push({ item: it, amount: take }); left -= take; }
    }
  });
  if (errors.length) throw Errors.validation(errors);

  const merged = new Map<number, { item: (typeof items)[number]; amount: Paise }>();
  for (const a of allocations) merged.set(a.item.id, { item: a.item, amount: (merged.get(a.item.id)?.amount ?? 0) + a.amount });
  const total = [...merged.values()].reduce((t, a) => t + a.amount, 0);
  const lines: ReceiptLine[] = [...merged.values()].map((a) => ({ feeItemId: a.item.id, label: a.item.label, year: a.item.year, category: a.item.category, amount: toDb(a.amount) }));

  const receiptNo = await nextReceiptNo(trx, type, year.name);
  const publicId = newPublicId();
  const res = await trx.insertInto('payments').values({
    public_id: publicId, receipt_type: type, receipt_no: receiptNo, academic_year_id: year.id, student_id: input.studentId,
    payment_date: new Date(`${input.paymentDate}T00:00:00Z`), total_amount: toDb(total), method: input.method,
    reference_no: input.referenceNo ?? null, remarks: input.remarks ?? null, line_items: JSON.stringify(lines), collected_by: actorId,
  }).executeTakeFirstOrThrow();
  const paymentId = Number(res.insertId);
  await trx.insertInto('payment_allocations').values([...merged.values()].map((a) => ({ payment_id: paymentId, fee_item_id: a.item.id, amount: toDb(a.amount) }))).execute();
  for (const a of merged.values()) {
    await trx.updateTable('fee_items').set({ paid_amount: toDb(toPaise(a.item.paid_amount) + a.amount) }).where('id', '=', a.item.id).execute();
  }
  const accounts = [...new Set([...merged.values()].map((a) => a.item.student_fee_account_id))];
  await trx.updateTable('student_fee_accounts').set({ has_payments: 1 }).where('id', 'in', accounts).execute();
  // Freeze the balance printed on the receipt, so reprints never change (rule R1).
  const due = await trx.selectFrom('fee_items').select((eb) => eb.fn.sum<string>('balance').as('due')).where('student_id', '=', input.studentId).executeTakeFirst();
  await trx.updateTable('payments').set({ balance_after: due?.due ?? '0' }).where('id', '=', paymentId).execute();
  return { paymentId, publicId, receiptNo, total };
}

@Injectable()
export class PaymentsService {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService, private readonly accounts: FeeAccountsService) {}

  async collect(actor: RequestUser, input: CollectInput, meta: Meta) {
    const today = new Date().toISOString().slice(0, 10);
    if (input.paymentDate > today) throw Errors.validation([{ field: 'paymentDate', message: 'Payment date cannot be in the future.' }]);
    if (input.method !== 'cash' && !input.referenceNo) {
      throw Errors.validation([{ field: 'referenceNo', message: input.method === 'cheque' ? 'Enter the cheque number.' : 'Enter the transaction reference.' }]);
    }
    const r = await withRetry(this.db, async (trx) => {
      await this.accounts.ensureAccount(trx, input.studentId, (await currentYear(trx)).id);
      const r = await applyPayment(trx, actor.id, input, 'regular');
      await this.audit.log(actor, { module: 'payments', action: 'collect', entityType: 'payment', entityId: r.paymentId, after: { receiptNo: r.receiptNo, total: r.total / 100, lines: input.lines }, ...meta }, trx);
      return r;
    });
    return this.receipt(r.publicId);
  }

  /** Rule F28: payments are never edited or deleted; a void reverses the allocations and keeps the number. */
  async void(actor: RequestUser, publicId: string, reason: string, meta: Meta) {
    await withRetry(this.db, async (trx) => {
      const p = await trx.selectFrom('payments').select(['id', 'status', 'receipt_no']).where('public_id', '=', publicId).forUpdate().executeTakeFirst();
      if (!p) throw Errors.notFound('Receipt');
      // Agreed: a receipt touching a closed year can be voided only by the Institution Admin.
      const closed = await trx.selectFrom('payment_allocations as pa').innerJoin('fee_items as i', 'i.id', 'pa.fee_item_id').innerJoin('academic_years as y', 'y.id', 'i.academic_year_id')
        .select('y.name').where('pa.payment_id', '=', p.id).where('y.status', '=', 'closed').executeTakeFirst();
      if (closed && !isInstitutionAdmin(actor)) throw Errors.badRequest('CLOSED_YEAR_RECEIPT', `This receipt pays ${closed.name} fees. Only the Institution Admin can void it.`);
      if (p.status === 'void') throw Errors.badRequest('ALREADY_VOID', 'This receipt is already void.');
      const allocs = await trx.selectFrom('payment_allocations as pa').innerJoin('fee_items as i', 'i.id', 'pa.fee_item_id')
        .select(['pa.fee_item_id', 'pa.amount', 'i.paid_amount']).where('pa.payment_id', '=', p.id).forUpdate().execute();
      for (const a of allocs) {
        await trx.updateTable('fee_items').set({ paid_amount: toDb(toPaise(a.paid_amount) - toPaise(a.amount)) }).where('id', '=', a.fee_item_id).execute();
      }
      await trx.deleteFrom('payment_allocations').where('payment_id', '=', p.id).execute();
      await trx.updateTable('payments').set({ status: 'void', void_reason: reason, voided_by: actor.id, voided_at: new Date() }).where('id', '=', p.id).execute();
      await this.audit.log(actor, { module: 'payments', action: 'void', entityType: 'payment', entityId: p.id, after: { receiptNo: p.receipt_no, reason }, ...meta }, trx);
    });
    return this.receipt(publicId);
  }

  async findStudentId(publicId: string) {
    const p = await this.db.selectFrom('payments').select('student_id').where('public_id', '=', publicId).executeTakeFirst();
    if (!p) throw Errors.notFound('Receipt');
    return p.student_id;
  }

  /** Everything printed on a receipt (requirements 10). */
  async receipt(publicId: string) {
    const p = await this.db.selectFrom('payments as p')
      .innerJoin('students as s', 's.id', 'p.student_id').innerJoin('families as f', 'f.id', 's.family_id')
      .innerJoin('academic_years as y', 'y.id', 'p.academic_year_id').innerJoin('users as c', 'c.id', 'p.collected_by')
      .leftJoin('users as v', 'v.id', 'p.voided_by')
      .leftJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 's.id').onRef('e.academic_year_id', '=', 'p.academic_year_id'))
      .leftJoin('classes as cl', 'cl.id', 'e.class_id').leftJoin('sections as sec', 'sec.id', 'e.section_id')
      .select(['p.id', 'p.public_id', 'p.receipt_no', 'p.receipt_type', 'p.payment_date', 'p.total_amount', 'p.method', 'p.reference_no', 'p.remarks',
        'p.line_items', 'p.balance_after', 'p.status', 'p.void_reason', 'p.voided_at', 'p.created_at', 'p.student_id', 'y.name as year', 'c.name as collected_by', 'v.name as voided_by',
        's.public_id as student_public_id', 's.first_name', 's.last_name', 's.admission_no', 'cl.name as class_name', 'sec.name as section_name',
        'f.family_name', 'f.father_name', 'f.primary_mobile'])
      .where('p.public_id', '=', publicId).executeTakeFirst();
    if (!p) throw Errors.notFound('Receipt');
    const inst = await this.db.selectFrom('institution_settings').select(['name', 'address', 'phone', 'contact_email', 'brand_primary', 'logo_file_id']).where('id', '=', 1).executeTakeFirstOrThrow();
    const { id, student_id, balance_after, ...rest } = p;
    return { ...rest, line_items: readJson<ReceiptLine[]>(p.line_items) ?? [], balance_due: balance_after, institution: inst };
  }
}

/**
 * Waiver for a CLOSED year only (agreed): writes off part or all of what is still unpaid,
 * latest installment first, without touching the fee or any receipt.
 */
export async function waiveDues(db: Database, actor: RequestUser, studentId: number, yearId: number, amountRupees: number, reason: string) {
  return withRetry(db, async (trx) => {
    const y = await trx.selectFrom('academic_years').select(['name', 'status']).where('id', '=', yearId).executeTakeFirst();
    if (!y) throw Errors.notFound('Academic year');
    if (y.status !== 'closed') throw Errors.badRequest('YEAR_NOT_CLOSED', 'Waivers are only for dues of closed (past) years.');
    const items = await trx.selectFrom('fee_items').select(['id', 'label', 'amount', 'paid_amount', 'waived_amount', 'due_date', 'installment_no'])
      .where('student_id', '=', studentId).where('academic_year_id', '=', yearId).forUpdate().execute();
    const bal = (i: (typeof items)[number]) => toPaise(i.amount) - toPaise(i.paid_amount) - toPaise(i.waived_amount);
    const due = items.reduce((t, i) => t + bal(i), 0);
    let left = Math.round(amountRupees * 100);
    if (left <= 0) throw Errors.validation([{ field: 'amount', message: 'Enter an amount.' }]);
    if (left > due) throw Errors.validation([{ field: 'amount', message: `Only ₹${(due / 100).toLocaleString('en-IN')} is unpaid for ${y.name}.` }]);
    const order = [...items].filter((i) => bal(i) > 0).sort((a, b) =>
      (b.due_date ? +new Date(b.due_date) : 0) - (a.due_date ? +new Date(a.due_date) : 0) || (b.installment_no ?? 0) - (a.installment_no ?? 0) || b.id - a.id);
    const res = await trx.insertInto('fee_waivers').values({ student_id: studentId, academic_year_id: yearId, amount: toDb(left), reason, created_by: actor.id }).executeTakeFirstOrThrow();
    const waiverId = Number(res.insertId);
    for (const it of order) {
      if (left <= 0) break;
      const take = Math.min(left, bal(it));
      await trx.updateTable('fee_items').set({ waived_amount: toDb(toPaise(it.waived_amount) + take) }).where('id', '=', it.id).execute();
      await trx.insertInto('fee_waiver_items').values({ waiver_id: waiverId, fee_item_id: it.id, amount: toDb(take) }).execute();
      left -= take;
    }
    return { waiverId, year: y.name };
  });
}
