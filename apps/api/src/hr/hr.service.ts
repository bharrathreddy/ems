import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { currentYear } from '../common/academic-year';
import type { RequestUser } from '../common/request-user';
import { PermissionsService } from '../permissions/permissions.service';
import { iso } from '../attendance/calendar';
import { leaveBalances } from './leave-balance';

type Meta = { ip: string | null; userAgent: string | null };
export interface HrBody {
  employmentType?: 'permanent' | 'probation' | 'contract' | 'part_time' | null;
  bankName?: string | null; bankAccountNo?: string | null; bankIfsc?: string | null; panNo?: string | null; uanNo?: string | null; esiNo?: string | null;
  emergencyName?: string | null; emergencyMobile?: string | null; exitDate?: string | null; exitReason?: string | null; notes?: string | null;
}
export interface LeaveTypeBody { code: string; name: string; daysPerYear: number | null; isPaid: boolean; isActive?: boolean; sortOrder?: number }

const MAP: Record<keyof HrBody, string> = {
  employmentType: 'employment_type', bankName: 'bank_name', bankAccountNo: 'bank_account_no', bankIfsc: 'bank_ifsc', panNo: 'pan_no', uanNo: 'uan_no', esiNo: 'esi_no',
  emergencyName: 'emergency_name', emergencyMobile: 'emergency_mobile', exitDate: 'exit_date', exitReason: 'exit_reason', notes: 'notes',
};

@Injectable()
export class HrService {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService, private readonly perms: PermissionsService) {}

  async staffId(publicId: string) {
    const s = await this.db.selectFrom('staff').select(['id']).where('public_id', '=', publicId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!s) throw Errors.notFound('Staff member');
    return s.id;
  }

  async get(publicId: string) {
    const id = await this.staffId(publicId);
    const year = await currentYear(this.db);
    const [r, balances] = await Promise.all([
      this.db.selectFrom('staff_hr').selectAll().where('staff_id', '=', id).executeTakeFirst(),
      leaveBalances(this.db, id, year.id),
    ]);
    return {
      employmentType: r?.employment_type ?? null, bankName: r?.bank_name ?? null, bankAccountNo: r?.bank_account_no ?? null, bankIfsc: r?.bank_ifsc ?? null,
      panNo: r?.pan_no ?? null, uanNo: r?.uan_no ?? null, esiNo: r?.esi_no ?? null, emergencyName: r?.emergency_name ?? null, emergencyMobile: r?.emergency_mobile ?? null,
      exitDate: iso(r?.exit_date ?? null), exitReason: r?.exit_reason ?? null, notes: r?.notes ?? null, year: year.name, leave: balances,
    };
  }

  async save(u: RequestUser, publicId: string, b: HrBody, meta: Meta) {
    const id = await this.staffId(publicId);
    const row: Record<string, unknown> = { updated_by: u.id };
    for (const [k, col] of Object.entries(MAP)) {
      if (k in b) {
        const v = (b as any)[k];
        row[col] = k === 'exitDate' ? (v ? new Date(`${v}T00:00:00Z`) : null) : (v === '' ? null : v ?? null);
      }
    }
    if (typeof row.bank_ifsc === 'string') row.bank_ifsc = (row.bank_ifsc as string).toUpperCase();
    if (typeof row.pan_no === 'string') row.pan_no = (row.pan_no as string).toUpperCase();
    const before = await this.db.selectFrom('staff_hr').selectAll().where('staff_id', '=', id).executeTakeFirst();
    if (before) await this.db.updateTable('staff_hr').set(row as any).where('staff_id', '=', id).execute();
    else await this.db.insertInto('staff_hr').values({ staff_id: id, ...(row as any) }).execute();
    // Bank and ID numbers are not written to the audit log; only which fields changed.
    await this.audit.log(u, { module: 'hr', action: 'update_record', entityType: 'staff', entityId: id, after: { fields: Object.keys(b) }, ...meta });
    return this.get(publicId);
  }

  // ---------------- Leave types ----------------

  async leaveTypes() {
    const rows = await this.db.selectFrom('leave_types').selectAll().orderBy('sort_order').orderBy('id').execute();
    const used = await this.db.selectFrom('leave_requests').select(['leave_type_id']).where('leave_type_id', 'is not', null).groupBy('leave_type_id').execute();
    const inUse = new Set(used.map((r) => r.leave_type_id));
    return rows.map((t) => ({ id: t.id, code: t.code, name: t.name, daysPerYear: t.days_per_year == null ? null : Number(t.days_per_year), isPaid: !!t.is_paid, isActive: !!t.is_active, sortOrder: t.sort_order, inUse: inUse.has(t.id) }));
  }

  async saveLeaveType(u: RequestUser, id: number | null, b: LeaveTypeBody, meta: Meta) {
    const dup = await this.db.selectFrom('leave_types').select('id').where('code', '=', b.code.toUpperCase()).executeTakeFirst();
    if (dup && dup.id !== id) throw Errors.validation([{ field: 'code', message: 'Another leave type uses this short code.' }]);
    const row = { code: b.code.toUpperCase(), name: b.name, days_per_year: b.daysPerYear == null ? null : String(b.daysPerYear), is_paid: b.isPaid ? 1 : 0, is_active: b.isActive === false ? 0 : 1, sort_order: b.sortOrder ?? 0 };
    if (id) {
      if (!(await this.db.selectFrom('leave_types').select('id').where('id', '=', id).executeTakeFirst())) throw Errors.notFound('Leave type');
      await this.db.updateTable('leave_types').set(row).where('id', '=', id).execute();
    } else await this.db.insertInto('leave_types').values(row).execute();
    await this.audit.log(u, { module: 'hr', action: id ? 'leave_type_update' : 'leave_type_create', entityType: 'leave_type', entityId: id ?? undefined, after: b, ...meta });
    return this.leaveTypes();
  }

  /** The signed-in staff member's balances, for the leave form. Empty when HR is switched off. */
  async myBalances(u: RequestUser) {
    if (u.workspace !== 'staff' || !(await this.perms.isModuleEnabled('hr'))) return { enabled: false, types: [] };
    const s = await this.db.selectFrom('staff').select('id').where('user_id', '=', u.id).where('status', '=', 'active').executeTakeFirst();
    if (!s) return { enabled: false, types: [] };
    const year = await currentYear(this.db);
    return { enabled: true, year: year.name, types: await leaveBalances(this.db, s.id, year.id) };
  }

  /** Every active staff member's balances for the current year. */
  async allBalances() {
    const year = await currentYear(this.db);
    const staff = await this.db.selectFrom('staff as s').innerJoin('users as u', 'u.id', 's.user_id').select(['s.id', 's.public_id', 's.employee_code', 'u.name', 's.designation'])
      .where('s.status', '=', 'active').where('s.deleted_at', 'is', null).orderBy('u.name').execute();
    const out = [];
    for (const s of staff) out.push({ id: s.public_id, code: s.employee_code, name: s.name, designation: s.designation, balances: await leaveBalances(this.db, s.id, year.id) });
    return { year: year.name, types: (await this.leaveTypes()).filter((t) => t.isActive), staff: out };
  }
}
