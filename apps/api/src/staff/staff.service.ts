import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { config } from '../config';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { newPublicId } from '../common/ids';
import type { RequestUser } from '../common/request-user';
import { PermissionsService } from '../permissions/permissions.service';
import { AuthService } from '../auth/auth.service';
import { generateTempPassword, hashPassword } from '../auth/passwords';

export interface StaffInput {
  name: string; email: string; mobile: string; employeeCode: string;
  designation?: string | null; department?: string | null; qualification?: string | null;
  joiningDate?: string | null; dob?: string | null; gender?: 'male' | 'female' | 'other' | null; roleKeys: string[];
}

type Meta = { ip: string | null; userAgent: string | null };

@Injectable()
export class StaffService {
  constructor(
    @Inject(KYSELY) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly perms: PermissionsService,
    private readonly auth: AuthService,
  ) {}

  async list(q: { search?: string; status?: 'active' | 'inactive'; page: number; pageSize: number }) {
    let base = this.db.selectFrom('staff as s').innerJoin('users as u', 'u.id', 's.user_id').where('s.deleted_at', 'is', null);
    if (q.status) base = base.where('s.status', '=', q.status);
    if (q.search) {
      const like = `%${q.search}%`;
      base = base.where((eb) => eb.or([eb('u.name', 'like', like), eb('u.mobile', 'like', like), eb('u.email', 'like', like), eb('s.employee_code', 'like', like)]));
    }
    const [{ total }] = await base.select((eb) => eb.fn.countAll<number>().as('total')).execute();
    const rows = await base
      .select(['s.public_id', 's.employee_code', 's.designation', 's.department', 's.status', 'u.name', 'u.email', 'u.mobile',
        'u.status as account_status', 'u.public_id as user_id', 'u.last_login_at', 'u.must_change_password', 'u.password_hash',
        sql<string | null>`(SELECT GROUP_CONCAT(r.name ORDER BY r.name SEPARATOR ', ') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.workspace = 'staff')`.as('roles')])
      .orderBy('u.name')
      .limit(q.pageSize).offset((q.page - 1) * q.pageSize)
      .execute();
    return {
      data: rows.map(({ password_hash, ...r }) => ({ ...r, has_password: password_hash !== null, must_change_password: r.must_change_password === 1 })),
      meta: { page: q.page, pageSize: q.pageSize, total: Number(total) },
    };
  }

  async get(publicId: string) {
    const s = await this.db.selectFrom('staff as s').innerJoin('users as u', 'u.id', 's.user_id')
      .select(['s.id', 's.public_id', 's.employee_code', 's.designation', 's.department', 's.qualification', 's.joining_date', 's.dob', 's.gender',
        's.status', 'u.id as uid', 'u.public_id as user_id', 'u.name', 'u.email', 'u.mobile', 'u.status as account_status', 'u.last_login_at'])
      .where('s.public_id', '=', publicId).where('s.deleted_at', 'is', null).executeTakeFirst();
    if (!s) throw Errors.notFound('Staff member');
    const roles = await this.db.selectFrom('user_roles as ur').innerJoin('roles as r', 'r.id', 'ur.role_id')
      .select(['r.role_key', 'r.name']).where('ur.user_id', '=', s.uid).where('r.workspace', '=', 'staff').execute();
    const { id, uid, ...rest } = s;
    return { ...rest, roles };
  }

  private async resolveRoleIds(actor: RequestUser, roleKeys: string[], trx: Database) {
    if (!roleKeys.length) throw Errors.validation([{ field: 'roleKeys', message: 'Choose at least one role.' }]);
    const roles = await trx.selectFrom('roles').select(['id', 'role_key', 'workspace'])
      .where('role_key', 'in', roleKeys).where('is_active', '=', 1).execute();
    if (roles.length !== new Set(roleKeys).size || roles.some((r) => r.workspace !== 'staff')) {
      throw Errors.validation([{ field: 'roleKeys', message: 'One or more roles are not valid staff roles.' }]);
    }
    if (roles.some((r) => r.role_key === 'institution_admin') && !actor.permissions.has('roles.configure')) throw Errors.forbidden();
    return roles.map((r) => r.id);
  }

