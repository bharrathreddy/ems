import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { newPublicId } from '../common/ids';
import { readJson } from '../common/json';
import type { RequestUser } from '../common/request-user';
import { PermissionsService } from '../permissions/permissions.service';
import { eachDay, iso, SchoolCalendar, schoolToday } from '../attendance/calendar';
import { monthEnd } from '../attendance/attendance.service';
import { toDb, toPaise, type Paise } from '../fees/money';
import { calculateSlip, type Adjustment, type Calc, type Kind, type PayItem, type SlipLine } from './calc';
import { ExpensesService, type Method } from './expenses.service';

type Meta = { ip: string | null; userAgent: string | null };
export type DivisorRule = 'month_days' | 'thirty' | 'working_days';
export interface PayrollRules { lopDivisor: DivisorRule }
export interface ComponentBody { code: string; name: string; kind: Kind; calc: Calc; defaultValue: number; maxAmount?: number | null; prorate: boolean; isActive?: boolean; sortOrder?: number }
export interface SalaryLine { componentId: number; value: number }

const r2 = (p: Paise) => p / 100;
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const valueOf = (calc: Calc, v: string | number) => toPaise(typeof v === 'number' ? v : v); // paise, or percent x 100

/** Working-day calendar for a month (from the academic year it falls in; Mon to Sat otherwise). */
async function monthCalendar(db: Database, month: string) {
  const start = `${month}-01`, end = monthEnd(month);
  const y = await db.selectFrom('academic_years').select('id').where('start_date', '<=', new Date(`${end}T00:00:00Z`)).where('end_date', '>=', new Date(`${start}T00:00:00Z`)).orderBy('id', 'desc').executeTakeFirst();
  const cal = y ? await SchoolCalendar.load(db, y.id) : null;
  const isWorking = (d: string) => (cal && d >= cal.start && d <= cal.end ? cal.isWorking(d) : new Date(`${d}T00:00:00Z`).getUTCDay() !== 0);
  return { start, end, days: eachDay(start, end), isWorking };
}

