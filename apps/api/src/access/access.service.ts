import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import type { RequestUser, Scope, Workspace } from '../common/request-user';
import { CORE_MODULES, PERMISSION_CATALOG } from '../permissions/catalog';
import { DEFAULT_SCOPE, PermissionsService } from '../permissions/permissions.service';

type Meta = { ip: string | null; userAgent: string | null };
export type Grants = Record<string, Scope>;
export interface Override { perm: string; effect: 'grant' | 'deny'; scope?: Scope | null }

/** Scopes that make sense in each workspace (whose records an action covers). */
export const WORKSPACE_SCOPES: Record<Workspace, Scope[]> = {
  staff: ['all', 'section', 'subject', 'assigned_route', 'class', 'assigned_students'],
  parent: ['own_children'],
  student: ['own_records'],
};

/** Student-record fields a role can be kept from seeing (enforced in the students screens and lists). */
export const FIELD_RULES = [
  { key: 'family.mobile', label: "Parents' phone & email" },
  { key: 'family.address', label: "Parents' address" },
  { key: 'address', label: "Student's address" },
] as const;
export type FieldRules = Record<string, 'hidden' | 'view'>;

@Injectable()
export class AccessService {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService, private readonly perms: PermissionsService) {}

  private async permIds() {
    const rows = await this.db.selectFrom('permissions').select(['id', 'module_key', 'action']).execute();
    return new Map(rows.filter((r) => PERMISSION_CATALOG[r.module_key]?.includes(r.action)).map((r) => [`${r.module_key}.${r.action}`, r.id]));
  }

  private checkGrants(workspace: Workspace, grants: Record<string, Scope | null | undefined>, ids: Map<string, number>, field = 'grants') {
    for (const [perm, scope] of Object.entries(grants)) {
      if (!ids.has(perm)) throw Errors.validation([{ field: `${field}.${perm}`, message: `Unknown permission ${perm}.` }]);
      if (scope && !WORKSPACE_SCOPES[workspace].includes(scope)) throw Errors.validation([{ field: `${field}.${perm}`, message: `"${scope}" does not apply to ${workspace} logins.` }]);
    }
  }

  /** Everything the access page needs: modules and their actions, module switches, roles with their grants. */
  async overview() {
    const flags = await this.perms.featureFlags();
    const modules = Object.entries(PERMISSION_CATALOG).map(([key, actions]) => ({ key, actions, core: CORE_MODULES.has(key), enabled: CORE_MODULES.has(key) || flags.get(key) === true }));
    const roles = await this.db.selectFrom('roles').select(['id', 'role_key', 'name', 'description', 'workspace', 'is_system', 'is_active']).orderBy('workspace').orderBy('is_system', 'desc').orderBy('name').execute();
    const grants = await this.db.selectFrom('role_permissions as rp').innerJoin('permissions as p', 'p.id', 'rp.permission_id').select(['rp.role_id', 'p.module_key', 'p.action', 'rp.scope']).execute();
    const fields = await this.db.selectFrom('field_policies').select(['role_id', 'field_key', 'access']).where('entity', '=', 'student')
      .where('field_key', 'in', FIELD_RULES.map((f) => f.key)).execute();
    const counts = await this.db.selectFrom('user_roles as ur').innerJoin('users as u', 'u.id', 'ur.user_id').select(['ur.role_id', (eb) => eb.fn.countAll<number>().as('n')])
      .where('u.status', '=', 'active').groupBy('ur.role_id').execute();
    return {
      modules, scopes: WORKSPACE_SCOPES, fieldRules: FIELD_RULES,
      roles: roles.map((r) => ({
        id: r.id, key: r.role_key, name: r.name, description: r.description, workspace: r.workspace, isSystem: !!r.is_system, isActive: !!r.is_active,
        people: Number(counts.find((c) => c.role_id === r.id)?.n ?? 0),
        grants: Object.fromEntries(grants.filter((g) => g.role_id === r.id).map((g) => [`${g.module_key}.${g.action}`, g.scope])),
        fields: Object.fromEntries(FIELD_RULES.map((f) => [f.key, fields.find((x) => x.role_id === r.id && x.field_key === f.key)?.access === 'hidden' ? 'hidden' : 'view'])) as FieldRules,
      })),
    };
  }

  async createRole(u: RequestUser, b: { name: string; workspace: Workspace; copyFrom?: number | null; description?: string | null }, meta: Meta) {
    if (await this.db.selectFrom('roles').select('id').where('name', '=', b.name).executeTakeFirst()) throw Errors.validation([{ field: 'name', message: 'A role with this name already exists.' }]);
    let workspace = b.workspace;
    let copy: Array<{ permission_id: number; scope: Scope }> = [];
    let copyFields: Array<{ entity: string; field_key: string; access: 'hidden' | 'view' | 'edit' }> = [];
    if (b.copyFrom) {
      const src = await this.db.selectFrom('roles').select(['id', 'workspace']).where('id', '=', b.copyFrom).executeTakeFirst();
      if (!src) throw Errors.validation([{ field: 'copyFrom', message: 'Choose a role to copy.' }]);
      workspace = src.workspace;
      copy = await this.db.selectFrom('role_permissions').select(['permission_id', 'scope']).where('role_id', '=', src.id).execute();
      copyFields = await this.db.selectFrom('field_policies').select(['entity', 'field_key', 'access']).where('role_id', '=', src.id).execute();
    }
    const base = b.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'role';
    let key = `custom_${base}`;
    for (let i = 2; await this.db.selectFrom('roles').select('id').where('role_key', '=', key).executeTakeFirst(); i++) key = `custom_${base}_${i}`;
    const id = await this.db.transaction().execute(async (trx) => {
      const rid = Number((await trx.insertInto('roles').values({ role_key: key, name: b.name, description: b.description ?? null, workspace, is_system: 0 }).executeTakeFirstOrThrow()).insertId);
      if (copy.length) await trx.insertInto('role_permissions').values(copy.map((c) => ({ role_id: rid, permission_id: c.permission_id, scope: c.scope }))).execute();
      if (copyFields.length) await trx.insertInto('field_policies').values(copyFields.map((f) => ({ role_id: rid, ...f }))).execute();
      await this.audit.log(u, { module: 'roles', action: 'create', entityType: 'role', entityId: rid, after: { name: b.name, workspace, copiedFrom: b.copyFrom ?? null }, ...meta }, trx);
      return rid;
    });
    this.perms.invalidate();
    return { id, key };
  }

  async updateRole(u: RequestUser, id: number, b: { name?: string; description?: string | null; isActive?: boolean }, meta: Meta) {
    const r = await this.db.selectFrom('roles').selectAll().where('id', '=', id).executeTakeFirst();
    if (!r) throw Errors.notFound('Role');
    if (b.name && b.name !== r.name && (await this.db.selectFrom('roles').select('id').where('name', '=', b.name).executeTakeFirst())) throw Errors.validation([{ field: 'name', message: 'A role with this name already exists.' }]);
    if (b.isActive === false && r.role_key === 'parent') throw Errors.badRequest('ROLE_REQUIRED', 'The Parent role cannot be switched off: parents would lose their login.');
    await this.db.updateTable('roles').set({ ...(b.name ? { name: b.name } : {}), ...(b.description !== undefined ? { description: b.description } : {}), ...(b.isActive !== undefined ? { is_active: b.isActive ? 1 : 0 } : {}) }).where('id', '=', id).execute();
    await this.audit.log(u, { module: 'roles', action: 'update', entityType: 'role', entityId: id, before: { name: r.name, isActive: !!r.is_active }, after: b, ...meta });
    this.perms.invalidate();
    return { ok: true };
  }

  async deleteRole(u: RequestUser, id: number, meta: Meta) {
    const r = await this.db.selectFrom('roles').select(['id', 'name', 'is_system']).where('id', '=', id).executeTakeFirst();
    if (!r) throw Errors.notFound('Role');
    if (r.is_system) throw Errors.badRequest('SYSTEM_ROLE', 'Built-in roles cannot be deleted. You can change what they can do, or switch them off.');
    const used = await this.db.selectFrom('user_roles').select((eb) => eb.fn.countAll<number>().as('n')).where('role_id', '=', id).executeTakeFirst();
    if (Number(used?.n ?? 0) > 0) throw Errors.badRequest('ROLE_IN_USE', `${used!.n} ${Number(used!.n) === 1 ? 'person has' : 'people have'} this role. Give them another role first.`);
    await this.db.deleteFrom('roles').where('id', '=', id).execute();
    await this.audit.log(u, { module: 'roles', action: 'delete', entityType: 'role', entityId: id, before: { name: r.name }, ...meta });
    return { ok: true };
  }

  /** Replaces everything a role may do. */
  /** Which student-record fields a staff role sees. Stored explicitly (view or hidden) so restarts never change them. */
  async setFields(u: RequestUser, id: number, rules: FieldRules, meta: Meta) {
    const r = await this.db.selectFrom('roles').select(['id', 'workspace']).where('id', '=', id).executeTakeFirst();
    if (!r) throw Errors.notFound('Role');
    if (r.workspace !== 'staff') throw Errors.badRequest('STAFF_ONLY', 'Field rules apply to staff roles. Parents and students only see their own records.');
    const known = new Set<string>(FIELD_RULES.map((f) => f.key));
    const bad = Object.keys(rules).find((k) => !known.has(k));
    if (bad) throw Errors.validation([{ field: 'fields', message: `Unknown field: ${bad}` }]);
    const before = Object.fromEntries((await this.db.selectFrom('field_policies').select(['field_key', 'access']).where('role_id', '=', id).where('entity', '=', 'student').execute()).map((f) => [f.field_key, f.access]));
    await this.db.transaction().execute(async (trx) => {
      for (const [field_key, access] of Object.entries(rules)) {
        await trx.insertInto('field_policies').values({ role_id: id, entity: 'student', field_key, access }).onDuplicateKeyUpdate({ access }).execute();
      }
      await this.audit.log(u, { module: 'roles', action: 'set_fields', entityType: 'role', entityId: id, before, after: rules, ...meta }, trx);
    });
    return this.overview();
  }

  async setGrants(u: RequestUser, id: number, grants: Grants, meta: Meta) {
    const r = await this.db.selectFrom('roles').select(['id', 'name', 'workspace']).where('id', '=', id).executeTakeFirst();
    if (!r) throw Errors.notFound('Role');
    const ids = await this.permIds();
    this.checkGrants(r.workspace, grants, ids);
    const before = Object.fromEntries((await this.db.selectFrom('role_permissions as rp').innerJoin('permissions as p', 'p.id', 'rp.permission_id').select(['p.module_key', 'p.action', 'rp.scope'])
      .where('rp.role_id', '=', id).execute()).map((g) => [`${g.module_key}.${g.action}`, g.scope]));
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('role_permissions').where('role_id', '=', id).execute();
      const rows = Object.entries(grants).map(([perm, scope]) => ({ role_id: id, permission_id: ids.get(perm)!, scope: scope || DEFAULT_SCOPE[r.workspace] }));
      if (rows.length) await trx.insertInto('role_permissions').values(rows).execute();
      const added = Object.keys(grants).filter((k) => !(k in before) || before[k] !== grants[k]);
      const removed = Object.keys(before).filter((k) => !(k in grants));
      await this.audit.log(u, { module: 'roles', action: 'set_access', entityType: 'role', entityId: id, before: { removed: removed.map((k) => `${k} (${before[k]})`) }, after: { added: added.map((k) => `${k} (${grants[k]})`) }, ...meta }, trx);
    });
    this.perms.invalidate();
    return this.overview();
  }

  /** One person: their roles, exceptions, and what they can do in each workspace they have. */
  async person(publicId: string) {
    const user = await this.db.selectFrom('users').select(['id', 'public_id', 'name', 'mobile', 'email', 'status', 'is_super_admin']).where('public_id', '=', publicId).executeTakeFirst();
    if (!user) throw Errors.notFound('User');
    if (user.is_super_admin) throw Errors.badRequest('DEVELOPER', 'The developer login always has full access.');
    const roles = await this.db.selectFrom('user_roles as ur').innerJoin('roles as r', 'r.id', 'ur.role_id').select(['r.id', 'r.role_key', 'r.name', 'r.workspace', 'r.is_active']).where('ur.user_id', '=', user.id).execute();
    const staff = await this.db.selectFrom('staff').select(['public_id', 'employee_code']).where('user_id', '=', user.id).executeTakeFirst();
    const workspaces = await this.perms.availableWorkspaces(user.id, false);
    const overrides = await this.db.selectFrom('user_permission_overrides as o').innerJoin('permissions as p', 'p.id', 'o.permission_id')
      .select(['o.workspace', 'p.module_key', 'p.action', 'o.effect', 'o.scope']).where('o.user_id', '=', user.id).execute();
    const effective: Partial<Record<Workspace, Record<string, Scope>>> = {};
    for (const w of new Set<Workspace>([...workspaces, ...roles.map((r) => r.workspace)])) effective[w] = Object.fromEntries(await this.perms.permissionsFor(user.id, false, w));
    return {
      id: user.public_id, name: user.name, mobile: user.mobile, email: user.email, active: user.status === 'active', staffId: staff?.public_id ?? null, employeeCode: staff?.employee_code ?? null,
      roles: roles.map((r) => ({ id: r.id, key: r.role_key, name: r.name, workspace: r.workspace, isActive: !!r.is_active })),
      workspaces, effective,
      overrides: overrides.map((o) => ({ workspace: o.workspace, perm: `${o.module_key}.${o.action}`, effect: o.effect, scope: o.scope })),
    };
  }

  /** Replaces one person's exceptions in one workspace. */
  async setOverrides(u: RequestUser, publicId: string, workspace: Workspace, list: Override[], meta: Meta) {
    const user = await this.db.selectFrom('users').select(['id', 'name', 'is_super_admin']).where('public_id', '=', publicId).executeTakeFirst();
    if (!user) throw Errors.notFound('User');
    if (user.is_super_admin) throw Errors.badRequest('DEVELOPER', 'The developer login always has full access.');
    const ids = await this.permIds();
    this.checkGrants(workspace, Object.fromEntries(list.map((o) => [o.perm, o.effect === 'grant' ? o.scope ?? null : null])), ids, 'overrides');
    if (new Set(list.map((o) => o.perm)).size !== list.length) throw Errors.validation([{ field: 'overrides', message: 'A permission is listed twice.' }]);
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('user_permission_overrides').where('user_id', '=', user.id).where('workspace', '=', workspace).execute();
      if (list.length) await trx.insertInto('user_permission_overrides').values(list.map((o) => ({
        user_id: user.id, workspace, permission_id: ids.get(o.perm)!, effect: o.effect, scope: o.effect === 'grant' ? o.scope ?? DEFAULT_SCOPE[workspace] : null, created_by: u.id,
      }))).execute();
      await this.audit.log(u, { module: 'roles', action: 'set_exceptions', entityType: 'user', entityId: user.id, after: { workspace, exceptions: list.map((o) => `${o.effect === 'grant' ? '+' : '-'} ${o.perm}${o.scope ? ` (${o.scope})` : ''}`) }, ...meta }, trx);
    });
    this.perms.invalidate();
    return this.person(publicId);
  }
}
