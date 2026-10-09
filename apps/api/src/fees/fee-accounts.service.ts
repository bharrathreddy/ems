import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { splitInstallments, toDb, toPaise } from './money';

/**
 * A student's fees for one academic year live in one student_fee_accounts row plus fee_items
 * (one row per tuition installment, one bus row, one row per one-time fee).
 *
 * Locks (requirements 9):
 *  - discounts and bus route: locked after the first payment of the year (F10, F17)
 *  - plan: locked once the year has started (F4). Exception: an account created after the year
 *    started (new admission or mid-year onboarding) may change plan until its first payment.
 * While unlocked, an account is rebuilt from the current setup whenever something changes.
 */
@Injectable()
export class FeeAccountsService {
  constructor(@Inject(KYSELY) private readonly db: Database) {}

  async setupFor(trx: Database, yearId: number) {
    const s = await trx.selectFrom('academic_year_fee_settings').select('default_fee_plan_id').where('academic_year_id', '=', yearId).executeTakeFirst();
    return s?.default_fee_plan_id ?? null;
  }

  /** Creates the student's account for the year if fees are configured for their class. Returns the account id or null. */
  async ensureAccount(trx: Database, studentId: number, yearId: number): Promise<number | null> {
    const existing = await trx.selectFrom('student_fee_accounts').select(['id', 'has_payments', 'class_id'])
      .where('student_id', '=', studentId).where('academic_year_id', '=', yearId).executeTakeFirst();
    const enr = await trx.selectFrom('enrollments').select('class_id').where('student_id', '=', studentId).where('academic_year_id', '=', yearId).executeTakeFirst();
    if (existing) {
      // Student moved class before paying anything: re-price for the new class.
      if (enr && enr.class_id !== existing.class_id && !existing.has_payments) {
        const fee = await this.classFee(trx, yearId, enr.class_id);
        if (fee !== null) {
          await trx.updateTable('student_fee_accounts').set({ class_id: enr.class_id, tuition_gross: toDb(fee), tuition_discount: '0' }).where('id', '=', existing.id).execute();
          await this.rebuild(trx, existing.id);
        }
      }
      return existing.id;
    }
    if (!enr) return null;
    const [planId, fee] = await Promise.all([this.setupFor(trx, yearId), this.classFee(trx, yearId, enr.class_id)]);
    if (!planId || fee === null) return null;
    const res = await trx.insertInto('student_fee_accounts').values({
      academic_year_id: yearId, student_id: studentId, fee_plan_id: planId, class_id: enr.class_id, tuition_gross: toDb(fee),
    }).ignore().executeTakeFirst();
    const id = Number(res.insertId) || (await trx.selectFrom('student_fee_accounts').select('id').where('student_id', '=', studentId).where('academic_year_id', '=', yearId).executeTakeFirstOrThrow()).id;
    await this.rebuild(trx, id);
    return id;
  }

  private async classFee(trx: Database, yearId: number, classId: number) {
    const r = await trx.selectFrom('class_tuition_fees').select('amount').where('academic_year_id', '=', yearId).where('class_id', '=', classId).executeTakeFirst();
    return r ? toPaise(r.amount) : null;
  }

