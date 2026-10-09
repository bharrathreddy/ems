import { Inject, Injectable } from '@nestjs/common';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { FilesService, STORAGE_DIR } from '../common/files.service';
import { newPublicId } from '../common/ids';
import { readJson } from '../common/json';
import { takeNext, withRetry } from '../common/sequences';
import type { RequestUser } from '../common/request-user';
import { iso, schoolToday } from '../attendance/calendar';
import { toDb, toPaise } from '../fees/money';

type Meta = { ip: string | null; userAgent: string | null };
export type Method = 'cash' | 'upi' | 'cheque' | 'bank_transfer' | 'card';
export interface ExpenseRules { mode: 'none' | 'all' | 'above'; limit: number }
export interface ExpenseBody { date: string; categoryId: number; amount: number; paidTo: string; method: Method; reference?: string | null; description?: string | null }
const DEFAULT_RULES: ExpenseRules = { mode: 'above', limit: 5000 };

/** The academic year a date falls in; closed years cannot take new spending. */
export async function yearForDate(db: Database, date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const y = await db.selectFrom('academic_years').select(['id', 'name', 'status']).where('start_date', '<=', d).where('end_date', '>=', d).orderBy('id', 'desc').executeTakeFirst();
  if (!y) throw Errors.validation([{ field: 'date', message: 'No academic year covers this date. Add the year in Classes & years first.' }]);
  if (y.status === 'closed') throw Errors.validation([{ field: 'date', message: `${y.name} is closed. Expenses can no longer be added to it.` }]);
  return y;
}

