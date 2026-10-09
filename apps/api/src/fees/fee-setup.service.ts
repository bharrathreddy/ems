import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { resolveYear } from '../common/academic-year';
import type { RequestUser } from '../common/request-user';
import { FeeAccountsService } from './fee-accounts.service';
import { toDb, toPaise } from './money';

type Meta = { ip: string | null; userAgent: string | null };
type PlanKey = 'yearly' | 'half_yearly' | 'quarterly';

/** Fee structure for the current academic year (requirements 9.1 to 9.6). */
@Injectable()
export class FeeSetupService {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService, private readonly accounts: FeeAccountsService) {}

  /** Exact copy of a year's fee setup into a planned year, due dates moved forward by the gap between the years (agreed Q6). */
  async copy(u: RequestUser, fromYearId: number, toYearId: number, meta: Meta) {
    const from = await resolveYear(this.db, fromYearId, false);
    const to = await resolveYear(this.db, toYearId, true);
    if (to.id === from.id) throw Errors.badRequest('SAME_YEAR', 'Choose a different year to copy from.');
    const [hasFees, hasPlan] = await Promise.all([
      this.db.selectFrom('class_tuition_fees').select('class_id').where('academic_year_id', '=', to.id).executeTakeFirst(),
      this.db.selectFrom('academic_year_fee_settings').select('academic_year_id').where('academic_year_id', '=', to.id).executeTakeFirst(),
    ]);
    if (hasFees || hasPlan) throw Errors.badRequest('ALREADY_SET_UP', `${to.name} already has a fee setup. Edit it directly instead.`);
    const years = new Date(to.start_date).getUTCFullYear() - new Date(from.start_date).getUTCFullYear() || 1;
    await this.db.transaction().execute(async (trx) => {
      const s = await trx.selectFrom('academic_year_fee_settings').select('default_fee_plan_id').where('academic_year_id', '=', from.id).executeTakeFirst();
      if (s) await trx.insertInto('academic_year_fee_settings').values({ academic_year_id: to.id, default_fee_plan_id: s.default_fee_plan_id, updated_by: u.id }).execute();
      const inst = await trx.selectFrom('plan_installments').selectAll().where('academic_year_id', '=', from.id).execute();
      if (inst.length) await trx.insertInto('plan_installments').values(inst.map((i) => ({ ...i, academic_year_id: to.id, due_date: plusYears(i.due_date, years)! }))).execute();
      const cf = await trx.selectFrom('class_tuition_fees').select(['class_id', 'amount']).where('academic_year_id', '=', from.id).execute();
      if (cf.length) await trx.insertInto('class_tuition_fees').values(cf.map((c) => ({ academic_year_id: to.id, class_id: c.class_id, amount: c.amount, updated_by: u.id }))).execute();
      const rf = await trx.selectFrom('route_fees').selectAll().where('academic_year_id', '=', from.id).execute();
      if (rf.length) await trx.insertInto('route_fees').values(rf.map((r) => ({ ...r, academic_year_id: to.id, due_date: plusYears(r.due_date, years) }))).execute();
      const ot = await trx.selectFrom('class_one_time_fees').select(['class_id', 'one_time_fee_type_id', 'title', 'amount', 'due_date']).where('academic_year_id', '=', from.id).execute();
      if (ot.length) await trx.insertInto('class_one_time_fees').values(ot.map((o) => ({ ...o, academic_year_id: to.id, due_date: plusYears(o.due_date, years), created_by: u.id }))).execute();
      await this.audit.log(u, { module: 'fees', action: 'copy_setup', after: { from: from.name, to: to.name }, ...meta }, trx);
    });
    return this.get(to.id);
  }

  async get(yearId?: number) {
    const year = await resolveYear(this.db, yearId, false);
    const [plans, settings, installments, classFees, classes, routes, routeFees, concessions, oneTimeTypes, oneTime, accounts] = await Promise.all([
      this.db.selectFrom('fee_plans').selectAll().orderBy('installment_count').execute(),
      this.db.selectFrom('academic_year_fee_settings').selectAll().where('academic_year_id', '=', year.id).executeTakeFirst(),
      this.db.selectFrom('plan_installments').selectAll().where('academic_year_id', '=', year.id).orderBy('installment_no').execute(),
      this.db.selectFrom('class_tuition_fees').select(['class_id', 'amount']).where('academic_year_id', '=', year.id).execute(),
      this.db.selectFrom('classes').select(['id', 'name', 'level_order']).where('is_active', '=', 1).orderBy('level_order').execute(),
      this.db.selectFrom('bus_routes').selectAll().orderBy('name').execute(),
      this.db.selectFrom('route_fees').select(['bus_route_id', 'amount', 'due_date']).where('academic_year_id', '=', year.id).execute(),
      this.db.selectFrom('concession_types').selectAll().orderBy('name').execute(),
      this.db.selectFrom('one_time_fee_types').selectAll().orderBy('name').execute(),
      this.db.selectFrom('class_one_time_fees as o').innerJoin('classes as c', 'c.id', 'o.class_id').innerJoin('one_time_fee_types as t', 't.id', 'o.one_time_fee_type_id')
        .select(['o.id', 'o.class_id', 'c.name as class_name', 'o.one_time_fee_type_id', 't.name as type', 'o.title', 'o.amount', 'o.due_date'])
        .where('o.academic_year_id', '=', year.id).orderBy('c.level_order').orderBy('o.id').execute(),
      this.db.selectFrom('student_fee_accounts').select((eb) => [eb.fn.countAll<number>().as('total'), eb.fn.sum<number>('has_payments').as('locked')])
        .where('academic_year_id', '=', year.id).executeTakeFirst(),
    ]);
    return {
      academicYear: { id: year.id, name: year.name, startDate: year.start_date, endDate: year.end_date, status: year.status, editable: year.status !== 'closed' },
      defaultPlanId: settings?.default_fee_plan_id ?? null,
      plans: plans.map((p) => ({ ...p, installments: installments.filter((i) => i.fee_plan_id === p.id) })),
      classFees: classes.map((c) => ({ classId: c.id, className: c.name, amount: classFees.find((f) => f.class_id === c.id)?.amount ?? null })),
      routes: routes.map((r) => ({ ...r, fee: routeFees.find((f) => f.bus_route_id === r.id) ?? null })),
      concessionTypes: concessions, oneTimeTypes, oneTimeFees: oneTime,
      accounts: { total: Number(accounts?.total ?? 0), locked: Number(accounts?.locked ?? 0) },
    };
  }

  private async plan(key: PlanKey) {
    return this.db.selectFrom('fee_plans').selectAll().where('plan_key', '=', key).executeTakeFirstOrThrow();
  }

  async setDefaultPlan(u: RequestUser, key: PlanKey, meta: Meta, yearId?: number) {
    const year = await resolveYear(this.db, yearId, true);
    const plan = await this.plan(key);
    const prev = await this.accounts.setupFor(this.db, year.id);
    await this.db.insertInto('academic_year_fee_settings').values({ academic_year_id: year.id, default_fee_plan_id: plan.id, updated_by: u.id })
      .onDuplicateKeyUpdate({ default_fee_plan_id: plan.id, updated_by: u.id }).execute();
    // Students still on the old default and still allowed to change plan follow the new default.
    let moved = 0;
    if (prev && prev !== plan.id) {
      const rows = await this.db.selectFrom('student_fee_accounts').select(['id', 'has_payments', 'created_at']).where('academic_year_id', '=', year.id).where('fee_plan_id', '=', prev).execute();
      for (const r of rows) {
        if (!this.accounts.planChangeAllowed(r, year)) continue;
        await this.db.transaction().execute(async (trx) => {
          await trx.updateTable('student_fee_accounts').set({ fee_plan_id: plan.id }).where('id', '=', r.id).execute();
          await this.accounts.rebuild(trx, r.id);
        });
        moved++;
      }
    }
    await this.audit.log(u, { module: 'fees', action: 'set_default_plan', after: { plan: key, moved }, ...meta });
    return { defaultPlan: key, studentsMoved: moved };
  }

  async setInstallments(u: RequestUser, key: PlanKey, items: Array<{ installmentNo: number; label: string; dueDate: string }>, meta: Meta, yearId?: number) {
    const year = await resolveYear(this.db, yearId, true);
    const plan = await this.plan(key);
    const nos = items.map((i) => i.installmentNo).sort();
    if (items.length !== plan.installment_count || nos.some((n, i) => n !== i + 1)) {
      throw Errors.validation([{ field: 'items', message: `${plan.name} needs exactly ${plan.installment_count} installment(s).` }]);
    }
    const sorted = [...items].sort((a, b) => a.installmentNo - b.installmentNo);
    if (sorted.some((it, i) => i > 0 && it.dueDate <= sorted[i - 1].dueDate)) {
      throw Errors.validation([{ field: 'items', message: 'Due dates must be in order, each after the previous one.' }]);
    }
    await this.db.transaction().execute(async (trx) => {
      for (const it of items) {
        await trx.insertInto('plan_installments').values({ academic_year_id: year.id, fee_plan_id: plan.id, installment_no: it.installmentNo, label: it.label, due_date: new Date(`${it.dueDate}T00:00:00Z`) })
          .onDuplicateKeyUpdate({ label: it.label, due_date: new Date(`${it.dueDate}T00:00:00Z`) }).execute();
        // Labels and due dates may change at any time; amounts are untouched.
        await trx.updateTable('fee_items')
          .set({ label: `Tuition ${it.label}`, due_date: new Date(`${it.dueDate}T00:00:00Z`) })
          .where('category', '=', 'tuition').where('installment_no', '=', it.installmentNo)
          .where('student_fee_account_id', 'in', trx.selectFrom('student_fee_accounts').select('id')
            .where('academic_year_id', '=', year.id).where('fee_plan_id', '=', plan.id))
          .execute();
      }
    });
    await this.audit.log(u, { module: 'fees', action: 'set_installments', after: { plan: key, items }, ...meta });
    return { saved: true };
  }

  async setClassFees(u: RequestUser, items: Array<{ classId: number; amount: number }>, meta: Meta, yearId?: number) {
    const year = await resolveYear(this.db, yearId, true);
    let updated = 0, locked = 0;
    for (const it of items) {
      const cur = await this.db.selectFrom('class_tuition_fees').select('amount').where('academic_year_id', '=', year.id).where('class_id', '=', it.classId).executeTakeFirst();
      if (cur && toPaise(cur.amount) === Math.round(it.amount * 100)) continue;
      await this.db.insertInto('class_tuition_fees').values({ academic_year_id: year.id, class_id: it.classId, amount: toDb(Math.round(it.amount * 100)), updated_by: u.id })
        .onDuplicateKeyUpdate({ amount: toDb(Math.round(it.amount * 100)), updated_by: u.id }).execute();
      const r = await this.accounts.rebuildUnlocked(year.id, { classId: it.classId });
      updated += r.updated; locked += r.locked;
    }
    await this.audit.log(u, { module: 'fees', action: 'set_class_fees', after: { items, updated, locked }, ...meta });
    return { studentsUpdated: updated, studentsLocked: locked };
  }

  async createRoute(u: RequestUser, name: string, meta: Meta) {
    const res = await this.db.insertInto('bus_routes').values({ name }).executeTakeFirstOrThrow();
    await this.audit.log(u, { module: 'fees', action: 'create_route', entityType: 'bus_route', entityId: Number(res.insertId), after: { name }, ...meta });
    return { id: Number(res.insertId) };
  }

  async updateRoute(u: RequestUser, id: number, b: { name?: string; isActive?: boolean }, meta: Meta) {
    await this.db.updateTable('bus_routes').set({ ...(b.name && { name: b.name }), ...(b.isActive !== undefined && { is_active: b.isActive ? 1 : 0 }) }).where('id', '=', id).execute();
    await this.audit.log(u, { module: 'fees', action: 'update_route', entityType: 'bus_route', entityId: id, after: b, ...meta });
    return { id };
  }

  async setRouteFees(u: RequestUser, items: Array<{ routeId: number; amount: number; dueDate?: string | null }>, meta: Meta, yearId?: number) {
    const year = await resolveYear(this.db, yearId, true);
    let updated = 0, locked = 0;
    for (const it of items) {
      const due = it.dueDate ? new Date(`${it.dueDate}T00:00:00Z`) : null;
      await this.db.insertInto('route_fees').values({ academic_year_id: year.id, bus_route_id: it.routeId, amount: toDb(Math.round(it.amount * 100)), due_date: due })
        .onDuplicateKeyUpdate({ amount: toDb(Math.round(it.amount * 100)), due_date: due }).execute();
      const r = await this.accounts.rebuildUnlocked(year.id, { routeId: it.routeId });
      updated += r.updated; locked += r.locked;
    }
    await this.audit.log(u, { module: 'fees', action: 'set_route_fees', after: { items, updated, locked }, ...meta });
    return { studentsUpdated: updated, studentsLocked: locked };
  }

  async createNamed(u: RequestUser, table: 'concession_types' | 'one_time_fee_types', name: string, meta: Meta) {
    const res = await this.db.insertInto(table).values({ name }).executeTakeFirstOrThrow();
    await this.audit.log(u, { module: 'fees', action: `create_${table}`, after: { name }, ...meta });
    return { id: Number(res.insertId) };
  }

  /** Rule F20/F21/F22: one-time fee for a whole class, same amount for everyone. */
  async createOneTime(u: RequestUser, b: { classId: number; typeId: number; title: string; amount: number; dueDate?: string | null }, meta: Meta, yearId?: number) {
    const year = await resolveYear(this.db, yearId, true);
    const id = await this.db.transaction().execute(async (trx) => {
      const res = await trx.insertInto('class_one_time_fees').values({
        academic_year_id: year.id, class_id: b.classId, one_time_fee_type_id: b.typeId, title: b.title,
        amount: toDb(Math.round(b.amount * 100)), due_date: b.dueDate ? new Date(`${b.dueDate}T00:00:00Z`) : null, created_by: u.id,
      }).executeTakeFirstOrThrow();
      const id = Number(res.insertId);
      // Students of the class who already have an account get the new item now; others get it when their account is created.
      const accs = await trx.selectFrom('student_fee_accounts as a').innerJoin('students as s', 's.id', 'a.student_id')
        .select(['a.id', 'a.student_id']).where('a.academic_year_id', '=', year.id).where('a.class_id', '=', b.classId).where('s.status', '=', 'active').execute();
      if (accs.length) {
        await trx.insertInto('fee_items').values(accs.map((a) => ({
          academic_year_id: year.id, student_id: a.student_id, student_fee_account_id: a.id, category: 'one_time' as const,
          class_one_time_fee_id: id, label: b.title, due_date: b.dueDate ? new Date(`${b.dueDate}T00:00:00Z`) : null, amount: toDb(Math.round(b.amount * 100)),
        }))).execute();
      }
      return id;
    });
    await this.audit.log(u, { module: 'fees', action: 'create_one_time_fee', entityType: 'class_one_time_fee', entityId: id, after: b, ...meta });
    return { id };
  }

  async deleteOneTime(u: RequestUser, id: number, meta: Meta) {
    const o = await this.db.selectFrom('class_one_time_fees').select('academic_year_id').where('id', '=', id).executeTakeFirst();
    if (!o) throw Errors.notFound('One-time fee');
    await resolveYear(this.db, o.academic_year_id, true);
    await this.db.transaction().execute(async (trx) => {
      const paid = await trx.selectFrom('fee_items').select('id').where('class_one_time_fee_id', '=', id).where('paid_amount', '>', '0').executeTakeFirst();
      if (paid) throw Errors.badRequest('ONE_TIME_FEE_PAID', 'Some students have already paid this fee, so it cannot be removed.');
      await trx.deleteFrom('fee_items').where('class_one_time_fee_id', '=', id).execute();
      await trx.deleteFrom('class_one_time_fees').where('id', '=', id).execute();
    });
    await this.audit.log(u, { module: 'fees', action: 'delete_one_time_fee', entityType: 'class_one_time_fee', entityId: id, ...meta });
    return { id };
  }
}

/** Shifts a date by whole years (Feb 29 becomes Feb 28). */
export function plusYears(d: Date | null, n = 1) {
  if (!d) return null;
  const x = new Date(d);
  const m = x.getUTCMonth();
  x.setUTCFullYear(x.getUTCFullYear() + n);
  if (x.getUTCMonth() !== m) x.setUTCDate(0);
  return x;
}