  async create(actor: RequestUser, input: StaffInput, meta: Meta) {
    const email = input.email.toLowerCase();
    const result = await this.db.transaction().execute(async (trx) => {
      const roleIds = await this.resolveRoleIds(actor, input.roleKeys, trx);
      // One person = one account (rule L3): reuse an existing family account with the same mobile/email.
      const matches = await trx.selectFrom('users').select(['id', 'email', 'mobile'])
        .where((eb) => eb.or([eb('email', '=', email), eb('mobile', '=', input.mobile)])).execute();
      if (matches.length > 1) throw Errors.conflict('This email and mobile belong to two different accounts.');
      let userId: number;
      if (matches.length === 1) {
        const existing = matches[0];
        const isStaff = await trx.selectFrom('staff').select('id').where('user_id', '=', existing.id).executeTakeFirst();
        if (isStaff) throw Errors.conflict('A staff member with this email or mobile already exists.');
        if ((existing.email && existing.email !== email) || (existing.mobile && existing.mobile !== input.mobile)) {
          throw Errors.conflict('This mobile or email is already used by another account with different details.');
        }
        userId = existing.id;
        await trx.updateTable('users').set({ email, mobile: input.mobile, updated_by: actor.id }).where('id', '=', userId).execute();
      } else {
        const res = await trx.insertInto('users').values({
          public_id: newPublicId(), name: input.name, email, mobile: input.mobile,
          password_hash: null, must_change_password: 1, created_by: actor.id,
        }).executeTakeFirstOrThrow();
        userId = Number(res.insertId);
      }
      const staffPublicId = newPublicId();
      const res = await trx.insertInto('staff').values({
        public_id: staffPublicId, user_id: userId, employee_code: input.employeeCode, designation: input.designation ?? null,
        department: input.department ?? null, qualification: input.qualification ?? null,
        joining_date: input.joiningDate ? new Date(input.joiningDate) : null, dob: input.dob ? new Date(input.dob) : null, gender: input.gender ?? null, created_by: actor.id,
      }).executeTakeFirstOrThrow();
      await trx.insertInto('user_roles').values(roleIds.map((role_id) => ({ user_id: userId, role_id, assigned_by: actor.id })))
        .onDuplicateKeyUpdate({ assigned_by: actor.id }).execute();
      await this.audit.log(actor, { module: 'staff', action: 'create', entityType: 'staff', entityId: Number(res.insertId), after: { ...input }, ...meta }, trx);
      return staffPublicId;
    });
    this.perms.invalidate();
    return this.get(result);
  }

  async update(actor: RequestUser, publicId: string, input: Partial<StaffInput>, meta: Meta) {
    const before = await this.get(publicId);
    const s = await this.db.selectFrom('staff').select(['id', 'user_id']).where('public_id', '=', publicId).executeTakeFirstOrThrow();
    await this.assertCanManage(actor, s.user_id);
    await this.db.transaction().execute(async (trx) => {
      const userPatch: Record<string, unknown> = {};
      if (input.name !== undefined) userPatch.name = input.name;
      if (input.email !== undefined) userPatch.email = input.email.toLowerCase();
      if (input.mobile !== undefined) userPatch.mobile = input.mobile;
      if (Object.keys(userPatch).length) await trx.updateTable('users').set({ ...userPatch, updated_by: actor.id }).where('id', '=', s.user_id).execute();
      const staffPatch: Record<string, unknown> = {};
      for (const [k, col] of [['employeeCode', 'employee_code'], ['designation', 'designation'], ['department', 'department'],
        ['qualification', 'qualification'], ['gender', 'gender']] as const) {
        if (input[k] !== undefined) staffPatch[col] = input[k];
      }
      if (input.joiningDate !== undefined) staffPatch.joining_date = input.joiningDate ? new Date(input.joiningDate) : null;
      if (input.dob !== undefined) staffPatch.dob = input.dob ? new Date(input.dob) : null;
      if (Object.keys(staffPatch).length) await trx.updateTable('staff').set({ ...staffPatch, updated_by: actor.id }).where('id', '=', s.id).execute();
      if (input.roleKeys) {
        const roleIds = await this.resolveRoleIds(actor, input.roleKeys, trx);
        const staffRoleIds = trx.selectFrom('roles').select('id').where('workspace', '=', 'staff');
        await trx.deleteFrom('user_roles').where('user_id', '=', s.user_id).where('role_id', 'in', staffRoleIds).execute();
        await trx.insertInto('user_roles').values(roleIds.map((role_id) => ({ user_id: s.user_id, role_id, assigned_by: actor.id }))).execute();
      }
    });
    this.perms.invalidate();
    const after = await this.get(publicId);
    await this.audit.log(actor, { module: 'staff', action: 'update', entityType: 'staff', entityId: s.id, before, after, ...meta });
    return after;
  }

