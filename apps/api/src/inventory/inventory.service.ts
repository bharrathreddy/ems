import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { newPublicId } from '../common/ids';
import { takeNext, withRetry } from '../common/sequences';
import type { RequestUser } from '../common/request-user';
import { iso, schoolToday } from '../attendance/calendar';
import { ExpensesService, yearForDate, type Method } from '../payroll/expenses.service';
import { toDb, toPaise } from '../fees/money';

type Meta = { ip: string | null; userAgent: string | null };
export interface ItemBody { name: string; category: string; unit: string; salePrice?: number | null; trackStock: boolean; lowStockAt?: number | null; isActive?: boolean; openingQty?: number | null }
export interface MoveBody {
  itemId: number; kind: 'purchase' | 'issue' | 'adjust'; qty: number; date: string; amount?: number | null; party?: string | null; note?: string | null;
  expense?: { categoryId: number; method: Method; reference?: string | null } | null;
}
export interface SetBody { name: string; classId?: number | null; price: number; isActive?: boolean; lines: Array<{ itemId: number; qty: number }> }
export interface SaleBody { studentId?: string | null; buyerName?: string | null; date: string; method: Method; reference?: string | null; lines: Array<{ itemId?: number | null; setId?: number | null; qty: number }> }

const q2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (v == null ? null : Number(v));
const fullName = (f: string, l: string | null) => [f, l].filter(Boolean).join(' ');

