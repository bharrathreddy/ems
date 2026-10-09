import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };

describe('Access and roles (e2e)', () => {
  let app: INestApplication; let db: Database; let http: any; let dev: string; let principal: string; let teacher: string; let admin: string;
  const S: Record<string, any> = {}; const R: Record<string, any> = {};
  const login = (i: string, p: string) => http.post('/api/v1/auth/login').send({ identifier: i, password: p });
  const as = (t: string) => {
    const h = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
    return { get: (u: string) => h(http.get(u)), post: (u: string, b: object = {}) => h(http.post(u)).send(b), put: (u: string, b: object) => h(http.put(u)).send(b),
      patch: (u: string, b: object) => h(http.patch(u)).send(b), del: (u: string) => h(http.delete(u)) };
  };
  async function activate(identifier: string, userId: string) {
    const c = (await as(dev).post(`/api/v1/users/${userId}/credentials`)).body.data;
    const t = (await login(identifier, c.temporaryPassword)).body.data.accessToken;
    await as(t).post('/api/v1/auth/change-password', { currentPassword: c.temporaryPassword, newPassword: 'NewPass@123' });
    return (await login(identifier, 'NewPass@123')).body.data.accessToken as string;
  }
  const overview = async () => (await as(dev).get('/api/v1/developer/access')).body.data;
  const role = async (key: string) => (await overview()).roles.find((r: any) => r.key === key);

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp(); await app.init(); http = request(app.getHttpServer());
    dev = (await login(DEV.email, DEV.password)).body.data.accessToken;
    const staff = (name: string, mobile: string, code: string, roleKeys: string[]) => as(dev).post('/api/v1/staff', { name, email: `${code.toLowerCase()}@test.local`, mobile, employeeCode: code, roleKeys }).then((r) => r.body.data);
    S.principal = await staff('Prema Principal', '9880100001', 'P-1', ['principal']);
    S.teacher = await staff('Ravi Teacher', '9880100002', 'T-1', ['teacher']);
    S.admin = await staff('Anita Admin', '9880100003', 'A-1', ['institution_admin']);
    principal = await activate('9880100001', S.principal.user_id);
    teacher = await activate('9880100002', S.teacher.user_id);
    admin = await activate('9880100003', S.admin.user_id);
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('shows modules, their switches and every role with what it can do; developer only', async () => {
    const o = await overview();
    expect(o.modules.find((m: any) => m.key === 'fees')).toMatchObject({ actions: ['view', 'configure', 'discount'], enabled: false });
    const p = o.roles.find((r: any) => r.key === 'principal');
    expect(p).toMatchObject({ name: 'Principal', workspace: 'staff', isSystem: true, people: 1 });
    expect(p.grants['students.view']).toBe('all');
    expect(o.roles.find((r: any) => r.key === 'parent').grants['students.view']).toBe('own_children');
    for (const t of [principal, admin, teacher]) expect((await as(t).get('/api/v1/developer/access')).status).toBe(403);
  });

  it('changes a role and it applies at once, including for the Principal and Institution Admin', async () => {
    expect((await as(principal).get('/api/v1/staff')).status).toBe(200);
    const p = await role('principal');
    const grants = { ...p.grants }; delete grants['staff.view'];
    const r = await as(dev).put(`/api/v1/developer/access/roles/${p.id}/grants`, { grants });
    expect(r.status).toBe(200);
    expect((await as(principal).get('/api/v1/staff')).status).toBe(403); // same sign-in, next request
    expect((await as(principal).get('/api/v1/auth/me')).body.data.permissions['staff.view']).toBeUndefined();
    const a = await role('institution_admin');
    const ag = { ...a.grants }; delete ag['settings.configure'];
    await as(dev).put(`/api/v1/developer/access/roles/${a.id}/grants`, { grants: ag });
    expect((await as(admin).patch('/api/v1/settings/institution', { name: 'X' })).status).toBe(403);
    // Logged: what was removed.
    const log = (await as(dev).get('/api/v1/developer/activity?module=roles')).body.data.rows;
    expect(JSON.stringify(log[0].before)).toContain('settings.configure');
    // Wrong scope for a workspace is refused.
    expect((await as(dev).put(`/api/v1/developer/access/roles/${p.id}/grants`, { grants: { 'students.view': 'own_children' } })).status).toBe(422);
    expect((await as(dev).put(`/api/v1/developer/access/roles/${p.id}/grants`, { grants: { 'nothing.here': 'all' } })).status).toBe(422);
  });

  it('keeps a role emptied on purpose empty after a restart', async () => {
    const lib = await role('librarian');
    await as(dev).put(`/api/v1/developer/access/roles/${lib.id}/grants`, { grants: {} });
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    expect((await role('librarian')).grants).toEqual({});
    // A previously removed permission is not put back either.
    expect((await role('principal')).grants['staff.view']).toBeUndefined();
  });

  it('gives and takes away access for one person, on top of their roles', async () => {
    expect((await as(teacher).get('/api/v1/staff')).status).toBe(403);
    let person = (await as(dev).get(`/api/v1/developer/access/people/${S.teacher.user_id}`)).body.data;
    expect(person.roles.map((r: any) => r.key)).toEqual(['teacher']);
    expect(person.effective.staff['timetable.view']).toBe('all');
    const r = await as(dev).put(`/api/v1/developer/access/people/${S.teacher.user_id}/exceptions`, { workspace: 'staff', overrides: [{ perm: 'staff.view', effect: 'grant', scope: 'all' }, { perm: 'timetable.view', effect: 'deny' }] });
    expect(r.status).toBe(200);
    expect(r.body.data.effective.staff['staff.view']).toBe('all');
    expect(r.body.data.effective.staff['timetable.view']).toBeUndefined();
    expect((await as(teacher).get('/api/v1/staff')).status).toBe(200);
    expect((await as(teacher).get('/api/v1/timetable/mine')).status).toBe(403);
    // Clearing the exceptions brings the role's access back.
    await as(dev).put(`/api/v1/developer/access/people/${S.teacher.user_id}/exceptions`, { workspace: 'staff', overrides: [] });
    expect((await as(teacher).get('/api/v1/staff')).status).toBe(403);
    expect((await as(dev).get(`/api/v1/developer/access/people/${(await db.selectFrom('users').select('public_id').where('is_super_admin', '=', 1).executeTakeFirstOrThrow()).public_id}`)).body.code).toBe('DEVELOPER');
    person = (await as(dev).get(`/api/v1/developer/access/people/${S.teacher.user_id}`)).body.data;
    expect(person.overrides).toEqual([]);
  });

  it('creates a role copied from another, assigns it, renames, and deletes only when unused', async () => {
    const t = await role('teacher');
    const c = await as(dev).post('/api/v1/developer/access/roles', { name: 'Office Manager', workspace: 'staff', copyFrom: t.id });
    expect(c.status).toBe(201);
    R.om = c.body.data;
    expect(R.om.key).toBe('custom_office_manager');
    const om = await role('custom_office_manager');
    expect(om.grants).toEqual(t.grants);
    expect((await as(dev).post('/api/v1/developer/access/roles', { name: 'Office Manager', workspace: 'staff' })).body.details[0].field).toBe('name');
    // Shows in the staff screen's role list and can be given to someone.
    expect((await as(dev).get('/api/v1/roles/staff')).body.data.map((r: any) => r.role_key)).toContain('custom_office_manager');
    expect((await as(dev).patch(`/api/v1/staff/${S.teacher.public_id}`, { roleKeys: ['teacher', 'custom_office_manager'] })).status).toBe(200);
    expect((await as(dev).del(`/api/v1/developer/access/roles/${R.om.id}`)).body.code).toBe('ROLE_IN_USE');
    await as(dev).patch(`/api/v1/developer/access/roles/${R.om.id}`, { name: 'Office Head' });
    expect((await role('custom_office_manager')).name).toBe('Office Head');
    await as(dev).patch(`/api/v1/staff/${S.teacher.public_id}`, { roleKeys: ['teacher'] });
    expect((await as(dev).del(`/api/v1/developer/access/roles/${R.om.id}`)).status).toBe(200);
    expect((await as(dev).del(`/api/v1/developer/access/roles/${t.id}`)).body.code).toBe('SYSTEM_ROLE');
    expect((await as(dev).patch(`/api/v1/developer/access/roles/${(await role('parent')).id}`, { isActive: false })).body.code).toBe('ROLE_REQUIRED');
  });
});