@Injectable()
export class PayrollService {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService, private readonly expenses: ExpensesService, private readonly perms: PermissionsService) {}

  // ---------------- Rules ----------------
  async rules(): Promise<PayrollRules> {
    const r = await this.db.selectFrom('settings').select('value').where('setting_group', '=', 'payroll').where('setting_key', '=', 'rules').executeTakeFirst();
    return { lopDivisor: 'month_days', ...(readJson<PayrollRules>(r?.value) ?? {}) };
  }
  async setRules(u: RequestUser, rules: PayrollRules, meta: Meta) {
    await this.db.insertInto('settings').values({ setting_group: 'payroll', setting_key: 'rules', value: JSON.stringify(rules), updated_by: u.id })
      .onDuplicateKeyUpdate({ value: JSON.stringify(rules), updated_by: u.id }).execute();
    await this.audit.log(u, { module: 'payroll', action: 'set_rules', after: rules, ...meta });
    return rules;
  }

  // ---------------- Pay items ----------------
  async components() {
    const rows = await this.db.selectFrom('pay_components').selectAll().orderBy('sort_order').orderBy('id').execute();
    const used = new Set((await this.db.selectFrom('staff_salary_lines').select('component_id').distinct().execute()).map((r) => r.component_id));
    return rows.map((c) => ({ id: c.id, code: c.code, name: c.name, kind: c.kind, calc: c.calc, defaultValue: Number(c.default_value), maxAmount: c.max_amount == null ? null : Number(c.max_amount),
      prorate: !!c.prorate, isBasic: !!c.is_basic, isActive: !!c.is_active, sortOrder: c.sort_order, inUse: used.has(c.id) }));
  }

  async saveComponent(u: RequestUser, id: number | null, b: ComponentBody, meta: Meta) {
    if (b.kind === 'earning' && b.calc === 'pct_gross') throw Errors.validation([{ field: 'calc', message: 'An earning can be a fixed amount or a % of Basic.' }]);
    if (b.calc !== 'fixed' && b.defaultValue > 100) throw Errors.validation([{ field: 'defaultValue', message: 'A percentage cannot be more than 100.' }]);
    const code = b.code.toUpperCase();
    const dup = await this.db.selectFrom('pay_components').select('id').where('code', '=', code).executeTakeFirst();
    if (dup && dup.id !== id) throw Errors.validation([{ field: 'code', message: 'Another pay item uses this short code.' }]);
    const row = { code, name: b.name, kind: b.kind, calc: b.calc, default_value: String(b.defaultValue), max_amount: b.maxAmount == null ? null : String(b.maxAmount),
      prorate: b.prorate ? 1 : 0, is_active: b.isActive === false ? 0 : 1, sort_order: b.sortOrder ?? 10 };
    if (id) {
      const c = await this.db.selectFrom('pay_components').selectAll().where('id', '=', id).executeTakeFirst();
      if (!c) throw Errors.notFound('Pay item');
      if (c.is_basic && (b.kind !== 'earning' || b.calc !== 'fixed' || b.isActive === false)) throw Errors.badRequest('BASIC_FIXED', 'Basic pay is always an active, fixed earning. You can rename it.');
      const inUse = await this.db.selectFrom('staff_salary_lines').select('component_id').where('component_id', '=', id).executeTakeFirst();
      if (inUse && (c.kind !== b.kind || c.calc !== b.calc)) throw Errors.badRequest('IN_USE', 'This pay item is already in salaries, so its type and calculation cannot change. Switch it off and add a new one.');
      await this.db.updateTable('pay_components').set(c.is_basic ? { ...row, prorate: 1 } : row).where('id', '=', id).execute();
    } else await this.db.insertInto('pay_components').values(row).execute();
    await this.audit.log(u, { module: 'payroll', action: id ? 'component_update' : 'component_create', entityType: 'pay_component', entityId: id ?? undefined, after: b, ...meta });
    return this.components();
  }

  // ---------------- Templates ----------------
  async templates() {
    const [ts, lines] = await Promise.all([
      this.db.selectFrom('salary_templates').selectAll().orderBy('name').execute(),
      this.db.selectFrom('salary_template_lines').selectAll().execute(),
    ]);
    const items = await this.itemsById();
    return ts.map((t) => {
      const ls = lines.filter((l) => l.template_id === t.id).map((l) => ({ componentId: l.component_id, value: Number(l.value) }));
      return { id: t.id, name: t.name, isActive: !!t.is_active, lines: ls, preview: this.preview(items, ls) };
    });
  }

  async saveTemplate(u: RequestUser, id: number | null, b: { name: string; isActive?: boolean; lines: SalaryLine[] }, meta: Meta) {
    await this.checkLines(b.lines);
    const dup = await this.db.selectFrom('salary_templates').select('id').where('name', '=', b.name).executeTakeFirst();
    if (dup && dup.id !== id) throw Errors.validation([{ field: 'name', message: 'A template with this name already exists.' }]);
    await this.db.transaction().execute(async (trx) => {
      let tid = id;
      if (tid) {
        if (!(await trx.selectFrom('salary_templates').select('id').where('id', '=', tid).executeTakeFirst())) throw Errors.notFound('Template');
        await trx.updateTable('salary_templates').set({ name: b.name, is_active: b.isActive === false ? 0 : 1 }).where('id', '=', tid).execute();
        await trx.deleteFrom('salary_template_lines').where('template_id', '=', tid).execute();
      } else tid = Number((await trx.insertInto('salary_templates').values({ name: b.name }).executeTakeFirstOrThrow()).insertId);
      await trx.insertInto('salary_template_lines').values(b.lines.map((l) => ({ template_id: tid!, component_id: l.componentId, value: String(l.value) }))).execute();
      await this.audit.log(u, { module: 'payroll', action: id ? 'template_update' : 'template_create', entityType: 'salary_template', entityId: tid!, after: b, ...meta }, trx);
    });
    return this.templates();
  }

  async deleteTemplate(u: RequestUser, id: number, meta: Meta) {
    await this.db.deleteFrom('salary_templates').where('id', '=', id).execute();
    await this.audit.log(u, { module: 'payroll', action: 'template_delete', entityType: 'salary_template', entityId: id, ...meta });
    return this.templates();
  }

  private async checkLines(lines: SalaryLine[]) {
    const items = await this.itemsById();
    const ids = new Set<number>();
    for (const l of lines) {
      const c = items.get(l.componentId);
      if (!c || !c.isActive) throw Errors.validation([{ field: 'lines', message: 'A pay item in this salary no longer exists or is switched off.' }]);
      if (ids.has(l.componentId)) throw Errors.validation([{ field: 'lines', message: `${c.name} is listed twice.` }]);
      if (c.calc !== 'fixed' && l.value > 100) throw Errors.validation([{ field: 'lines', message: `${c.name}: a percentage cannot be more than 100.` }]);
      ids.add(l.componentId);
    }
    const basic = [...items.values()].find((c) => c.isBasic)!;
    const b = lines.find((l) => l.componentId === basic.id);
    if (!b || b.value <= 0) throw Errors.validation([{ field: 'lines', message: `Enter the ${basic.name.toLowerCase()}.` }]);
  }

  private async itemsById() {
    return new Map((await this.components()).map((c) => [c.id, c]));
  }

  private toItems(items: Map<number, Awaited<ReturnType<PayrollService['components']>>[number]>, lines: SalaryLine[]): PayItem[] {
    return lines.flatMap((l) => {
      const c = items.get(l.componentId);
      if (!c || !c.isActive) return [];
      return [{ componentId: c.id, code: c.code, name: c.name, kind: c.kind, calc: c.calc, value: valueOf(c.calc, l.value), maxAmount: c.maxAmount == null ? null : toPaise(c.maxAmount),
        prorate: c.prorate, isBasic: c.isBasic, sortOrder: c.sortOrder }];
    });
  }

  private preview(items: Map<number, any>, lines: SalaryLine[]) {
    const s = calculateSlip(this.toItems(items, lines), 0, 30);
    return { gross: r2(s.gross), deductions: r2(s.totalDeductions), employer: r2(s.employerTotal), net: r2(s.net) };
  }

  // ---------------- Staff salaries ----------------
  private async staffRow(publicId: string) {
    const s = await this.db.selectFrom('staff as s').innerJoin('users as u', 'u.id', 's.user_id').select(['s.id', 's.public_id', 'u.name', 's.employee_code', 's.designation', 's.joining_date'])
      .where('s.public_id', '=', publicId).where('s.deleted_at', 'is', null).executeTakeFirst();
    if (!s) throw Errors.notFound('Staff member');
    return s;
  }

  /** The salary in force on a date: the latest revision that started on or before it. */
  private async structureOn(staffId: number, date: string) {
    const s = await this.db.selectFrom('staff_salaries as ss').leftJoin('salary_templates as t', 't.id', 'ss.template_id').select(['ss.id', 'ss.effective_from', 't.name as template'])
      .where('ss.staff_id', '=', staffId).where('ss.effective_from', '<=', new Date(`${date}T00:00:00Z`)).orderBy('ss.effective_from', 'desc').executeTakeFirst();
    if (!s) return null;
    const lines = await this.db.selectFrom('staff_salary_lines').select(['component_id', 'value']).where('staff_salary_id', '=', s.id).execute();
    return { id: s.id, effectiveFrom: iso(s.effective_from)!, template: s.template, lines: lines.map((l) => ({ componentId: l.component_id, value: Number(l.value) })) };
  }

  async salaries() {
    const today = await schoolToday(this.db);
    const staff = await this.db.selectFrom('staff as s').innerJoin('users as u', 'u.id', 's.user_id').select(['s.id', 's.public_id', 'u.name', 's.employee_code', 's.designation'])
      .where('s.status', '=', 'active').where('s.deleted_at', 'is', null).orderBy('u.name').execute();
    const items = await this.itemsById();
    const out = [];
    for (const s of staff) {
      const cur = (await this.structureOn(s.id, today)) ?? (await this.structureOn(s.id, '9999-12-31'));
      out.push({ id: s.public_id, name: s.name, code: s.employee_code, designation: s.designation, effectiveFrom: cur?.effectiveFrom ?? null, template: cur?.template ?? null,
        upcoming: !!cur && cur.effectiveFrom > today, ...(cur ? this.preview(items, cur.lines) : { gross: null, deductions: null, employer: null, net: null }) });
    }
    return out;
  }

  async salary(publicId: string) {
    const s = await this.staffRow(publicId);
    const items = await this.itemsById();
    const revs = await this.db.selectFrom('staff_salaries as ss').leftJoin('salary_templates as t', 't.id', 'ss.template_id').leftJoin('users as cu', 'cu.id', 'ss.created_by')
      .select(['ss.id', 'ss.effective_from', 'ss.note', 'ss.template_id', 't.name as template', 'cu.name as created_by', 'ss.created_at']).where('ss.staff_id', '=', s.id).orderBy('ss.effective_from', 'desc').execute();
    const lines = revs.length ? await this.db.selectFrom('staff_salary_lines').selectAll().where('staff_salary_id', 'in', revs.map((r) => r.id)).execute() : [];
    return {
      staff: { id: s.public_id, name: s.name, code: s.employee_code, designation: s.designation, joiningDate: iso(s.joining_date) },
      revisions: revs.map((r) => {
        const ls = lines.filter((l) => l.staff_salary_id === r.id).map((l) => ({ componentId: l.component_id, value: Number(l.value) }));
        return { effectiveFrom: iso(r.effective_from), templateId: r.template_id, template: r.template, note: r.note, createdBy: r.created_by, createdAt: r.created_at, lines: ls, preview: this.preview(items, ls) };
      }),
    };
  }

  async setSalary(u: RequestUser, publicId: string, b: { effectiveFrom: string; templateId?: number | null; lines: SalaryLine[]; note?: string | null }, meta: Meta) {
    const s = await this.staffRow(publicId);
    await this.checkLines(b.lines);
    await this.db.transaction().execute(async (trx) => {
      const at = new Date(`${b.effectiveFrom}T00:00:00Z`);
      const ex = await trx.selectFrom('staff_salaries').select('id').where('staff_id', '=', s.id).where('effective_from', '=', at).executeTakeFirst();
      let sid: number;
      if (ex) {
        sid = ex.id;
        await trx.updateTable('staff_salaries').set({ template_id: b.templateId ?? null, note: b.note ?? null, created_by: u.id }).where('id', '=', sid).execute();
        await trx.deleteFrom('staff_salary_lines').where('staff_salary_id', '=', sid).execute();
      } else sid = Number((await trx.insertInto('staff_salaries').values({ staff_id: s.id, effective_from: at, template_id: b.templateId ?? null, note: b.note ?? null, created_by: u.id }).executeTakeFirstOrThrow()).insertId);
      await trx.insertInto('staff_salary_lines').values(b.lines.map((l) => ({ staff_salary_id: sid, component_id: l.componentId, value: String(l.value) }))).execute();
      await this.audit.log(u, { module: 'payroll', action: 'set_salary', entityType: 'staff', entityId: s.id, after: b, ...meta }, trx);
    });
    return this.salary(publicId);
  }

  /** Give many staff the same template (amounts copied), starting from one date. */
  async applyTemplate(u: RequestUser, templateId: number, staffIds: string[], effectiveFrom: string, meta: Meta) {
    const t = (await this.templates()).find((x) => x.id === templateId);
    if (!t) throw Errors.notFound('Template');
    for (const id of staffIds) await this.setSalary(u, id, { effectiveFrom, templateId, lines: t.lines, note: `From template ${t.name}` }, meta);
    return { updated: staffIds.length };
  }

  // ---------------- Monthly payroll ----------------
  private async divisorFor(month: string, rule: DivisorRule) {
    if (rule === 'thirty') return 30;
    const cal = await monthCalendar(this.db, month);
    if (rule === 'month_days') return cal.days.length;
    const n = cal.days.filter(cal.isWorking).length;
    if (!n) throw Errors.badRequest('NO_WORKING_DAYS', `${monthLabel(month)} has no working days in the school calendar.`);
    return n;
  }

  /** Staff to pay for a month: active, joined by month end; plus those who left during the month. */
  private async eligibleStaff(month: string) {
    const start = new Date(`${month}-01T00:00:00Z`), end = new Date(`${monthEnd(month)}T00:00:00Z`);
    const rows = await this.db.selectFrom('staff as s').innerJoin('users as u', 'u.id', 's.user_id').leftJoin('staff_hr as h', 'h.staff_id', 's.id')
      .select(['s.id', 's.public_id', 'u.id as user_id', 'u.name', 's.employee_code', 's.designation', 's.joining_date', 's.status', 'h.exit_date'])
      .where('s.deleted_at', 'is', null)
      .where((eb) => eb.or([eb('s.joining_date', 'is', null), eb('s.joining_date', '<=', end)]))
      .where((eb) => eb.or([eb('h.exit_date', 'is', null), eb('h.exit_date', '>=', start)]))
      .orderBy('u.name').execute();
    return rows.filter((r) => r.status === 'active' || (r.exit_date && iso(r.exit_date)! >= `${month}-01`));
  }

  /**
   * What attendance says about loss-of-pay for one month (agreed: the accountant decides; this is a hint).
   * Suggested = absent + half days / 2 + unpaid leave + days before joining or after leaving.
   */
  private async hints(month: string, staff: Array<{ id: number; joining_date: Date | null; exit_date: Date | null }>, rule: DivisorRule) {
    const cal = await monthCalendar(this.db, month);
    const today = await schoolToday(this.db);
    const ids = staff.map((s) => s.id);
    const [att, leaves] = await Promise.all([
      ids.length ? this.db.selectFrom('staff_attendance').select(['staff_id', 'att_date', 'status']).where('staff_id', 'in', ids)
        .where('att_date', '>=', new Date(`${cal.start}T00:00:00Z`)).where('att_date', '<=', new Date(`${cal.end}T00:00:00Z`)).execute() : [],
      ids.length ? this.db.selectFrom('leave_requests as l').innerJoin('leave_types as t', 't.id', 'l.leave_type_id').select(['l.staff_id', 'l.start_date', 'l.end_date'])
        .where('l.kind', '=', 'staff').where('l.status', '=', 'approved').where('t.is_paid', '=', 0).where('l.staff_id', 'in', ids)
        .where('l.start_date', '<=', new Date(`${cal.end}T00:00:00Z`)).where('l.end_date', '>=', new Date(`${cal.start}T00:00:00Z`)).execute() : [],
    ]);
    const counted = (d: string) => (rule === 'working_days' ? cal.isWorking(d) : true);
    const out = new Map<number, { absent: number; halfDays: number; unpaidLeave: number; notMarked: number; beforeJoining: number; afterLeaving: number; suggested: number }>();
    for (const s of staff) {
      const mine = att.filter((a) => a.staff_id === s.id);
      const marked = new Set(mine.map((a) => iso(a.att_date)));
      const absent = mine.filter((a) => a.status === 'absent' && cal.isWorking(iso(a.att_date)!)).length;
      const halfDays = mine.filter((a) => a.status === 'half_day' && cal.isWorking(iso(a.att_date)!)).length;
      const unpaid = new Set<string>();
      for (const l of leaves.filter((x) => x.staff_id === s.id)) for (const d of eachDay(iso(l.start_date)!, iso(l.end_date)!)) if (d >= cal.start && d <= cal.end && cal.isWorking(d)) unpaid.add(d);
      const join = iso(s.joining_date), exit = iso(s.exit_date);
      const beforeJoining = join && join > cal.start ? cal.days.filter((d) => d < join && counted(d)).length : 0;
      const afterLeaving = exit && exit < cal.end ? cal.days.filter((d) => d > exit && counted(d)).length : 0;
      const notMarked = cal.days.filter((d) => d <= today && cal.isWorking(d) && !marked.has(d) && (!join || d >= join) && (!exit || d <= exit)).length;
      const raw = absent + halfDays / 2 + unpaid.size + beforeJoining + afterLeaving;
      out.set(s.id, { absent, halfDays, unpaidLeave: unpaid.size, notMarked, beforeJoining, afterLeaving, suggested: Math.round(raw * 2) / 2 });
    }
    return out;
  }

  private async run(month: string) {
    const r = await this.db.selectFrom('payroll_runs').selectAll().where('month', '=', month).executeTakeFirst();
    if (!r) throw Errors.notFound('Payroll for this month');
    return r;
  }
  private draftOnly(r: { status: string }) {
    if (r.status !== 'draft') throw Errors.badRequest('PAYROLL_LOCKED', 'This month is finalised. Reopen it to make changes.');
  }

  private async computeSlip(staffSalaryId: number, lop: number, divisor: number, adjustments: Adjustment[]) {
    const lines = await this.db.selectFrom('staff_salary_lines').select(['component_id', 'value']).where('staff_salary_id', '=', staffSalaryId).execute();
    const slip = calculateSlip(this.toItems(await this.itemsById(), lines.map((l) => ({ componentId: l.component_id, value: Number(l.value) }))), lop, divisor, adjustments);
    if (slip.net < 0) throw Errors.badRequest('NEGATIVE_NET', 'Deductions are more than the pay for this month. Check the loss-of-pay days and deductions.');
    return slip;
  }
  private slipRow(slip: ReturnType<typeof calculateSlip>) {
    return { lop_days: String(slip.lopDays), paid_days: String(slip.paidDays), gross: toDb(slip.gross), total_deductions: toDb(slip.totalDeductions), employer_total: toDb(slip.employerTotal), net_pay: toDb(slip.net),
      slip_lines: JSON.stringify(slip.lines.filter((l) => l.componentId !== null)) };
  }

  async runs() {
    const runs = await this.db.selectFrom('payroll_runs as r').leftJoin('payslips as p', 'p.run_id', 'r.id')
      .select((eb) => ['r.month', 'r.status', 'r.paid_on', 'r.finalised_at', eb.fn.count<number>('p.id').as('staff'), eb.fn.sum<string>('p.gross').as('gross'), eb.fn.sum<string>('p.net_pay').as('net'),
        eb.fn.sum<string>('p.total_deductions').as('deductions'), eb.fn.sum<string>('p.employer_total').as('employer')])
      .groupBy(['r.id', 'r.month', 'r.status', 'r.paid_on', 'r.finalised_at']).orderBy('r.month', 'desc').execute();
    const today = await schoolToday(this.db);
    return { currentMonth: today.slice(0, 7), rules: await this.rules(), runs: runs.map((r) => ({ month: r.month, label: monthLabel(r.month), status: r.status, paidOn: iso(r.paid_on), staff: Number(r.staff),
      gross: Number(r.gross ?? 0), deductions: Number(r.deductions ?? 0), employer: Number(r.employer ?? 0), net: Number(r.net ?? 0) })) };
  }

  async createRun(u: RequestUser, month: string, meta: Meta) {
    const today = await schoolToday(this.db);
    if (month > today.slice(0, 7)) throw Errors.validation([{ field: 'month', message: 'Payroll can be prepared for this month or earlier months.' }]);
    if (await this.db.selectFrom('payroll_runs').select('id').where('month', '=', month).executeTakeFirst()) throw Errors.badRequest('RUN_EXISTS', `Payroll for ${monthLabel(month)} already exists.`);
    const rules = await this.rules();
    const divisor = await this.divisorFor(month, rules.lopDivisor);
    await this.db.transaction().execute(async (trx) => {
      const r = await trx.insertInto('payroll_runs').values({ month, status: 'draft', divisor_rule: rules.lopDivisor, divisor_days: String(divisor), created_by: u.id }).executeTakeFirstOrThrow();
      await this.audit.log(u, { module: 'payroll', action: 'run_create', entityType: 'payroll_run', entityId: Number(r.insertId), after: { month, divisor }, ...meta }, trx);
    });
    await this.syncSlips(u, month, false);
    return this.getRun(month);
  }

  /** Adds staff missing from a draft and updates salaries, keeping LOP days and one-off additions. */
  async syncSlips(u: RequestUser, month: string, audit = true, meta?: Meta) {
    const run = await this.run(month);
    this.draftOnly(run);
    const staff = await this.eligibleStaff(month);
    const existing = await this.db.selectFrom('payslips').select(['id', 'staff_id', 'lop_days', 'adjustments']).where('run_id', '=', run.id).execute();
    const byStaff = new Map(existing.map((p) => [p.staff_id, p]));
    const keep = new Set<number>();
    const divisor = Number(run.divisor_days);
    for (const s of staff) {
      const st = await this.structureOn(s.id, monthEnd(month));
      if (!st) continue;
      keep.add(s.id);
      const prev = byStaff.get(s.id);
      const adj = readJson<Adjustment[]>(prev?.adjustments) ?? [];
      const slip = await this.computeSlip(st.id, prev ? Number(prev.lop_days) : 0, divisor, adj);
      if (prev) await this.db.updateTable('payslips').set({ ...this.slipRow(slip), staff_salary_id: st.id, updated_by: u.id }).where('id', '=', prev.id).execute();
      else await this.db.insertInto('payslips').values({ public_id: newPublicId(), run_id: run.id, staff_id: s.id, staff_salary_id: st.id, ...this.slipRow(slip), adjustments: null, updated_by: u.id }).execute();
    }
    const drop = existing.filter((p) => !keep.has(p.staff_id)).map((p) => p.id);
    if (drop.length) await this.db.deleteFrom('payslips').where('id', 'in', drop).execute();
    if (audit) await this.audit.log(u, { module: 'payroll', action: 'run_refresh', entityType: 'payroll_run', entityId: run.id, after: { month }, ...(meta ?? { ip: null, userAgent: null }) });
    return this.getRun(month);
  }

  async getRun(month: string) {
    const run = await this.run(month);
    const slips = await this.db.selectFrom('payslips as p').innerJoin('staff as s', 's.id', 'p.staff_id').innerJoin('users as u', 'u.id', 's.user_id').leftJoin('staff_hr as h', 'h.staff_id', 's.id')
      .select(['p.public_id', 'p.staff_id', 'p.lop_days', 'p.paid_days', 'p.gross', 'p.total_deductions', 'p.employer_total', 'p.net_pay', 'p.slip_lines', 'p.adjustments', 'p.note',
        's.public_id as staff_public_id', 's.employee_code', 's.designation', 's.joining_date', 'u.name', 'h.exit_date', 'h.bank_account_no', 'h.bank_ifsc', 'h.bank_name'])
      .where('p.run_id', '=', run.id).orderBy('u.name').execute();
    const hints = await this.hints(month, slips.map((s) => ({ id: s.staff_id, joining_date: s.joining_date, exit_date: s.exit_date })), run.divisor_rule);
    const eligible = await this.eligibleStaff(month);
    const inRun = new Set(slips.map((s) => s.staff_id));
    const missing = [];
    for (const s of eligible.filter((x) => !inRun.has(x.id))) if (!(await this.structureOn(s.id, monthEnd(month)))) missing.push({ id: s.public_id, name: s.name, code: s.employee_code });
    const sum = (k: 'gross' | 'total_deductions' | 'employer_total' | 'net_pay') => slips.reduce((t, s) => t + toPaise(s[k]), 0) / 100;
    return {
      month, label: monthLabel(month), status: run.status, divisorRule: run.divisor_rule, divisor: Number(run.divisor_days), paidOn: iso(run.paid_on), paidMethod: run.paid_method, paidReference: run.paid_reference,
      totals: { staff: slips.length, gross: sum('gross'), deductions: sum('total_deductions'), employer: sum('employer_total'), net: sum('net_pay') },
      missing,
      slips: slips.map((s) => ({
        id: s.public_id, staffId: s.staff_public_id, name: s.name, code: s.employee_code, designation: s.designation, lopDays: Number(s.lop_days), paidDays: Number(s.paid_days),
        gross: Number(s.gross), deductions: Number(s.total_deductions), employer: Number(s.employer_total), net: Number(s.net_pay), note: s.note,
        lines: (readJson<SlipLine[]>(s.slip_lines) ?? []).map((l) => ({ ...l, amount: r2(l.amount), full: r2(l.full) })),
        adjustments: (readJson<Adjustment[]>(s.adjustments) ?? []).map((a) => ({ ...a, amount: r2(a.amount) })),
        bankReady: !!(s.bank_account_no && s.bank_ifsc), hint: hints.get(s.staff_id)!,
      })),
    };
  }

  async updateSlip(u: RequestUser, month: string, slipId: string, b: { lopDays: number; adjustments: Array<{ label: string; kind: 'earning' | 'deduction'; amount: number }>; note?: string | null }, meta: Meta) {
    const run = await this.run(month);
    this.draftOnly(run);
    const p = await this.db.selectFrom('payslips').select(['id', 'staff_salary_id']).where('public_id', '=', slipId).where('run_id', '=', run.id).executeTakeFirst();
    if (!p || !p.staff_salary_id) throw Errors.notFound('Payslip');
    const divisor = Number(run.divisor_days);
    if (b.lopDays > divisor) throw Errors.validation([{ field: 'lopDays', message: `Loss-of-pay days cannot be more than ${divisor}.` }]);
    const adj: Adjustment[] = b.adjustments.map((a) => ({ label: a.label, kind: a.kind, amount: toPaise(a.amount) }));
    const slip = await this.computeSlip(p.staff_salary_id, b.lopDays, divisor, adj);
    await this.db.updateTable('payslips').set({ ...this.slipRow(slip), adjustments: adj.length ? JSON.stringify(adj) : null, note: b.note ?? null, updated_by: u.id }).where('id', '=', p.id).execute();
    await this.audit.log(u, { module: 'payroll', action: 'slip_update', entityType: 'payslip', entityId: p.id, after: { month, ...b }, ...meta });
    return this.getRun(month);
  }

  /** Sets every payslip's LOP days to the attendance suggestion. */
  async fillLop(u: RequestUser, month: string, meta: Meta) {
    const data = await this.getRun(month);
    this.draftOnly(data);
    for (const s of data.slips) {
      if (s.lopDays === s.hint.suggested) continue;
      await this.updateSlip(u, month, s.id, { lopDays: Math.min(s.hint.suggested, data.divisor), adjustments: s.adjustments, note: s.note }, meta);
    }
    return this.getRun(month);
  }

  async deleteRun(u: RequestUser, month: string, meta: Meta) {
    const run = await this.run(month);
    this.draftOnly(run);
    await this.db.deleteFrom('payroll_runs').where('id', '=', run.id).execute();
    await this.audit.log(u, { module: 'payroll', action: 'run_delete', entityType: 'payroll_run', entityId: run.id, after: { month }, ...meta });
    return { deleted: month };
  }

  async finalise(u: RequestUser, month: string, meta: Meta) {
    const run = await this.run(month);
    this.draftOnly(run);
    const slips = await this.db.selectFrom('payslips as p').innerJoin('staff as s', 's.id', 'p.staff_id').select(['s.user_id']).where('p.run_id', '=', run.id).execute();
    if (!slips.length) throw Errors.badRequest('NO_PAYSLIPS', 'There are no payslips in this month. Set staff salaries first.');
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('payroll_runs').set({ status: 'finalised', finalised_by: u.id, finalised_at: new Date() }).where('id', '=', run.id).execute();
      await trx.insertInto('notifications').values(slips.map((s) => ({ user_id: s.user_id, workspace: 'staff' as const, category: 'finance' as const, title: `Payslip for ${monthLabel(month)} is ready`, body: 'Open it to view or download.', link_path: '/payslips' }))).execute();
      await this.audit.log(u, { module: 'payroll', action: 'finalise', entityType: 'payroll_run', entityId: run.id, after: { month, staff: slips.length }, ...meta }, trx);
    });
    return this.getRun(month);
  }

  async reopen(u: RequestUser, month: string, reason: string, meta: Meta) {
    const run = await this.run(month);
    if (run.status === 'paid') throw Errors.badRequest('PAYROLL_PAID', 'This month is marked as paid and cannot be reopened.');
    if (run.status !== 'finalised') throw Errors.badRequest('NOT_FINALISED', 'This month is not finalised.');
    await this.db.updateTable('payroll_runs').set({ status: 'draft', finalised_by: null, finalised_at: null }).where('id', '=', run.id).execute();
    await this.audit.log(u, { module: 'payroll', action: 'reopen', entityType: 'payroll_run', entityId: run.id, after: { month, reason }, ...meta });
    return this.getRun(month);
  }

  /** Records the salary payment and adds it to spending under "Salaries" (net pay). */
  async markPaid(u: RequestUser, month: string, b: { paidOn: string; method: Method; reference?: string | null }, meta: Meta) {
    const run = await this.run(month);
    if (run.status !== 'finalised') throw Errors.badRequest('NOT_FINALISED', run.status === 'paid' ? 'This month is already marked as paid.' : 'Finalise the payroll first.');
    const data = await this.getRun(month);
    const cat = await this.db.selectFrom('expense_categories').select('id').where('is_system', '=', 1).where('name', '=', 'Salaries').executeTakeFirst()
      ?? await this.db.selectFrom('expense_categories').select('id').where('is_system', '=', 1).executeTakeFirstOrThrow();
    const expensesOn = await this.perms.isModuleEnabled('expenses');
    await this.db.transaction().execute(async (trx) => {
      let expenseId: number | null = null;
      if (expensesOn && data.totals.net > 0) {
        const e = await this.expenses.create(u, { date: b.paidOn, categoryId: cat.id, amount: data.totals.net, paidTo: `Staff salaries, ${data.label} (${data.totals.staff} staff)`, method: b.method, reference: b.reference, description: 'Net pay from payroll' }, meta, 'payroll', trx);
        expenseId = e.id;
      }
      await trx.updateTable('payroll_runs').set({ status: 'paid', paid_on: new Date(`${b.paidOn}T00:00:00Z`), paid_method: b.method, paid_reference: b.reference ?? null, expense_id: expenseId }).where('id', '=', run.id).execute();
      await this.audit.log(u, { module: 'payroll', action: 'mark_paid', entityType: 'payroll_run', entityId: run.id, after: { month, ...b }, ...meta }, trx);
    });
    return this.getRun(month);
  }

  // ---------------- Payslips for staff ----------------
  async mine(u: RequestUser) {
    if (u.workspace !== 'staff') throw Errors.forbidden();
    const s = await this.db.selectFrom('staff').select('id').where('user_id', '=', u.id).executeTakeFirst();
    if (!s) return [];
    const rows = await this.db.selectFrom('payslips as p').innerJoin('payroll_runs as r', 'r.id', 'p.run_id')
      .select(['p.public_id', 'r.month', 'r.status', 'p.gross', 'p.total_deductions', 'p.net_pay', 'p.lop_days', 'r.paid_on'])
      .where('p.staff_id', '=', s.id).where('r.status', 'in', ['finalised', 'paid']).orderBy('r.month', 'desc').execute();
    return rows.map((r) => ({ id: r.public_id, month: r.month, label: monthLabel(r.month), paid: r.status === 'paid', paidOn: iso(r.paid_on), gross: Number(r.gross), deductions: Number(r.total_deductions), net: Number(r.net_pay), lopDays: Number(r.lop_days) }));
  }

  /** One payslip with everything the PDF needs. Own payslips once finalised; payroll staff any. */
  async payslip(u: RequestUser, publicId: string) {
    const p = await this.db.selectFrom('payslips as p').innerJoin('payroll_runs as r', 'r.id', 'p.run_id').innerJoin('staff as s', 's.id', 'p.staff_id').innerJoin('users as u', 'u.id', 's.user_id')
      .leftJoin('staff_hr as h', 'h.staff_id', 's.id')
      .select(['p.public_id', 'p.lop_days', 'p.paid_days', 'p.gross', 'p.total_deductions', 'p.employer_total', 'p.net_pay', 'p.slip_lines', 'p.adjustments', 'p.note',
        'r.month', 'r.status', 'r.divisor_days', 'r.divisor_rule', 'r.paid_on', 'u.id as user_id', 'u.name', 's.employee_code', 's.designation', 's.department', 's.joining_date',
        'h.bank_name', 'h.bank_account_no', 'h.pan_no', 'h.uan_no', 'h.esi_no'])
      .where('p.public_id', '=', publicId).executeTakeFirst();
    if (!p) throw Errors.notFound('Payslip');
    const own = p.user_id === u.id && u.workspace === 'staff' && p.status !== 'draft';
    const office = u.workspace === 'staff' && u.permissions.has('payroll.view') && (await this.perms.isModuleEnabled('payroll'));
    if (!own && !office) throw Errors.notFound('Payslip');
    const school = await this.db.selectFrom('institution_settings').select(['name', 'address', 'phone', 'contact_email', 'brand_primary']).where('id', '=', 1).executeTakeFirstOrThrow();
    const adj = (readJson<Adjustment[]>(p.adjustments) ?? []).map((a) => ({ componentId: null, code: '', name: a.label, kind: a.kind as Kind, amount: a.amount, full: a.amount }));
    return {
      school, month: p.month, label: monthLabel(p.month), draft: p.status === 'draft', name: p.name, code: p.employee_code, designation: p.designation, department: p.department, joiningDate: iso(p.joining_date),
      bankName: p.bank_name, account: p.bank_account_no ? `XXXX${p.bank_account_no.slice(-4)}` : null, pan: p.pan_no, uan: p.uan_no, esi: p.esi_no,
      divisor: Number(p.divisor_days), paidDays: Number(p.paid_days), lopDays: Number(p.lop_days), note: p.note,
      lines: [...(readJson<SlipLine[]>(p.slip_lines) ?? []), ...adj], gross: toPaise(p.gross), deductions: toPaise(p.total_deductions), employer: toPaise(p.employer_total), net: toPaise(p.net_pay),
    };
  }

  /** Salary register for exports: one row per payslip with a column per pay item. */
  async register(month: string) {
    const data = await this.getRun(month);
    const comps = (await this.components()).filter((c) => data.slips.some((s) => s.lines.some((l) => l.componentId === c.id)));
    const banks = await this.db.selectFrom('payslips as p').innerJoin('staff_hr as h', 'h.staff_id', 'p.staff_id').innerJoin('payroll_runs as r', 'r.id', 'p.run_id')
      .select(['p.public_id', 'h.bank_name', 'h.bank_account_no', 'h.bank_ifsc']).where('r.month', '=', month).execute();
    const bank = new Map(banks.map((b) => [b.public_id, b]));
    return { ...data, components: comps, bank };
  }
}