@Injectable()
export class InventoryService {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService, private readonly expenses: ExpensesService) {}

  // ---------- Items ----------
  async items(q: { search?: string; category?: string; low?: boolean; forSale?: boolean; includeInactive?: boolean } = {}) {
    let s = this.db.selectFrom('inventory_items').selectAll();
    if (!q.includeInactive) s = s.where('is_active', '=', 1);
    if (q.search) s = s.where('name', 'like', `%${q.search}%`);
    if (q.category) s = s.where('category', '=', q.category);
    if (q.forSale) s = s.where('sale_price', 'is not', null);
    const rows = await s.orderBy('category').orderBy('name').execute();
    const out = rows.map((r) => ({
      id: r.id, name: r.name, category: r.category, unit: r.unit, salePrice: num(r.sale_price), trackStock: !!r.track_stock, stock: Number(r.stock_qty),
      lowStockAt: num(r.low_stock_at), isActive: !!r.is_active, isLow: !!r.track_stock && r.low_stock_at != null && Number(r.stock_qty) <= Number(r.low_stock_at),
    }));
    const cats = await this.db.selectFrom('inventory_items').select('category').distinct().orderBy('category').execute();
    return { items: q.low ? out.filter((i) => i.isLow) : out, categories: cats.map((c) => c.category), lowCount: out.filter((i) => i.isLow && i.isActive).length };
  }

  async saveItem(u: RequestUser, id: number | null, b: ItemBody, meta: Meta) {
    const dup = await this.db.selectFrom('inventory_items').select('id').where('name', '=', b.name).executeTakeFirst();
    if (dup && dup.id !== id) throw Errors.validation([{ field: 'name', message: 'An item with this name already exists.' }]);
    const row = { name: b.name, category: b.category, unit: b.unit, sale_price: b.salePrice == null ? null : toDb(toPaise(b.salePrice)), track_stock: b.trackStock ? 1 : 0,
      low_stock_at: b.lowStockAt == null ? null : String(b.lowStockAt), is_active: b.isActive === false ? 0 : 1 };
    if (id) {
      if (!(await this.db.selectFrom('inventory_items').select('id').where('id', '=', id).executeTakeFirst())) throw Errors.notFound('Item');
      await this.db.updateTable('inventory_items').set(row).where('id', '=', id).execute();
    } else {
      await withRetry(this.db, async (trx) => {
        id = Number((await trx.insertInto('inventory_items').values(row).executeTakeFirstOrThrow()).insertId);
        if (b.trackStock && b.openingQty) {
          await trx.updateTable('inventory_items').set({ stock_qty: String(b.openingQty) }).where('id', '=', id).execute();
          await trx.insertInto('stock_movements').values({ item_id: id, kind: 'adjust', qty: String(b.openingQty), move_date: new Date(`${await schoolToday(this.db)}T00:00:00Z`), note: 'Opening stock', balance_after: String(b.openingQty), created_by: u.id }).execute();
        }
      });
    }
    await this.audit.log(u, { module: 'inventory', action: 'save_item', entityType: 'inventory_item', entityId: id!, after: b, ...meta });
    return (await this.items({ includeInactive: true })).items.find((i) => i.id === id)!;
  }

  /** Changes stock inside a transaction, refusing to go below zero, and alerts when it falls to the low-stock level. */
  private async change(trx: Database, u: RequestUser, itemId: number, delta: number, m: { kind: 'purchase' | 'issue' | 'sale' | 'sale_cancel' | 'adjust'; date: string; amount?: number | null; party?: string | null; note?: string | null; expenseId?: number | null; saleId?: number | null }, field = 'qty') {
    const it = await trx.selectFrom('inventory_items').select(['id', 'name', 'unit', 'stock_qty', 'low_stock_at', 'track_stock']).where('id', '=', itemId).forUpdate().executeTakeFirst();
    if (!it) throw Errors.validation([{ field, message: 'Choose an item.' }]);
    if (!it.track_stock) return;
    const before = Number(it.stock_qty), after = q2(before + delta);
    if (after < 0) throw Errors.badRequest('NOT_ENOUGH_STOCK', `Only ${before} ${it.unit} of ${it.name} in stock.`);
    await trx.updateTable('inventory_items').set({ stock_qty: String(after) }).where('id', '=', it.id).execute();
    await trx.insertInto('stock_movements').values({
      item_id: it.id, kind: m.kind, qty: String(q2(delta)), move_date: new Date(`${m.date}T00:00:00Z`), amount: m.amount == null ? null : toDb(toPaise(m.amount)), party: m.party || null, note: m.note || null,
      expense_id: m.expenseId ?? null, sale_id: m.saleId ?? null, balance_after: String(after), created_by: u.id,
    }).execute();
    const level = it.low_stock_at == null ? null : Number(it.low_stock_at);
    if (level != null && before > level && after <= level) {
      const managers = await trx.selectFrom('users as us').innerJoin('user_roles as ur', 'ur.user_id', 'us.id').innerJoin('role_permissions as rp', 'rp.role_id', 'ur.role_id')
        .innerJoin('permissions as p', 'p.id', 'rp.permission_id').innerJoin('roles as ro', 'ro.id', 'ur.role_id')
        .select('us.id').distinct().where('p.module_key', '=', 'inventory').where('p.action', '=', 'manage').where('ro.workspace', '=', 'staff').where('us.status', '=', 'active').execute();
      if (managers.length) await trx.insertInto('notifications').values(managers.map((x) => ({ user_id: x.id, workspace: 'staff' as const, category: 'system', title: `Low stock: ${it.name}`, body: `${after} ${it.unit} left (alert at ${level}).`, link_path: '/stock' }))).execute();
    }
  }

  async move(u: RequestUser, b: MoveBody, meta: Meta) {
    const today = await schoolToday(this.db);
    if (b.date > today) throw Errors.validation([{ field: 'date', message: 'The date cannot be in the future.' }]);
    const it = await this.db.selectFrom('inventory_items').select(['id', 'name', 'unit', 'stock_qty', 'track_stock', 'is_active']).where('id', '=', b.itemId).executeTakeFirst();
    if (!it || !it.is_active) throw Errors.validation([{ field: 'itemId', message: 'Choose an item.' }]);
    if (!it.track_stock) throw Errors.badRequest('NOT_TRACKED', `Stock is not counted for ${it.name}.`);
    if (b.kind === 'issue' && !b.party) throw Errors.validation([{ field: 'party', message: 'Who received the items?' }]);
    if (b.expense && !(b.kind === 'purchase' && b.amount && b.amount > 0)) throw Errors.validation([{ field: 'amount', message: 'Enter the amount paid to record it as an expense.' }]);
    const delta = b.kind === 'purchase' ? b.qty : b.kind === 'issue' ? -b.qty : q2(b.qty - Number(it.stock_qty));
    if (b.kind === 'adjust' && delta === 0) throw Errors.badRequest('NO_CHANGE', `The count matches the stock (${b.qty} ${it.unit}).`);
    return withRetry(this.db, async (trx) => {
      let expense: { id: number; voucher: string; status: string } | null = null;
      if (b.expense) {
        expense = await this.expenses.create(u, { date: b.date, categoryId: b.expense.categoryId, amount: b.amount!, paidTo: b.party || 'Supplier', method: b.expense.method, reference: b.expense.reference ?? null,
          description: `Stock: ${b.qty} ${it.unit} ${it.name}${b.note ? ` · ${b.note}` : ''}`.slice(0, 500) }, meta, 'inventory', trx);
      }
      await this.change(trx, u, it.id, delta, { kind: b.kind, date: b.date, amount: b.kind === 'purchase' ? b.amount : null, party: b.party, note: b.note, expenseId: expense?.id }, 'qty');
      await this.audit.log(u, { module: 'inventory', action: b.kind, entityType: 'inventory_item', entityId: it.id, after: { ...b, delta }, ...meta }, trx);
      return { ok: true, voucherNo: expense?.voucher ?? null, expenseStatus: expense?.status ?? null };
    });
  }

  async history(itemId: number) {
    const rows = await this.db.selectFrom('stock_movements as m').innerJoin('users as cu', 'cu.id', 'm.created_by').leftJoin('expenses as e', 'e.id', 'm.expense_id').leftJoin('sales as s', 's.id', 'm.sale_id')
      .select(['m.id', 'm.kind', 'm.qty', 'm.move_date', 'm.amount', 'm.party', 'm.note', 'm.balance_after', 'cu.name as by', 'e.voucher_no', 'e.status as expense_status', 's.receipt_no'])
      .where('m.item_id', '=', itemId).orderBy('m.id', 'desc').limit(300).execute();
    return rows.map((r) => ({ id: r.id, kind: r.kind, qty: Number(r.qty), date: iso(r.move_date), amount: num(r.amount), party: r.party, note: r.note, balance: Number(r.balance_after), by: r.by,
      voucherNo: r.voucher_no, expenseStatus: r.expense_status, receiptNo: r.receipt_no }));
  }

  /** Reverses a purchase entered by mistake: takes the stock back out and cancels its expense. */
  async undoPurchase(u: RequestUser, movementId: number, reason: string, meta: Meta) {
    const m = await this.db.selectFrom('stock_movements').selectAll().where('id', '=', movementId).executeTakeFirst();
    if (!m || m.kind !== 'purchase') throw Errors.notFound('Purchase');
    if ((m.note ?? '').startsWith('[undone]')) throw Errors.badRequest('ALREADY_UNDONE', 'This purchase was already undone.');
    const today = await schoolToday(this.db);
    await withRetry(this.db, async (trx) => {
      await this.change(trx, u, m.item_id, -Number(m.qty), { kind: 'adjust', date: today, note: `Undo purchase #${m.id}: ${reason}`.slice(0, 255) });
      await trx.updateTable('stock_movements').set({ note: `[undone] ${m.note ?? ''}`.trim().slice(0, 255) }).where('id', '=', m.id).execute();
      if (m.expense_id) await trx.updateTable('expenses').set({ status: 'cancelled', decision_note: `Stock purchase undone: ${reason}`.slice(0, 255), decided_by: u.id, decided_at: new Date() })
        .where('id', '=', m.expense_id).where('status', 'in', ['pending', 'approved']).execute();
      await this.audit.log(u, { module: 'inventory', action: 'undo_purchase', entityType: 'inventory_item', entityId: m.item_id, after: { movementId, reason }, ...meta }, trx);
    });
    return { ok: true };
  }

  // ---------- Book sets ----------
  async sets(includeInactive = true) {
    let s = this.db.selectFrom('item_sets as s').leftJoin('classes as c', 'c.id', 's.class_id').select(['s.id', 's.name', 's.class_id', 'c.name as class_name', 's.price', 's.is_active']);
    if (!includeInactive) s = s.where('s.is_active', '=', 1);
    const sets = await s.orderBy('c.level_order').orderBy('s.name').execute();
    const lines = sets.length ? await this.db.selectFrom('item_set_lines as l').innerJoin('inventory_items as i', 'i.id', 'l.item_id')
      .select(['l.set_id', 'l.item_id', 'l.qty', 'i.name', 'i.unit', 'i.sale_price', 'i.stock_qty', 'i.track_stock']).where('l.set_id', 'in', sets.map((x) => x.id)).orderBy('i.name').execute() : [];
    return sets.map((x) => {
      const ls = lines.filter((l) => l.set_id === x.id);
      const canMake = ls.filter((l) => l.track_stock).map((l) => Math.floor(Number(l.stock_qty) / Number(l.qty)));
      return {
        id: x.id, name: x.name, classId: x.class_id, className: x.class_name, price: Number(x.price), isActive: !!x.is_active,
        itemsValue: q2(ls.reduce((t, l) => t + Number(l.sale_price ?? 0) * Number(l.qty), 0)), available: canMake.length ? Math.max(0, Math.min(...canMake)) : null,
        lines: ls.map((l) => ({ itemId: l.item_id, name: l.name, unit: l.unit, qty: Number(l.qty), stock: Number(l.stock_qty), trackStock: !!l.track_stock })),
      };
    });
  }

  async saveSet(u: RequestUser, id: number | null, b: SetBody, meta: Meta) {
    const dup = await this.db.selectFrom('item_sets').select('id').where('name', '=', b.name).executeTakeFirst();
    if (dup && dup.id !== id) throw Errors.validation([{ field: 'name', message: 'A set with this name already exists.' }]);
    const ids = b.lines.map((l) => l.itemId);
    if (new Set(ids).size !== ids.length) throw Errors.validation([{ field: 'lines', message: 'An item is listed twice.' }]);
    const found = await this.db.selectFrom('inventory_items').select('id').where('id', 'in', ids).where('is_active', '=', 1).execute();
    if (found.length !== ids.length) throw Errors.validation([{ field: 'lines', message: 'Choose active items only.' }]);
    if (b.classId && !(await this.db.selectFrom('classes').select('id').where('id', '=', b.classId).executeTakeFirst())) throw Errors.validation([{ field: 'classId', message: 'Choose a class.' }]);
    await this.db.transaction().execute(async (trx) => {
      const row = { name: b.name, class_id: b.classId ?? null, price: toDb(toPaise(b.price)), is_active: b.isActive === false ? 0 : 1 };
      if (id) {
        if (!(await trx.selectFrom('item_sets').select('id').where('id', '=', id).executeTakeFirst())) throw Errors.notFound('Set');
        await trx.updateTable('item_sets').set(row).where('id', '=', id).execute();
        await trx.deleteFrom('item_set_lines').where('set_id', '=', id).execute();
      } else id = Number((await trx.insertInto('item_sets').values(row).executeTakeFirstOrThrow()).insertId);
      await trx.insertInto('item_set_lines').values(b.lines.map((l) => ({ set_id: id!, item_id: l.itemId, qty: String(l.qty) }))).execute();
      await this.audit.log(u, { module: 'inventory', action: 'save_set', entityType: 'item_set', entityId: id!, after: b, ...meta }, trx);
    });
    return this.sets();
  }

  // ---------- Sales counter ----------
  async createSale(u: RequestUser, b: SaleBody, meta: Meta) {
    const today = await schoolToday(this.db);
    if (b.date > today) throw Errors.validation([{ field: 'date', message: 'The date cannot be in the future.' }]);
    let studentId: number | null = null;
    if (b.studentId) {
      const st = await this.db.selectFrom('students').select(['id', 'status']).where('public_id', '=', b.studentId).executeTakeFirst();
      if (!st) throw Errors.validation([{ field: 'studentId', message: 'Choose a student.' }]);
      studentId = st.id;
    } else if (!b.buyerName) throw Errors.validation([{ field: 'studentId', message: 'Choose a student, or type the buyer\'s name.' }]);
    const year = await yearForDate(this.db, b.date);
    // Price every line from the item or set master; the counter does not type prices.
    const lines: Array<{ itemId: number | null; setId: number | null; label: string; qty: number; unit: number; amount: number; stock: Array<{ itemId: number; qty: number }> }> = [];
    for (const [i, l] of b.lines.entries()) {
      if (!!l.itemId === !!l.setId) throw Errors.validation([{ field: `lines.${i}`, message: 'Choose an item or a set.' }]);
      if (l.itemId) {
        const it = await this.db.selectFrom('inventory_items').select(['id', 'name', 'sale_price', 'is_active', 'track_stock']).where('id', '=', l.itemId).executeTakeFirst();
        if (!it || !it.is_active || it.sale_price == null) throw Errors.validation([{ field: `lines.${i}.itemId`, message: 'This item is not for sale.' }]);
        lines.push({ itemId: it.id, setId: null, label: it.name, qty: l.qty, unit: Number(it.sale_price), amount: q2(Number(it.sale_price) * l.qty), stock: [{ itemId: it.id, qty: l.qty }] });
      } else {
        const set = (await this.sets(false)).find((s) => s.id === l.setId);
        if (!set) throw Errors.validation([{ field: `lines.${i}.setId`, message: 'This set is not for sale.' }]);
        lines.push({ itemId: null, setId: set.id, label: set.name, qty: l.qty, unit: set.price, amount: q2(set.price * l.qty), stock: set.lines.map((x) => ({ itemId: x.itemId, qty: q2(x.qty * l.qty) })) });
      }
    }
    const total = q2(lines.reduce((t, l) => t + l.amount, 0));
    if (total <= 0) throw Errors.validation([{ field: 'lines', message: 'Nothing to charge. Set prices first.' }]);
    return withRetry(this.db, async (trx) => {
      const receipt = await takeNext(trx, 'sale', year.name, { prefix: `SALE/${year.name}/`, pad: 5 });
      const publicId = newPublicId();
      const saleId = Number((await trx.insertInto('sales').values({
        public_id: publicId, receipt_no: receipt, academic_year_id: year.id, student_id: studentId, buyer_name: studentId ? null : b.buyerName!, sale_date: new Date(`${b.date}T00:00:00Z`),
        total: toDb(toPaise(total)), method: b.method, reference_no: b.reference || null, created_by: u.id,
      }).executeTakeFirstOrThrow()).insertId);
      await trx.insertInto('sale_lines').values(lines.map((l) => ({ sale_id: saleId, item_id: l.itemId, set_id: l.setId, label: l.label, qty: String(l.qty), unit_price: toDb(toPaise(l.unit)), amount: toDb(toPaise(l.amount)) }))).execute();
      // Combine stock needs per item (a set and a single copy of the same book), then take them out.
      const need = new Map<number, number>();
      for (const l of lines) for (const s of l.stock) need.set(s.itemId, q2((need.get(s.itemId) ?? 0) + s.qty));
      for (const [itemId, qty] of need) await this.change(trx, u, itemId, -qty, { kind: 'sale', date: b.date, saleId, note: receipt }, 'lines');
      await this.audit.log(u, { module: 'inventory', action: 'sale', entityType: 'sale', entityId: saleId, after: { receipt, total, lines: b.lines }, ...meta }, trx);
      return { id: publicId, receiptNo: receipt, total };
    });
  }

  async sales(q: { from?: string; to?: string; search?: string; studentId?: string }) {
    const today = await schoolToday(this.db);
    const from = q.from ?? today, to = q.to ?? today;
    let s = this.db.selectFrom('sales as s').leftJoin('students as st', 'st.id', 's.student_id').innerJoin('users as cu', 'cu.id', 's.created_by')
      .leftJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 's.student_id').onRef('e.academic_year_id', '=', 's.academic_year_id'))
      .leftJoin('classes as c', 'c.id', 'e.class_id').leftJoin('sections as sec', 'sec.id', 'e.section_id')
      .select(['s.id as sid', 's.public_id', 's.receipt_no', 's.sale_date', 's.total', 's.method', 's.reference_no', 's.status', 's.cancel_reason', 's.buyer_name', 'st.first_name', 'st.last_name', 'st.admission_no', 'c.name as class_name', 'sec.name as section', 'cu.name as by']);
    if (q.studentId) s = s.where('st.public_id', '=', q.studentId);
    else s = s.where('s.sale_date', '>=', new Date(`${from}T00:00:00Z`)).where('s.sale_date', '<=', new Date(`${to}T00:00:00Z`));
    if (q.search) s = s.where((eb) => eb.or([eb('s.receipt_no', 'like', `%${q.search}%`), eb('st.first_name', 'like', `%${q.search}%`), eb('st.last_name', 'like', `%${q.search}%`), eb('st.admission_no', 'like', `%${q.search}%`), eb('s.buyer_name', 'like', `%${q.search}%`)]));
    const rows = await s.orderBy('s.id', 'desc').limit(2000).execute();
    const lines = rows.length ? await this.db.selectFrom('sale_lines').select(['sale_id', 'label', 'qty', 'amount']).where('sale_id', 'in', rows.map((r) => r.sid)).orderBy('id').execute() : [];
    const out = rows.map((r) => ({
      id: r.public_id, receiptNo: r.receipt_no, date: iso(r.sale_date), total: Number(r.total), method: r.method, reference: r.reference_no, status: r.status, cancelReason: r.cancel_reason,
      buyer: r.first_name ? fullName(r.first_name, r.last_name) : r.buyer_name, admissionNo: r.admission_no, className: r.class_name ? `${r.class_name} ${r.section ?? ''}`.trim() : null, by: r.by,
      items: lines.filter((l) => l.sale_id === r.sid).map((l) => `${Number(l.qty) === 1 ? '' : `${Number(l.qty)} × `}${l.label}`).join(', '),
    }));
    const active = out.filter((r) => r.status === 'active');
    const byMethod = new Map<string, number>();
    for (const r of active) byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + toPaise(r.total));
    return { from, to, rows: out, total: active.reduce((t, r) => t + toPaise(r.total), 0) / 100, count: active.length, byMethod: [...byMethod.entries()].map(([method, p]) => ({ method, amount: p / 100 })) };
  }

  async sale(publicId: string) {
    const s = await this.db.selectFrom('sales as s').leftJoin('students as st', 'st.id', 's.student_id').leftJoin('families as f', 'f.id', 'st.family_id').innerJoin('academic_years as y', 'y.id', 's.academic_year_id')
      .innerJoin('users as cu', 'cu.id', 's.created_by').leftJoin('users as vu', 'vu.id', 's.cancelled_by')
      .leftJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 's.student_id').onRef('e.academic_year_id', '=', 's.academic_year_id'))
      .leftJoin('classes as c', 'c.id', 'e.class_id').leftJoin('sections as sec', 'sec.id', 'e.section_id')
      .select(['s.id', 's.public_id', 's.receipt_no', 's.sale_date', 's.total', 's.method', 's.reference_no', 's.status', 's.cancel_reason', 's.cancelled_at', 's.buyer_name', 'y.name as year',
        'st.first_name', 'st.last_name', 'st.admission_no', 'f.father_name', 'f.family_name', 'f.primary_mobile', 'c.name as class_name', 'sec.name as section_name', 'cu.name as sold_by', 'vu.name as cancelled_by'])
      .where('s.public_id', '=', publicId).executeTakeFirst();
    if (!s) throw Errors.notFound('Sale');
    const lines = await this.db.selectFrom('sale_lines').select(['label', 'qty', 'unit_price', 'amount', 'set_id']).where('sale_id', '=', s.id).orderBy('id').execute();
    const institution = await this.db.selectFrom('institution_settings').select(['name', 'address', 'phone', 'contact_email', 'brand_primary']).where('id', '=', 1).executeTakeFirstOrThrow();
    return { ...s, buyer: s.first_name ? fullName(s.first_name, s.last_name) : s.buyer_name, lines: lines.map((l) => ({ label: l.label, qty: Number(l.qty), unitPrice: Number(l.unit_price), amount: Number(l.amount), isSet: !!l.set_id })), institution };
  }

  /** Cancelling keeps the receipt number (no gaps) and puts the stock back. */
  async cancelSale(u: RequestUser, publicId: string, reason: string, meta: Meta) {
    const s = await this.db.selectFrom('sales').select(['id', 'status', 'receipt_no']).where('public_id', '=', publicId).executeTakeFirst();
    if (!s) throw Errors.notFound('Sale');
    if (s.status === 'cancelled') throw Errors.badRequest('ALREADY_CANCELLED', 'This sale is already cancelled.');
    const today = await schoolToday(this.db);
    await withRetry(this.db, async (trx) => {
      const moves = await trx.selectFrom('stock_movements').select(['item_id', 'qty']).where('sale_id', '=', s.id).where('kind', '=', 'sale').execute();
      for (const m of moves) await this.change(trx, u, m.item_id, -Number(m.qty), { kind: 'sale_cancel', date: today, saleId: s.id, note: `${s.receipt_no} cancelled` });
      await trx.updateTable('sales').set({ status: 'cancelled', cancel_reason: reason, cancelled_by: u.id, cancelled_at: new Date() }).where('id', '=', s.id).execute();
      await this.audit.log(u, { module: 'inventory', action: 'cancel_sale', entityType: 'sale', entityId: s.id, after: { reason }, ...meta }, trx);
    });
    return { id: publicId, status: 'cancelled' };
  }
}
