import type { Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { newPublicId } from '../common/ids';

/**
 * Family login rules (requirements 6.3, 6.4, 7):
 *  - one login per family, identified by the family mobile (L8)
 *  - if a staff member already uses that mobile, the family is linked to the staff
 *    account, giving them the Staff / Parent switch (L3, L14)
 *  - a family login is auto-disabled when none of its children is active (ST5)
 */
export async function findOrCreateFamilyUser(
  trx: Database, input: { name: string; mobile: string; email?: string | null }, actorId: number | null,
): Promise<number> {
  const byMobile = await trx.selectFrom('users').select(['id', 'email']).where('mobile', '=', input.mobile).executeTakeFirst();
  let userId: number;
  if (byMobile) {
    const hasFamily = await trx.selectFrom('families').select('id').where('user_id', '=', byMobile.id).executeTakeFirst();
    if (hasFamily) throw Errors.conflict(`Mobile ${input.mobile} already belongs to another family. Add the student to that family instead.`);
    userId = byMobile.id;
    if (input.email && !byMobile.email) {
      const emailOwner = await trx.selectFrom('users').select('id').where('email', '=', input.email).executeTakeFirst();
      if (!emailOwner) await trx.updateTable('users').set({ email: input.email }).where('id', '=', userId).execute();
    }
  } else {
    if (input.email) {
      const emailOwner = await trx.selectFrom('users').select('id').where('email', '=', input.email).executeTakeFirst();
      if (emailOwner) throw Errors.conflict(`Email ${input.email} is already used by another account.`);
    }
    const res = await trx.insertInto('users').values({
      public_id: newPublicId(), name: input.name, mobile: input.mobile, email: input.email ?? null,
      password_hash: null, must_change_password: 1, created_by: actorId,
    }).executeTakeFirstOrThrow();
    userId = Number(res.insertId);
  }
  const parentRole = await trx.selectFrom('roles').select('id').where('role_key', '=', 'parent').executeTakeFirstOrThrow();
  await trx.insertInto('user_roles').values({ user_id: userId, role_id: parentRole.id, assigned_by: actorId }).ignore().execute();
  return userId;
}

/** Re-evaluates rule ST5 for one family. Never touches accounts that are also staff or manually disabled. */
export async function syncFamilyLogin(trx: Database, familyId: number) {
  const fam = await trx.selectFrom('families as f').innerJoin('users as u', 'u.id', 'f.user_id')
    .select(['u.id as user_id', 'u.status']).where('f.id', '=', familyId).executeTakeFirst();
  if (!fam) return null;
  const isStaff = await trx.selectFrom('staff').select('id').where('user_id', '=', fam.user_id).executeTakeFirst();
  if (isStaff) return null;
  const active = await trx.selectFrom('students').select('id').where('family_id', '=', familyId).where('status', '=', 'active').executeTakeFirst();
  if (!active && fam.status === 'active') {
    await trx.updateTable('users').set({ status: 'auto_disabled' }).where('id', '=', fam.user_id).execute();
    await trx.updateTable('sessions').set({ revoked_at: new Date() }).where('user_id', '=', fam.user_id).where('revoked_at', 'is', null).execute();
    return 'auto_disabled' as const;
  }
  if (active && fam.status === 'auto_disabled') {
    await trx.updateTable('users').set({ status: 'active' }).where('id', '=', fam.user_id).execute();
    return 'active' as const;
  }
  return null;
}