  /** Recreates tuition, bus and one-time items from the current setup. Only for accounts without payments. */
  async rebuild(trx: Database, accountId: number) {
    const a = await trx.selectFrom('student_fee_accounts as a').innerJoin('fee_plans as p', 'p.id', 'a.fee_plan_id')
      .select(['a.id', 'a.academic_year_id', 'a.student_id', 'a.fee_plan_id', 'a.class_id', 'a.tuition_gross', 'a.tuition_discount',
        'a.bus_route_id', 'a.bus_discount', 'a.has_payments', 'p.installment_count', 'p.name as plan_name'])
      .where('a.id', '=', accountId).forUpdate().executeTakeFirstOrThrow();
    if (a.has_payments) throw Errors.badRequest('FEES_LOCKED', 'Fee details are locked after the first payment.');
    const busFee = a.bus_route_id
      ? await trx.selectFrom('route_fees').select(['amount', 'due_date']).where('academic_year_id', '=', a.academic_year_id).where('bus_route_id', '=', a.bus_route_id).executeTakeFirst()
      : undefined;
    const busGross = busFee ? toPaise(busFee.amount) : 0;
    const busDiscount = Math.min(toPaise(a.bus_discount), busGross);
    await trx.updateTable('student_fee_accounts').set({ bus_gross: toDb(busGross), bus_discount: toDb(busDiscount) }).where('id', '=', a.id).execute();

    await trx.deleteFrom('fee_items').where('student_fee_account_id', '=', a.id).execute();
    const due = await trx.selectFrom('plan_installments').select(['installment_no', 'label', 'due_date'])
      .where('academic_year_id', '=', a.academic_year_id).where('fee_plan_id', '=', a.fee_plan_id).execute();
    const amounts = splitInstallments(toPaise(a.tuition_gross) - toPaise(a.tuition_discount), a.installment_count);
    const defaultLabel = (n: number) => (a.installment_count === 1 ? 'Annual' : a.installment_count === 2 ? `Term ${n}` : `Q${n}`);
    const rows: any[] = amounts.map((amt, i) => {
      const d = due.find((x) => x.installment_no === i + 1);
      return { academic_year_id: a.academic_year_id, student_id: a.student_id, student_fee_account_id: a.id, category: 'tuition',
        installment_no: i + 1, label: `Tuition ${d?.label ?? defaultLabel(i + 1)}`, due_date: d?.due_date ?? null, amount: toDb(amt) };
    });
    if (busGross > 0) {
      rows.push({ academic_year_id: a.academic_year_id, student_id: a.student_id, student_fee_account_id: a.id, category: 'bus',
        installment_no: null, label: 'Bus fee', due_date: busFee?.due_date ?? null, amount: toDb(busGross - busDiscount) });
    }
    const oneTime = await trx.selectFrom('class_one_time_fees').select(['id', 'title', 'amount', 'due_date'])
      .where('academic_year_id', '=', a.academic_year_id).where('class_id', '=', a.class_id).execute();
    for (const o of oneTime) {
      rows.push({ academic_year_id: a.academic_year_id, student_id: a.student_id, student_fee_account_id: a.id, category: 'one_time',
        class_one_time_fee_id: o.id, label: o.title, due_date: o.due_date, amount: o.amount });
    }
    if (rows.length) await trx.insertInto('fee_items').values(rows).execute();
  }

  /** Makes sure every active student enrolled this year has an account (idempotent, used before reports). */
  async syncYear(yearId: number) {
    const missing = await this.db.selectFrom('enrollments as e').innerJoin('students as s', 's.id', 'e.student_id')
      .leftJoin('student_fee_accounts as a', (j) => j.onRef('a.student_id', '=', 'e.student_id').on('a.academic_year_id', '=', yearId))
      .select('e.student_id').where('e.academic_year_id', '=', yearId).where('s.status', '=', 'active').where('a.id', 'is', null).execute();
    let created = 0;
    for (const m of missing) {
      const id = await this.db.transaction().execute((trx) => this.ensureAccount(trx, m.student_id, yearId));
      if (id) created++;
    }
    return { created, notConfigured: missing.length - created };
  }

  /** Rebuild every unlocked account matching a filter (after a setup change). Returns counts for the UI. */
  async rebuildUnlocked(yearId: number, where: { classId?: number; routeId?: number; planId?: number }) {
    let q = this.db.selectFrom('student_fee_accounts').select(['id', 'has_payments']).where('academic_year_id', '=', yearId);
    if (where.classId) q = q.where('class_id', '=', where.classId);
    if (where.routeId) q = q.where('bus_route_id', '=', where.routeId);
    if (where.planId) q = q.where('fee_plan_id', '=', where.planId);
    const rows = await q.execute();
    let updated = 0, locked = 0;
    for (const r of rows) {
      if (r.has_payments) { locked++; continue; }
      await this.db.transaction().execute(async (trx) => {
        if (where.classId) {
          const fee = await this.classFee(trx, yearId, where.classId);
          if (fee !== null) await trx.updateTable('student_fee_accounts').set({ tuition_gross: toDb(fee) }).where('id', '=', r.id).execute();
        }
        await this.rebuild(trx, r.id);
      });
      updated++;
    }
    return { updated, locked };
  }

  planChangeAllowed(account: { has_payments: number; created_at: Date }, year: { start_date: Date }) {
    if (account.has_payments) return false;
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    return today < new Date(year.start_date) || new Date(account.created_at) >= new Date(year.start_date);
  }

