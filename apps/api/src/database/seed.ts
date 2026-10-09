/**
 * Idempotent seed for a new installation. Safe to run on every deploy:
 * it only inserts what is missing and never overwrites admin changes.
 */
import '../config';
import { createDatabase, type Database } from './database.module';
import { newPublicId } from '../common/ids';
import { hashPassword, verifyPassword } from '../auth/passwords';
import { HOME_SECTIONS, MENUS, PAGES } from '../cms/defaults';
import { GRANT_PATCHES, DEFAULT_FEATURE_FLAGS, DEFAULT_FIELD_POLICIES, DEFAULT_ROLES, PERMISSION_CATALOG } from '../permissions/catalog';

export interface SeedOptions {
  institutionName: string;
  superAdminEmail: string;
  superAdminPassword: string;
  academicYear?: { name: string; start: string; end: string };
}

export function seedOptionsFromEnv(): SeedOptions {
  return {
    institutionName: process.env.SEED_INSTITUTION_NAME ?? 'My School',
    superAdminEmail: process.env.SEED_SUPERADMIN_EMAIL ?? 'dev@example.com',
    superAdminPassword: process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe@123',
  };
}

/** Passwords shown in .env.example and the install guides; never acceptable as a real developer password. */
const PUBLIC_EXAMPLE_PASSWORDS = ['ChangeMe@123', 'YourPass@123', 'a-strong-password'];
const isPublicExamplePassword = (p: string) => PUBLIC_EXAMPLE_PASSWORDS.includes(p);

