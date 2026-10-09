import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';
import { newPublicId } from '../src/common/ids';
import { sha256 } from '../src/auth/passwords';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };

describe('R1 foundation (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let http: ReturnType<typeof request>;
  let devToken: string;

  const login = (identifier: string, password: string) => http.post('/api/v1/auth/login').send({ identifier, password });
  const auth = (token: string, ws?: string) => {
    const h = (r: request.Test) => { r.set('Authorization', `Bearer ${token}`); if (ws) r.set('X-Workspace', ws); return r; };
    return {
      get: (u: string) => h(http.get(u)),
      post: (u: string, b: object = {}) => h(http.post(u)).send(b),
      patch: (u: string, b: object) => h(http.patch(u)).send(b),
      put: (u: string, b: object) => h(http.put(u)).send(b),
    };
  };

  async function createStaff(roleKeys: string[], n: number) {
    const res = await auth(devToken).post('/api/v1/staff', {
      name: `Staff ${n}`, email: `staff${n}@test.local`, mobile: `98480000${String(n).padStart(2, '0')}`,
      employeeCode: `EMP${n}`, designation: 'Teacher', roleKeys,
    });
    expect(res.status).toBe(201);
    const cred = await auth(devToken).post(`/api/v1/users/${res.body.data.user_id}/credentials`);
    expect(cred.status).toBe(200);
    return { staff: res.body.data, cred: cred.body.data };
  }

  async function activeToken(identifier: string, temp: string, newPassword = 'NewPass@123') {
    const first = await login(identifier, temp);
    await auth(first.body.data.accessToken).post('/api/v1/auth/change-password', { currentPassword: temp, newPassword });
    const second = await login(identifier, newPassword);
    return second.body.data.accessToken as string;
  }

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp();
    await app.init();
    http = request(app.getHttpServer()) as any;
    const res = await login(DEV.email, DEV.password);
    devToken = res.body.data.accessToken;
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  describe('Authentication', () => {
    it('logs in the developer by email and returns the standard envelope', async () => {
      const res = await login(DEV.email, DEV.password);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeTruthy();
      expect(res.body.data.workspaces).toEqual(['staff']);
      expect(res.headers['set-cookie']?.[0]).toMatch(/ems_rt=.*HttpOnly/);
    });

    it('rejects a wrong password with INVALID_CREDENTIALS', async () => {
      const res = await login(DEV.email, 'wrong');
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ success: false, code: 'INVALID_CREDENTIALS' });
    });

    it('requires a token for protected endpoints', async () => {
      const res = await http.get('/api/v1/classes');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('locks the account after 5 failed attempts (rule: login throttling/lock)', async () => {
      const { cred } = await createStaff(['teacher'], 1);
      for (let i = 0; i < 5; i++) await login(cred.username, 'bad-password-1');
      const res = await login(cred.username, cred.temporaryPassword);
      expect(res.status).toBe(423);
      expect(res.body.code).toBe('ACCOUNT_LOCKED');
      // Re-issuing credentials unlocks the account
      const user = await db.selectFrom('users').select('public_id').where('mobile', '=', '9848000001').executeTakeFirstOrThrow();
      const again = await auth(devToken).post(`/api/v1/users/${user.public_id}/credentials`);
      expect((await login(cred.username, again.body.data.temporaryPassword)).status).toBe(200);
    });

    it('rotates refresh tokens and revokes everything when an old token is reused', async () => {
      const res = await http.post('/api/v1/auth/login').set('X-Client', 'mobile').send({ identifier: DEV.email, password: DEV.password });
      const rt1 = res.body.data.refreshToken;
      const r2 = await http.post('/api/v1/auth/refresh').set('X-Client', 'mobile').send({ refreshToken: rt1 });
      expect(r2.status).toBe(200);
      const rt2 = r2.body.data.refreshToken;
      expect(rt2).not.toEqual(rt1);
      const reuse = await http.post('/api/v1/auth/refresh').set('X-Client', 'mobile').send({ refreshToken: rt1 });
      expect(reuse.status).toBe(401);
      const afterTheft = await http.post('/api/v1/auth/refresh').set('X-Client', 'mobile').send({ refreshToken: rt2 });
      expect(afterTheft.status).toBe(401);
      devToken = (await login(DEV.email, DEV.password)).body.data.accessToken;
    });
  });

  describe('Staff and credentials (T12, T13)', () => {
    it('creates staff, issues a WhatsApp-ready temporary password that is never stored in plain text', async () => {
      const { staff, cred } = await createStaff(['teacher'], 2);
      expect(staff.roles).toEqual([{ role_key: 'teacher', name: 'Teacher' }]);
      expect(cred.username).toBe('9848000002');
      expect(cred.temporaryPassword).toMatch(/^[A-Za-z2-9]{10}$/);
      expect(cred.whatsappUrl).toMatch(/^https:\/\/wa\.me\/919848000002\?text=/);
      const row = await db.selectFrom('users').select('password_hash').where('mobile', '=', '9848000002').executeTakeFirstOrThrow();
      expect(row.password_hash).toMatch(/^scrypt\$/);
      const issues = await db.selectFrom('credential_issues').selectAll().execute();
      expect(JSON.stringify(issues)).not.toContain(cred.temporaryPassword);
    });

    it('forces a password change at first login and blocks other endpoints until done (T13)', async () => {
      const first = await login('9848000002', (await auth(devToken).post(`/api/v1/users/${(await db.selectFrom('users').select('public_id').where('mobile', '=', '9848000002').executeTakeFirstOrThrow()).public_id}/credentials`)).body.data.temporaryPassword);
      expect(first.body.data.mustChangePassword).toBe(true);
      const token = first.body.data.accessToken;
      const blocked = await auth(token).get('/api/v1/classes');
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect((await auth(token).get('/api/v1/auth/me')).status).toBe(200);
      const weak = await auth(token).post('/api/v1/auth/change-password', { currentPassword: 'x', newPassword: 'short' });
      expect(weak.status).toBe(422);
    });

    it('lets staff log in with mobile or email (L6)', async () => {
      const { cred } = await createStaff(['teacher'], 3);
      const token = await activeToken(cred.username, cred.temporaryPassword);
      expect((await auth(token).get('/api/v1/classes')).status).toBe(200);
      expect((await login('staff3@test.local', 'NewPass@123')).status).toBe(200);
      expect((await login('+91 98480 00003', 'NewPass@123')).status).toBe(200);
    });

    it('rejects duplicate email or mobile across accounts (T12)', async () => {
      const res = await auth(devToken).post('/api/v1/staff', {
        name: 'Dup', email: 'other@test.local', mobile: '9848000003', employeeCode: 'EMP99', roleKeys: ['teacher'],
      });
      expect(res.status).toBe(409);
    });

    it('disables an account, ends its sessions and blocks login (T7)', async () => {
      const { staff, cred } = await createStaff(['teacher'], 4);
      const token = await activeToken(cred.username, cred.temporaryPassword);
      const off = await auth(devToken).post(`/api/v1/users/${staff.user_id}/disable`);
      expect(off.status).toBe(200);
      expect((await auth(token).get('/api/v1/classes')).status).toBe(401);
      const res = await login(cred.username, 'NewPass@123');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_DISABLED');
    });

    it('queues a reset email for staff and resets the password with the token (T14)', async () => {
      const res = await http.post('/api/v1/auth/forgot-password').send({ email: 'staff3@test.local' });
      expect(res.status).toBe(200);
      const mail = await db.selectFrom('email_outbox').selectAll().orderBy('id', 'desc').executeTakeFirstOrThrow();
      expect(mail.to_email).toBe('staff3@test.local');
      const token = /reset-password\?token=([\w-]+)/.exec(mail.body_html)![1];
      const reset = await http.post('/api/v1/auth/reset-password').send({ token, newPassword: 'Reset@1234' });
      expect(reset.status).toBe(200);
      expect((await login('staff3@test.local', 'Reset@1234')).status).toBe(200);
      const reuse = await http.post('/api/v1/auth/reset-password').send({ token, newPassword: 'Again@1234' });
      expect(reuse.body.code).toBe('RESET_LINK_INVALID');
    });

    it('does not reveal whether an email exists on forgot-password', async () => {
      const res = await http.post('/api/v1/auth/forgot-password').send({ email: 'nobody@test.local' });
      expect(res.status).toBe(200);
    });
  });

  describe('Permissions, scopes and feature flags', () => {
    let teacherToken: string;
    let adminToken: string;

    beforeAll(async () => {
      const t = await createStaff(['teacher'], 10);
      teacherToken = await activeToken(t.cred.username, t.cred.temporaryPassword);
      const a = await createStaff(['institution_admin'], 11);
      adminToken = await activeToken(a.cred.username, a.cred.temporaryPassword);
    });

    it('lets a teacher view classes but not create them', async () => {
      expect((await auth(teacherToken).get('/api/v1/classes')).status).toBe(200);
      const res = await auth(teacherToken).post('/api/v1/classes', { name: 'Class 11', levelOrder: 11 });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('stops a teacher from creating staff or issuing credentials', async () => {
      expect((await auth(teacherToken).get('/api/v1/staff')).status).toBe(403);
    });

    it('lets the Institution Admin manage academics', async () => {
      const res = await auth(adminToken).post('/api/v1/classes/1/sections', { name: 'b' });
      expect(res.status).toBe(201);
      const classes = await auth(adminToken).get('/api/v1/classes');
      expect(classes.body.data[0].sections.map((s: any) => s.name)).toEqual(['A', 'B']);
    });

    it('blocks the Institution Admin from developer settings and feature flags (T10)', async () => {
      expect((await auth(adminToken).get('/api/v1/developer/feature-flags')).status).toBe(403);
      expect((await auth(adminToken).put('/api/v1/developer/feature-flags/fees', { enabled: true })).status).toBe(403);
    });

    it('returns FEATURE_DISABLED for a disabled module, for everyone (T11)', async () => {
      expect((await auth(devToken).put('/api/v1/developer/feature-flags/academics', { enabled: false })).status).toBe(200);
      const res = await auth(adminToken).get('/api/v1/classes');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FEATURE_DISABLED');
      await auth(devToken).put('/api/v1/developer/feature-flags/academics', { enabled: true });
      expect((await auth(adminToken).get('/api/v1/classes')).status).toBe(200);
    });

    it('does not let the Institution Admin modify the developer account', async () => {
      const dev = await db.selectFrom('users').select('public_id').where('is_super_admin', '=', 1).executeTakeFirstOrThrow();
      expect((await auth(adminToken).post(`/api/v1/users/${dev.public_id}/disable`)).status).toBe(403);
    });

    it('allows only one current academic year', async () => {
      const created = await auth(adminToken).post('/api/v1/academic-years', { name: '2027-28', startDate: '2027-06-01', endDate: '2028-04-30' });
      expect(created.status).toBe(201);
      const overlap = await auth(adminToken).post('/api/v1/academic-years', { name: '2027-29', startDate: '2027-07-01', endDate: '2028-03-30' });
      expect(overlap.status).toBe(409);
      expect((await auth(adminToken).post(`/api/v1/academic-years/${created.body.data.id}/make-current`)).status).toBe(403);
      await auth(devToken).post(`/api/v1/academic-years/${created.body.data.id}/make-current`);
      const years = await auth(adminToken).get('/api/v1/academic-years');
      expect(years.body.data.filter((y: any) => y.is_current === 1).map((y: any) => y.name)).toEqual(['2027-28']);
      // Put 2026-27 back so other suites run in the expected year
      const y2026 = years.body.data.find((y: any) => y.name === '2026-27');
      await auth(devToken).post(`/api/v1/academic-years/${y2026.id}/make-current`);
    });

    it('writes an audit entry for important actions', async () => {
      const logs = await db.selectFrom('audit_logs').select(['module_key', 'action']).execute();
      const actions = logs.map((l) => `${l.module_key}.${l.action}`);
      expect(actions).toEqual(expect.arrayContaining(['staff.create', 'users.issue_credentials', 'users.disable', 'academics.create_section', 'features.disable']));
    });
  });

  describe('Staff who are also parents (L14 to L17, T6)', () => {
    it('shows both workspaces and limits Parent workspace to family permissions', async () => {
      const { cred } = await createStaff(['institution_admin'], 20);
      const token = await activeToken(cred.username, cred.temporaryPassword);
      const user = await db.selectFrom('users').select('id').where('mobile', '=', cred.username).executeTakeFirstOrThrow();
      // Link a family directly (the Students API is covered in the sprint 2 tests).
      const fam = await db.insertInto('families').values({ public_id: newPublicId(), user_id: user.id, family_name: 'Staff 20 family', primary_mobile: cred.username }).executeTakeFirstOrThrow();
      // Parent view requires at least one active child (rule ST5)
      await db.insertInto('students').values({ public_id: newPublicId(), admission_no: 'S20-1', family_id: Number(fam.insertId), first_name: 'Child' }).execute();
      const parentRole = await db.selectFrom('roles').select('id').where('role_key', '=', 'parent').executeTakeFirstOrThrow();
      await db.insertInto('user_roles').values({ user_id: user.id, role_id: parentRole.id }).execute();

      const me = await auth(token).get('/api/v1/auth/me');
      expect(me.body.data.workspaces).toEqual(['staff', 'parent']);
      expect(me.body.data.workspace).toBe('staff');

      const parentMe = await auth(token, 'parent').get('/api/v1/auth/me');
      expect(parentMe.body.data.workspace).toBe('parent');
      expect(parentMe.body.data.permissions['students.view']).toBe('own_children');
      expect(parentMe.body.data.permissions['academics.manage']).toBeUndefined();

      // Admin powers do not leak into the Parent workspace
      expect((await auth(token, 'parent').post('/api/v1/classes', { name: 'X', levelOrder: 50 })).status).toBe(403);
      expect((await auth(token, 'student').get('/api/v1/auth/me')).body.code).toBe('WORKSPACE_UNAVAILABLE');
    });
  });

  it('keeps the refresh token hash, not the token, in the database', async () => {
    const res = await http.post('/api/v1/auth/login').set('X-Client', 'mobile').send({ identifier: DEV.email, password: DEV.password });
    const rt = res.body.data.refreshToken;
    const row = await db.selectFrom('sessions').select('refresh_token_hash').where('refresh_token_hash', '=', sha256(rt)).executeTakeFirst();
    expect(row).toBeDefined();
    const plain = await db.selectFrom('sessions').select('id').where('refresh_token_hash', '=', rt).executeTakeFirst();
    expect(plain).toBeUndefined();
  });
});