  /** Everything the Fees tab and the collection screen need for one student. */
  async view(studentId: number, yearId: number) {
    await this.db.transaction().execute((trx) => this.ensureAccount(trx, studentId, yearId));
    const [account, items, payments] = await Promise.all([
      this.db.selectFrom('student_fee_accounts as a').innerJoin('fee_plans as p', 'p.id', 'a.fee_plan_id')
        .innerJoin('academic_years as y', 'y.id', 'a.academic_year_id')
        .leftJoin('bus_routes as r', 'r.id', 'a.bus_route_id')
        .leftJoin('concession_types as tc', 'tc.id', 'a.tuition_concession_type_id')
        .leftJoin('concession_types as bc', 'bc.id', 'a.bus_concession_type_id')
        .select(['a.id', 'a.fee_plan_id', 'p.plan_key', 'p.name as plan_name', 'a.tuition_gross', 'a.tuition_discount', 'a.tuition_concession_type_id',
          'tc.name as tuition_concession', 'a.bus_route_id', 'r.name as bus_route', 'a.bus_gross', 'a.bus_discount', 'a.bus_concession_type_id',
          'bc.name as bus_concession', 'a.has_payments', 'a.created_at', 'y.start_date', 'y.name as year'])
        .where('a.student_id', '=', studentId).where('a.academic_year_id', '=', yearId).executeTakeFirst(),
      this.db.selectFrom('fee_items as i').innerJoin('academic_years as y', 'y.id', 'i.academic_year_id')
        .select(['i.id', 'i.academic_year_id', 'y.name as year', 'y.status as year_status', 'i.category', 'i.installment_no', 'i.label', 'i.due_date', 'i.amount', 'i.paid_amount', 'i.waived_amount', 'i.balance'])
        .where('i.student_id', '=', studentId)
        .where((eb) => eb.or([eb('i.academic_year_id', '=', yearId), eb('i.balance', '>', sql<any>`0`)]))
        .orderBy('y.start_date').orderBy(sql`FIELD(i.category, 'tuition', 'bus', 'one_time')`).orderBy('i.installment_no').orderBy('i.id').execute(),
      this.db.selectFrom('payments as p').innerJoin('users as u', 'u.id', 'p.collected_by').innerJoin('academic_years as y', 'y.id', 'p.academic_year_id')
        .select(['p.public_id', 'p.receipt_no', 'p.receipt_type', 'p.payment_date', 'p.total_amount', 'p.method', 'p.status', 'p.void_reason', 'u.name as collected_by', 'y.name as year'])
        .where('p.student_id', '=', studentId).orderBy('p.payment_date', 'desc').orderBy('p.id', 'desc').execute(),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const items2 = items.map((i) => {
      const bal = toPaise(i.balance as any);
      const paid = toPaise(i.paid_amount);
      const dueStr = i.due_date ? new Date(i.due_date).toISOString().slice(0, 10) : null;
      const waived = toPaise(i.waived_amount);
      const status = bal <= 0 ? (waived > 0 && paid < toPaise(i.amount) ? 'waived' : 'paid') : paid > 0 || waived > 0 ? 'partial' : dueStr && dueStr <= today ? 'due' : 'not_due';
      return { ...i, due_date: dueStr, previous_year: i.academic_year_id !== yearId, status, overdue: bal > 0 && !!dueStr && dueStr < today };
    });
    const sum = (f: (x: (typeof items2)[number]) => boolean, k: 'amount' | 'paid_amount' | 'waived_amount' | 'balance') => items2.filter(f).reduce((t, x) => t + toPaise(x[k] as any), 0);
    const totals = {
      thisYear: { amount: sum((x) => !x.previous_year, 'amount'), paid: sum((x) => !x.previous_year, 'paid_amount'), balance: sum((x) => !x.previous_year, 'balance') },
      previousYears: sum((x) => x.previous_year, 'balance'),
      waived: sum(() => true, 'waived_amount'),
      overdue: sum((x) => x.overdue, 'balance'),
    };
    return {
      configured: !!account,
      account: account ? {
        ...account, has_payments: account.has_payments === 1,
        plan_change_allowed: this.planChangeAllowed(account, { start_date: account.start_date }),
        details_locked: account.has_payments === 1,
      } : null,
      items: items2,
      totals: { thisYear: { amount: totals.thisYear.amount / 100, paid: totals.thisYear.paid / 100, balance: totals.thisYear.balance / 100 },
        previousYears: totals.previousYears / 100, waived: totals.waived / 100, overdue: totals.overdue / 100, totalDue: (totals.thisYear.balance + totals.previousYears) / 100 },
      payments,
      waivers: await this.db.selectFrom('fee_waivers as w').innerJoin('academic_years as y', 'y.id', 'w.academic_year_id').innerJoin('users as u', 'u.id', 'w.created_by')
        .select(['w.id', 'y.name as year', 'w.amount', 'w.reason', 'u.name as by', 'w.created_at']).where('w.student_id', '=', studentId).orderBy('w.id', 'desc').execute(),
    };
  }
}