export async function seed(db: Database, o: SeedOptions) {
  await db.insertInto('institution_settings').values({ id: 1, name: o.institutionName, institution_type: 'school' }).ignore().execute();

  await db.insertInto('feature_flags')
    .values(Object.entries(DEFAULT_FEATURE_FLAGS).map(([module_key, on]) => ({ module_key, is_enabled: on ? 1 : 0 })))
    .ignore().execute();

  const permRows = Object.entries(PERMISSION_CATALOG).flatMap(([module_key, actions]) => actions.map((action) => ({ module_key, action })));
  const before = new Set((await db.selectFrom('permissions').select(['module_key', 'action']).execute()).map((p) => `${p.module_key}.${p.action}`));
  await db.insertInto('permissions').values(permRows).ignore().execute();
  const perms = await db.selectFrom('permissions').select(['id', 'module_key', 'action']).execute();
  const permId = new Map(perms.map((p) => [`${p.module_key}.${p.action}`, p.id]));
  // Permissions added by this version of the app (empty on a fresh install's first run, since `before` is empty then and roles are new).
  const added = before.size ? new Set(permRows.map((p) => `${p.module_key}.${p.action}`).filter((k) => !before.has(k))) : new Set<string>();

  for (const role of DEFAULT_ROLES) {
    const ins = await db.insertInto('roles').values({ role_key: role.key, name: role.name, workspace: role.workspace, is_system: 1 }).ignore().executeTakeFirst();
    const r = await db.selectFrom('roles').select('id').where('role_key', '=', role.key).executeTakeFirstOrThrow();
    // A role created just now gets its full defaults. An existing one keeps exactly what was set for it (even nothing at all).
    const existing = Number(ins.numInsertedOrUpdatedRows ?? 0) > 0 ? [] : [{ existing: true }];
    const template = role.grants === 'ALL'
      ? perms.map((p) => [`${p.module_key}.${p.action}`, 'all'] as const)
      : role.grants.map(([perm, scope]) => [perm, scope ?? 'all'] as const);
    // Existing role: never touch what the admin configured; only add defaults for permissions new in this version.
    const wanted = existing.length ? template.filter(([perm]) => added.has(perm)) : template;
    const grants = wanted.map(([perm, scope]) => {
      const id = permId.get(perm);
      if (!id) throw new Error(`Unknown permission ${perm} in role ${role.key}`);
      return { role_id: r.id, permission_id: id, scope: scope as any };
    });
    if (grants.length) await db.insertInto('role_permissions').values(grants).ignore().execute();
  }

  const doneRow = await db.selectFrom('settings').select('value').where('setting_group', '=', 'seed').where('setting_key', '=', 'grant_patches').executeTakeFirst();
  const done: string[] = doneRow ? (typeof doneRow.value === 'string' ? JSON.parse(doneRow.value) : (doneRow.value as any)) : [];
  for (const patch of GRANT_PATCHES.filter((p) => !done.includes(p.id))) {
    for (const [roleKey, perm, scope] of patch.grants) {
      const role = await db.selectFrom('roles').select('id').where('role_key', '=', roleKey).executeTakeFirst();
      const pid = permId.get(perm);
      if (role && pid) await db.insertInto('role_permissions').values({ role_id: role.id, permission_id: pid, scope }).ignore().execute();
    }
    done.push(patch.id);
  }
  await db.insertInto('settings').values({ setting_group: 'seed', setting_key: 'grant_patches', value: JSON.stringify(done) })
    .onDuplicateKeyUpdate({ value: JSON.stringify(done) }).execute();

  const roles = await db.selectFrom('roles').select(['id', 'role_key']).execute();
  const roleId = new Map(roles.map((r) => [r.role_key, r.id]));
  await db.insertInto('field_policies')
    .values(DEFAULT_FIELD_POLICIES.map(([role, entity, field_key, access]) => ({ role_id: roleId.get(role)!, entity, field_key, access })))
    .ignore().execute();

  await db.insertInto('email_templates').values([
    {
      template_key: 'password_reset',
      subject: 'Reset your {{institution_name}} password',
      body_html: '<p>Hello {{name}},</p><p>Use the link below to set a new password. It expires in {{expires_minutes}} minutes.</p>'
        + '<p><a href="{{reset_url}}">Set a new password</a></p><p>If you did not ask for this, you can ignore this email.</p>',
    },
  ]).ignore().execute();

  await db.insertInto('email_templates').values([{
    template_key: 'fee_reminder',
    subject: 'Fee reminder: {{student}} ({{school}})',
    body_html: '<p>Dear {{parent}},</p><p>This is a reminder about fees for <strong>{{student}}</strong> ({{class}}).</p>'
      + '<pre style="font-family:inherit;font-size:15px;line-height:1.6;margin:12px 0">{{items}}</pre>'
      + '<p><strong>Total: {{total}}</strong></p><p>Please pay at the school office or contact us if you have already paid. You can also see the details in the school app.</p>'
      + '<p>Thank you,<br>{{school}}<br>{{phone}}</p>',
  }]).ignore().execute();
  await db.insertInto('email_templates').values([{
    template_key: 'contact_message',
    subject: 'Website message from {{name}}',
    body_html: '<p>New message from the school website.</p><p><strong>Name:</strong> {{name}}<br><strong>Mobile:</strong> {{mobile}}</p><p>{{message}}</p>',
  }]).ignore().execute();

  // Grade scales (Telangana defaults; editable in Exams > Settings)
  const SCALES: Array<[string, Array<[string, number, string]>]> = [
    ['Primary (Classes 1-5)', [['A+', 91, 'Outstanding'], ['A', 71, 'Very good'], ['B+', 51, 'Good'], ['B', 41, 'Satisfactory'], ['C', 0, 'Needs improvement']]],
    ['High school (Classes 6-10)', [['A1', 91, ''], ['A2', 81, ''], ['B1', 71, ''], ['B2', 61, ''], ['C1', 51, ''], ['C2', 41, ''], ['D', 35, ''], ['E', 0, '']]],
  ];
  for (const [name, bands] of SCALES) {
    const exists = await db.selectFrom('grade_scales').select('id').where('name', '=', name).executeTakeFirst();
    if (exists) continue;
    const r = await db.insertInto('grade_scales').values({ name }).executeTakeFirstOrThrow();
    await db.insertInto('grade_bands').values(bands.map(([grade, min, label]) => ({ scale_id: Number(r.insertId), grade, min_pct: String(min), label: label || null }))).execute();
  }

  // Website starter content (only what is missing; never overwrites edits)
  await db.insertInto('cms_pages').values(PAGES).ignore().execute();
  await db.insertInto('cms_home_sections')
    .values(HOME_SECTIONS.map((h, i) => ({ section_key: h.key, position: i + 1, is_visible: h.visible ? 1 : 0, content: JSON.stringify(h.content) })))
    .ignore().execute();
  const anyMenu = await db.selectFrom('cms_menu_items').select('id').limit(1).executeTakeFirst();
  if (!anyMenu) await db.insertInto('cms_menu_items').values(MENUS.map((m, i) => ({ ...m, position: i + 1 }))).execute();
  await db.insertInto('settings').values([
    { setting_group: 'website', setting_key: 'contact', value: JSON.stringify({ mapEmbedUrl: '', officeHours: 'Monday to Saturday, 9:00 am to 4:30 pm' }) },
    { setting_group: 'website', setting_key: 'social', value: JSON.stringify({ facebook: '', instagram: '', youtube: '', x: '' }) },
  ]).ignore().execute();

  const email = o.superAdminEmail.toLowerCase();
  const dev = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
  if (!dev) {
    await db.insertInto('users').values({
      public_id: newPublicId(), name: 'Developer', email, password_hash: await hashPassword(o.superAdminPassword),
      must_change_password: isPublicExamplePassword(o.superAdminPassword) ? 1 : 0, is_super_admin: 1,
    }).execute();
  }
  // Any developer login still using a password printed in the guides must be changed at the next sign-in.
  for (const u of await db.selectFrom('users').select(['id', 'password_hash']).where('is_super_admin', '=', 1).where('must_change_password', '=', 0).execute()) {
    for (const pw of PUBLIC_EXAMPLE_PASSWORDS) if (u.password_hash && (await verifyPassword(u.password_hash, pw))) {
      await db.updateTable('users').set({ must_change_password: 1 }).where('id', '=', u.id).execute();
      break;
    }
  }

  const anyClass = await db.selectFrom('classes').select('id').limit(1).executeTakeFirst();
  if (!anyClass) {
    const names: Array<[string, number]> = [['Nursery', -2], ['LKG', -1], ['UKG', 0],
      ...Array.from({ length: 10 }, (_, i) => [`Class ${i + 1}`, i + 1] as [string, number])];
    await db.insertInto('classes').values(names.map(([name, level_order]) => ({ name, level_order }))).execute();
    const cls = await db.selectFrom('classes').select('id').execute();
    await db.insertInto('sections').values(cls.map((c) => ({ class_id: c.id, name: 'A' }))).execute();
  }

  const y = o.academicYear ?? { name: '2026-27', start: '2026-06-01', end: '2027-04-30' };
  const anyYear = await db.selectFrom('academic_years').select('id').limit(1).executeTakeFirst();
  if (!anyYear) {
    await db.insertInto('academic_years')
      .values({ name: y.name, start_date: new Date(y.start), end_date: new Date(y.end), is_current: 1, status: 'active' }).execute();
  }
}

if (require.main === module) {
  const db = createDatabase();
  seed(db, seedOptionsFromEnv())
    .then(() => console.log('Seed complete.'))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => db.destroy());
}
