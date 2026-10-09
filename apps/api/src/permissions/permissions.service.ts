import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KYSELY, type Database } from '../database/database.module';
import type { Scope, Workspace } from '../common/request-user';
import { CORE_MODULES, PERMISSION_CATALOG, SCOPE_RANK } from './catalog';

const CACHE_MS = 60_000;

@Injectable()
export class PermissionsService {
  private permCache = new Map<string, { at: number; perms: Map<string, Scope> }>();
  private flagCache: { at: number; flags: Map<string, boolean> } | null = null;

  constructor(@Inject(KYSELY) private readonly db: Database) {}

  /** Clear caches after any change to roles, grants, user roles or feature flags. */
  invalidate() {
    this.permCache.clear();
    this.flagCache = null;
  }

  async availableWorkspaces(userId: number, isSuperAdmin: boolean): Promise<Workspace[]> {
    const [staffRole, family, student] = await Promise.all([
      this.db
        .selectFrom('user_roles as ur')
        .innerJoin('roles as r', 'r.id', 'ur.role_id')
        .select('ur.role_id')
        .where('ur.user_id', '=', userId)
        .where('r.workspace', '=', 'staff')
        .where('r.is_active', '=', 1)
        .limit(1)
        .executeTakeFirst(),
      // Parent view exists only while the family has at least one active child (rule ST5).
      this.db.selectFrom('families as f').innerJoin('students as s', 's.family_id', 'f.id').select('f.id')
        .where('f.user_id', '=', userId).where('s.status', '=', 'active').executeTakeFirst(),
      this.db.selectFrom('students').select('id').where('user_id', '=', userId).where('status', '=', 'active').executeTakeFirst(),
    ]);
    const ws: Workspace[] = [];
    if (isSuperAdmin || staffRole) ws.push('staff');
    if (family) ws.push('parent');
    if (student) ws.push('student');
    return ws;
  }

  async permissionsFor(userId: number, isSuperAdmin: boolean, workspace: Workspace): Promise<Map<string, Scope>> {
    if (isSuperAdmin && workspace === 'staff') {
      const map = new Map<string, Scope>();
      for (const [m, actions] of Object.entries(PERMISSION_CATALOG)) for (const a of actions) map.set(`${m}.${a}`, 'all');
      return map;
    }
    const key = `${userId}:${workspace}`;
    const hit = this.permCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.perms;

    const rows = await this.db
      .selectFrom('user_roles as ur')
      .innerJoin('roles as r', 'r.id', 'ur.role_id')
      .innerJoin('role_permissions as rp', 'rp.role_id', 'r.id')
      .innerJoin('permissions as p', 'p.id', 'rp.permission_id')
      .select(['p.module_key', 'p.action', 'rp.scope'])
      .where('ur.user_id', '=', userId)
      .where('r.workspace', '=', workspace)
      .where('r.is_active', '=', 1)
      .where((eb) => eb.or([eb('ur.valid_from', 'is', null), eb('ur.valid_from', '<=', sql<Date>`CURRENT_DATE()`)]))
      .where((eb) => eb.or([eb('ur.valid_to', 'is', null), eb('ur.valid_to', '>=', sql<Date>`CURRENT_DATE()`)]))
      .execute();

    const perms = new Map<string, Scope>();
    for (const r of rows) {
      const k = `${r.module_key}.${r.action}`;
      const prev = perms.get(k);
      if (!prev || SCOPE_RANK[r.scope] > SCOPE_RANK[prev]) perms.set(k, r.scope);
    }
    this.permCache.set(key, { at: Date.now(), perms });
    return perms;
  }

  async featureFlags(): Promise<Map<string, boolean>> {
    if (this.flagCache && Date.now() - this.flagCache.at < CACHE_MS) return this.flagCache.flags;
    const rows = await this.db.selectFrom('feature_flags').select(['module_key', 'is_enabled']).execute();
    const flags = new Map(rows.map((r) => [r.module_key, r.is_enabled === 1]));
    this.flagCache = { at: Date.now(), flags };
    return flags;
  }

  async isModuleEnabled(module: string): Promise<boolean> {
    if (CORE_MODULES.has(module)) return true;
    return (await this.featureFlags()).get(module) === true;
  }

  /**
   * Field policies for the user's roles in a workspace. Most permissive access wins:
   * a field is hidden only if EVERY role the user holds in this workspace hides it
   * (a role with no rule for a field allows viewing it).
   */
  async fieldAccess(userId: number, workspace: Workspace, entity: string): Promise<Map<string, 'hidden' | 'view' | 'edit'>> {
    const roles = await this.db
      .selectFrom('user_roles as ur')
      .innerJoin('roles as r', 'r.id', 'ur.role_id')
      .select('r.id')
      .where('ur.user_id', '=', userId)
      .where('r.workspace', '=', workspace)
      .where('r.is_active', '=', 1)
      .execute();
    const out = new Map<string, 'hidden' | 'view' | 'edit'>();
    if (!roles.length) return out;
    const rows = await this.db
      .selectFrom('field_policies')
      .select(['role_id', 'field_key', 'access'])
      .where('role_id', 'in', roles.map((r) => r.id))
      .where('entity', '=', entity)
      .execute();
    const rank = { hidden: 0, view: 1, edit: 2 } as const;
    const byField = new Map<string, Map<number, 'hidden' | 'view' | 'edit'>>();
    for (const r of rows) {
      if (!byField.has(r.field_key)) byField.set(r.field_key, new Map());
      byField.get(r.field_key)!.set(r.role_id, r.access);
    }
    for (const [field, perRole] of byField) {
      let best: 'hidden' | 'view' | 'edit' = 'hidden';
      for (const role of roles) {
        const a = perRole.get(role.id) ?? 'view';
        if (rank[a] > rank[best]) best = a;
      }
      out.set(field, best);
    }
    return out;
  }
}