@Injectable()
export class ExpensesService {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService, private readonly files: FilesService) {}

  async rules(): Promise<ExpenseRules> {
    const r = await this.db.selectFrom('settings').select('value').where('setting_group', '=', 'expenses').where('setting_key', '=', 'approval').executeTakeFirst();
    return { ...DEFAULT_RULES, ...(readJson<ExpenseRules>(r?.value) ?? {}) };
  }
  async setRules(u: RequestUser, rules: ExpenseRules, meta: Meta) {
    await this.db.insertInto('settings').values({ setting_group: 'expenses', setting_key: 'approval', value: JSON.stringify(rules), updated_by: u.id })
      .onDuplicateKeyUpdate({ value: JSON.stringify(rules), updated_by: u.id }).execute();
    await this.audit.log(u, { module: 'expenses', action: 'set_rules', after: rules, ...meta });
    return rules;
  }

  async categories() {
    const rows = await this.db.selectFrom('expense_categories').selectAll().orderBy('sort_order').orderBy('name').execute();
    return rows.map((c) => ({ id: c.id, name: c.name, isActive: !!c.is_active, isSystem: !!c.is_system }));
  }
  async saveCategory(u: RequestUser, id: number | null, b: { name: string; isActive?: boolean }, meta: Meta) {
    const dup = await this.db.selectFrom('expense_categories').select('id').where('name', '=', b.name).executeTakeFirst();
    if (dup && dup.id !== id) throw Errors.validation([{ field: 'name', message: 'This category already exists.' }]);
    if (id) {
      const c = await this.db.selectFrom('expense_categories').select(['is_system']).where('id', '=', id).executeTakeFirst();
      if (!c) throw Errors.notFound('Category');
      if (c.is_system && b.isActive === false) throw Errors.badRequest('SYSTEM_CATEGORY', 'Salaries is used by payroll and cannot be switched off.');
      await this.db.updateTable('expense_categories').set({ name: b.name, is_active: b.isActive === false ? 0 : 1 }).where('id', '=', id).execute();
    } else await this.db.insertInto('expense_categories').values({ name: b.name, sort_order: 50 }).execute();
    await this.audit.log(u, { module: 'expenses', action: id ? 'category_update' : 'category_create', after: b, ...meta });
    return this.categories();
  }

  /** Whether a new expense needs approval under the school's rule (agreed: the school chooses). */
  needsApproval(rules: ExpenseRules, amount: number, u: RequestUser) {
    if (u.permissions.has('expenses.approve')) return false; // an approver's own entry counts as approved
    if (rules.mode === 'none') return false;
    if (rules.mode === 'all') return true;
    return amount > rules.limit;
  }

  async create(u: RequestUser, b: ExpenseBody, meta: Meta, source: 'manual' | 'payroll' | 'transport' | 'inventory' = 'manual', trxIn?: Database) {
    const today = await schoolToday(this.db);
    if (b.date > today) throw Errors.validation([{ field: 'date', message: 'The date cannot be in the future.' }]);
    const cat = await this.db.selectFrom('expense_categories').select(['id', 'is_active', 'name']).where('id', '=', b.categoryId).executeTakeFirst();
    if (!cat || !cat.is_active) throw Errors.validation([{ field: 'categoryId', message: 'Choose a category.' }]);
    const year = await yearForDate(this.db, b.date);
    const pending = source !== 'payroll' && this.needsApproval(await this.rules(), b.amount, u);
    const run = async (trx: Database) => {
      const voucher = await takeNext(trx, 'expense', year.name, { prefix: `EXP/${year.name}/`, pad: 5 });
      const publicId = newPublicId();
      const r = await trx.insertInto('expenses').values({
        public_id: publicId, voucher_no: voucher, academic_year_id: year.id, category_id: cat.id, expense_date: new Date(`${b.date}T00:00:00Z`), amount: toDb(toPaise(b.amount)),
        paid_to: b.paidTo, method: b.method, reference_no: b.reference || null, description: b.description || null, source,
        status: pending ? 'pending' : 'approved', created_by: u.id, ...(pending ? {} : { decided_by: u.id, decided_at: new Date() }),
      }).executeTakeFirstOrThrow();
      if (pending) {
        const approvers = await trx.selectFrom('users as us').innerJoin('user_roles as ur', 'ur.user_id', 'us.id').innerJoin('role_permissions as rp', 'rp.role_id', 'ur.role_id')
          .innerJoin('permissions as p', 'p.id', 'rp.permission_id').innerJoin('roles as ro', 'ro.id', 'ur.role_id')
          .select('us.id').distinct().where('p.module_key', '=', 'expenses').where('p.action', '=', 'approve').where('ro.workspace', '=', 'staff').where('us.status', '=', 'active').where('us.id', '!=', u.id).execute();
        if (approvers.length) await trx.insertInto('notifications').values(approvers.map((a) => ({ user_id: a.id, workspace: 'staff' as const, category: 'finance', push_group: 'approvals' as const, title: `Expense to approve: ₹${new Intl.NumberFormat('en-IN').format(b.amount)}`, body: `${cat.name} · ${b.paidTo} · ${u.name}`, link_path: '/expenses' }))).execute();
      }
      await this.audit.log(u, { module: 'expenses', action: 'create', entityType: 'expense', entityId: Number(r.insertId), after: { ...b, voucher, status: pending ? 'pending' : 'approved' }, ...meta }, trx);
      return { id: Number(r.insertId), publicId, voucher };
    };
    const res = trxIn ? await run(trxIn) : await withRetry(this.db, run);
    return { ...res, status: pending ? 'pending' : 'approved' };
  }

  async list(u: RequestUser, q: { from?: string; to?: string; status?: string; categoryId?: number; search?: string }) {
    const today = await schoolToday(this.db);
    const from = q.from ?? `${today.slice(0, 7)}-01`, to = q.to ?? today;
    let s = this.db.selectFrom('expenses as e').innerJoin('expense_categories as c', 'c.id', 'e.category_id').innerJoin('users as cu', 'cu.id', 'e.created_by').leftJoin('users as du', 'du.id', 'e.decided_by')
      .select(['e.public_id', 'e.voucher_no', 'e.expense_date', 'e.amount', 'e.paid_to', 'e.method', 'e.reference_no', 'e.description', 'e.bill_file_id', 'e.source', 'e.status', 'e.created_by', 'e.created_at',
        'e.decision_note', 'e.decided_at', 'c.id as category_id', 'c.name as category', 'cu.name as created_by_name', 'du.name as decided_by_name'])
      .where('e.expense_date', '>=', new Date(`${from}T00:00:00Z`)).where('e.expense_date', '<=', new Date(`${to}T00:00:00Z`));
    if (q.status) s = s.where('e.status', '=', q.status as any);
    if (q.categoryId) s = s.where('e.category_id', '=', q.categoryId);
    if (q.search) s = s.where((eb) => eb.or([eb('e.paid_to', 'like', `%${q.search}%`), eb('e.voucher_no', 'like', `%${q.search}%`), eb('e.description', 'like', `%${q.search}%`), eb('e.reference_no', 'like', `%${q.search}%`)]));
    const rows = await s.orderBy('e.expense_date', 'desc').orderBy('e.id', 'desc').limit(2000).execute();
    const canApprove = u.permissions.has('expenses.approve');
    const out = rows.map((r) => ({
      id: r.public_id, voucherNo: r.voucher_no, date: iso(r.expense_date), amount: Number(r.amount), paidTo: r.paid_to, method: r.method, reference: r.reference_no, description: r.description,
      hasBill: !!r.bill_file_id, source: r.source, status: r.status, categoryId: r.category_id, category: r.category, createdBy: r.created_by_name, decidedBy: r.decided_by_name, decidedAt: r.decided_at, decisionNote: r.decision_note,
      canDecide: canApprove && r.status === 'pending' && r.created_by !== u.id,
      canCancel: r.source === 'manual' && ((r.status === 'pending' && r.created_by === u.id) || (canApprove && r.status !== 'cancelled' && r.status !== 'rejected')),
      canAttach: r.status !== 'cancelled' && (r.created_by === u.id || canApprove),
    }));
    const approved = out.filter((r) => r.status === 'approved');
    const byCat = new Map<string, number>();
    for (const r of approved) byCat.set(r.category, (byCat.get(r.category) ?? 0) + toPaise(r.amount));
    const pendingCount = (await this.db.selectFrom('expenses').select((e) => e.fn.countAll<number>().as('n')).where('status', '=', 'pending').executeTakeFirst())?.n ?? 0;
    return {
      from, to, rows: out, total: approved.reduce((t, r) => t + toPaise(r.amount), 0) / 100, pending: out.filter((r) => r.status === 'pending').reduce((t, r) => t + toPaise(r.amount), 0) / 100,
      pendingCount: Number(pendingCount), byCategory: [...byCat.entries()].map(([name, p]) => ({ name, amount: p / 100 })).sort((a, b) => b.amount - a.amount),
    };
  }

  private async row(publicId: string) {
    const e = await this.db.selectFrom('expenses').selectAll().where('public_id', '=', publicId).executeTakeFirst();
    if (!e) throw Errors.notFound('Expense');
    return e;
  }

  async decide(u: RequestUser, publicId: string, approve: boolean, note: string | null, meta: Meta) {
    const e = await this.row(publicId);
    if (e.status !== 'pending') throw Errors.badRequest('ALREADY_DECIDED', 'This expense has already been decided.');
    if (e.created_by === u.id) throw Errors.badRequest('OWN_EXPENSE', 'Someone else must approve an expense you recorded.');
    if (!approve && !note) throw Errors.validation([{ field: 'note', message: 'Give a reason.' }]);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('expenses').set({ status: approve ? 'approved' : 'rejected', decided_by: u.id, decided_at: new Date(), decision_note: note }).where('id', '=', e.id).execute();
      await trx.insertInto('notifications').values({ user_id: e.created_by, workspace: 'staff', category: 'finance', title: `Expense ${e.voucher_no} ${approve ? 'approved' : 'not approved'}`, body: note ?? '', link_path: '/expenses' }).execute();
      await this.audit.log(u, { module: 'expenses', action: approve ? 'approve' : 'reject', entityType: 'expense', entityId: e.id, after: { note }, ...meta }, trx);
    });
    return { id: publicId, status: approve ? 'approved' : 'rejected' };
  }

  /** Cancelling keeps the voucher number (no gaps); the amount stops counting. */
  async cancel(u: RequestUser, publicId: string, reason: string, meta: Meta) {
    const e = await this.row(publicId);
    if (e.source === 'payroll') throw Errors.badRequest('PAYROLL_EXPENSE', 'This entry comes from payroll. Reopen the payroll month instead.');
    if (e.source === 'transport') throw Errors.badRequest('TRANSPORT_EXPENSE', 'This entry comes from the fuel and service log. Cancel it in Transport → Fuel & service.');
    if (e.source === 'inventory') throw Errors.badRequest('INVENTORY_EXPENSE', 'This entry comes from a stock purchase. Undo the purchase in Stock (open the item, then History).');
    const canApprove = u.permissions.has('expenses.approve');
    if (!((e.status === 'pending' && e.created_by === u.id) || (canApprove && (e.status === 'pending' || e.status === 'approved')))) throw Errors.forbidden();
    await this.db.updateTable('expenses').set({ status: 'cancelled', decision_note: reason, decided_by: u.id, decided_at: new Date() }).where('id', '=', e.id).execute();
    await this.audit.log(u, { module: 'expenses', action: 'cancel', entityType: 'expense', entityId: e.id, after: { reason }, ...meta });
    return { id: publicId, status: 'cancelled' };
  }

  async attachBill(u: RequestUser, publicId: string, file: Express.Multer.File) {
    const e = await this.row(publicId);
    if (e.status === 'cancelled' || !(e.created_by === u.id || u.permissions.has('expenses.approve'))) throw Errors.forbidden();
    const b = file.buffer;
    const isPdf = b.subarray(0, 5).toString() === '%PDF-';
    const isJpeg = b[0] === 0xff && b[1] === 0xd8;
    const isPng = b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    if (!(isPdf || isJpeg || isPng)) throw Errors.badRequest('BAD_FILE', 'Attach a photo (JPG or PNG) or a PDF of the bill.');
    const mime = isPdf ? 'application/pdf' : isJpeg ? 'image/jpeg' : 'image/png';
    const fid = await this.files.save(b, file.originalname, mime, 'expense_bill', u.id);
    await this.db.updateTable('expenses').set({ bill_file_id: fid }).where('id', '=', e.id).execute();
    return { ok: true };
  }

  async bill(publicId: string) {
    const e = await this.row(publicId);
    if (!e.bill_file_id) throw Errors.notFound('Bill');
    const f = await this.db.selectFrom('files').select(['storage_path', 'mime_type', 'original_name']).where('id', '=', e.bill_file_id).executeTakeFirstOrThrow();
    const p = join(STORAGE_DIR, f.storage_path);
    if (!existsSync(p)) throw Errors.notFound('Bill');
    return { stream: createReadStream(p), mime: f.mime_type, name: f.original_name };
  }

  /** Spending summary for the dashboard. */
  async monthTotal(month: string) {
    const r = await this.db.selectFrom('expenses').select((e) => e.fn.sum<string>('amount').as('t')).where('status', '=', 'approved')
      .where('expense_date', '>=', new Date(`${month}-01T00:00:00Z`)).where('expense_date', '<', new Date(new Date(`${month}-01T00:00:00Z`).setUTCMonth(new Date(`${month}-01T00:00:00Z`).getUTCMonth() + 1))).executeTakeFirst();
    return toPaise(r?.t ?? 0) / 100;
  }
}
