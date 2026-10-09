import type { Database } from '../database/database.module';

/** Active staff logins whose roles grant module.action (used to alert the people who must act). */
export async function staffWith(db: Database, module: string, action: string, exceptUserId?: number) {
  let q = db.selectFrom('users as us').innerJoin('user_roles as ur', 'ur.user_id', 'us.id').innerJoin('role_permissions as rp', 'rp.role_id', 'ur.role_id')
    .innerJoin('permissions as p', 'p.id', 'rp.permission_id').innerJoin('roles as ro', 'ro.id', 'ur.role_id')
    .select('us.id').distinct().where('p.module_key', '=', module).where('p.action', '=', action).where('ro.workspace', '=', 'staff')
    .where('ro.is_active', '=', 1).where('us.status', '=', 'active');
  if (exceptUserId) q = q.where('us.id', '!=', exceptUserId);
  return (await q.execute()).map((r) => r.id);
}