  private async assertCanManage(actor: RequestUser, targetUserId: number) {
    const target = await this.db.selectFrom('users').select(['is_super_admin']).where('id', '=', targetUserId).executeTakeFirst();
    if (!target) throw Errors.notFound('User');
    if (target.is_super_admin === 1 && !actor.isSuperAdmin) throw Errors.forbidden();
  }

  /** Rule L9: generate a temporary password, never stored in plain text, and build the WhatsApp message. */
  async issueCredentials(actor: RequestUser, userPublicId: string, meta: Meta) {
    const user = await this.db.selectFrom('users').select(['id', 'name', 'mobile', 'email', 'status'])
      .where('public_id', '=', userPublicId).executeTakeFirst();
    if (!user) throw Errors.notFound('User');
    await this.assertCanManage(actor, user.id);
    if (user.status !== 'active') throw Errors.badRequest('ACCOUNT_DISABLED', 'Enable this account before sending login details.');
    const password = generateTempPassword();
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('users')
        .set({ password_hash: await hashPassword(password), must_change_password: 1, failed_login_count: 0, locked_until: null })
        .where('id', '=', user.id).execute();
      await trx.insertInto('credential_issues').values({ user_id: user.id, issued_by: actor.id, channel: user.mobile ? 'whatsapp_manual' : 'copy' }).execute();
      await this.audit.log(actor, { module: 'users', action: 'issue_credentials', entityType: 'user', entityId: user.id, ...meta }, trx);
    });
    await this.auth.revokeAll(user.id);
    const inst = await this.db.selectFrom('institution_settings').select('name').where('id', '=', 1).executeTakeFirst();
    const username = user.mobile ?? user.email!;
    const message = [
      `Dear ${user.name},`,
      `Login for ${inst?.name ?? 'our school'}:`,
      `Link: ${config.appUrl}/app/login`,
      `Username: ${username}`,
      `Password: ${password}`,
      'Please change your password after first login.',
    ].join('\n');
    return {
      username,
      temporaryPassword: password,
      message,
      whatsappUrl: user.mobile ? `https://wa.me/91${user.mobile}?text=${encodeURIComponent(message)}` : null,
    };
  }

  async setAccountStatus(actor: RequestUser, userPublicId: string, enable: boolean, meta: Meta) {
    const user = await this.db.selectFrom('users').select(['id', 'status']).where('public_id', '=', userPublicId).executeTakeFirst();
    if (!user) throw Errors.notFound('User');
    if (user.id === actor.id) throw Errors.badRequest('CANNOT_DISABLE_SELF', 'You cannot disable your own account.');
    await this.assertCanManage(actor, user.id);
    const status = enable ? 'active' : 'disabled';
    await this.db.updateTable('users').set({ status, updated_by: actor.id }).where('id', '=', user.id).execute();
    if (!enable) await this.auth.revokeAll(user.id);
    await this.audit.log(actor, { module: 'users', action: enable ? 'enable' : 'disable', entityType: 'user', entityId: user.id, before: { status: user.status }, after: { status }, ...meta });
    return { status };
  }

  listStaffRoles() {
    return this.db.selectFrom('roles').select(['role_key', 'name', 'description', 'is_system'])
      .where('workspace', '=', 'staff').where('is_active', '=', 1).orderBy('name').execute();
  }
}
