import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';
import { ActivityService, deviceOf } from '../src/activity/activity.service';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };

describe('Login as and activity log (e2e)', () => {
  let app: INestApplication; let db: Database; let http: any; let dev: string; let teacher: string;
  const S: Record<string, any> = {}; const K: Record<string, any> = {}; const cls: Record<string, number> = {}; const sec: Record<string, number> = {};
  const login = (i: string, p: string) => http.post('/api/v1/auth/login').send({ identifier: i, password: p });
  const as = (t: string, ws?: string) => {
    const h = (r: request.Test) => { r.set('Authorization', `Bearer ${t}`); if (ws) r.set('X-Workspace', ws); return r; };
    return { get: (u: string) => h(http.get(u)), post: (u: string, b: object = {}) => h(http.post(u)).send(b), put: (u: string, b: object) => h(http.put(u)).send(b) };
  };
  async function activate(identifier: string, userId: string) {
    const c = (await as(dev).post(`/api/v1/users/${userId}/credentials`)).body.data;
    const t = (await login(identifier, c.temporaryPassword)).body.data.accessToken;
    await as(t).post('/api/v1/auth/change-password', { currentPassword: c.temporaryPassword, newPassword: 'NewPass@123' });
    return (await login(identifier, 'NewPass@123')).body.data.accessToken as string;
  }
  const proxy = (userId: string, t = dev) => as(t).post('/api/v1/auth/proxy', { userId });
  const cookie = (r: any, name: string) => (r.headers['set-cookie'] as string[] | undefined)?.find((c) => c.startsWith(`${name}=`));

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp(); await app.init(); http = request(app.getHttpServer());
    dev = (await login(DEV.email, DEV.password)).body.data.accessToken;
    for (const m of ['attendance']) await as(dev).put(`/api/v1/developer/feature-flags/${m}`, { enabled: true });
    for (const c of (await as(dev).get('/api/v1/classes')).body.data) { cls[c.name] = c.id; for (const s of c.sections) sec[`${c.name}${s.name}`] = s.id; }
    const staff = (name: string, mobile: string, code: string, roleKeys: string[]) => as(dev).post('/api/v1/staff', { name, email: `${code.toLowerCase()}@test.local`, mobile, employeeCode: code, roleKeys }).then((r) => r.body.data);
    S.teacher = await staff('Lakshmi Devi', '9770100001', 'T-1', ['teacher', 'class_teacher']);
    S.driver = await staff('Raju Driver', '9770100002', 'D-1', ['driver']);
    S.other = await staff('Other Teacher', '9770100003', 'T-2', ['teacher']);
    teacher = await activate('9770100001', S.teacher.user_id);
    await as(dev).put(`/api/v1/sections/${sec['Class 3A']}/class-teacher`, { staffId: S.teacher.public_id });
    K.a = (await as(dev).post('/api/v1/students', { firstName: 'Asha', classId: cls['Class 3'], sectionId: sec['Class 3A'], family: { familyName: 'Asha family', fatherName: 'Ravi', mobile: '9770200001' } })).body.data;
    await as(dev).post(`/api/v1/users/${K.a.family_user_id}/credentials`); // parent login exists (temporary password, never used)
    const users = await db.selectFrom('users').select(['id', 'public_id', 'name']).execute();
    for (const u of users) S[`u:${u.name}`] = u;
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('lists people to log in as, by type and search; developer only', async () => {
    const all = (await as(dev).get('/api/v1/developer/proxy-users')).body.data;
    expect(all.map((x: any) => x.kind).sort()).toEqual(expect.arrayContaining(['Driver', 'Parent', 'Staff']));
    expect(all.find((x: any) => x.name === 'Developer')).toBeUndefined();
    const drivers = (await as(dev).get('/api/v1/developer/proxy-users?type=driver')).body.data;
    expect(drivers.map((x: any) => x.name)).toEqual(['Raju Driver']);
    const parents = (await as(dev).get('/api/v1/developer/proxy-users?type=parent&search=Asha')).body.data;
    expect(parents[0]).toMatchObject({ kind: 'Parent', detail: 'Parent of Asha' });
    expect((await as(teacher).get('/api/v1/developer/proxy-users')).status).toBe(403);
    expect((await as(teacher).post('/api/v1/auth/proxy', { userId: S.other.user_id })).status).toBe(403);
  });

  it('opens the app as a teacher: their screens, their name on actions, the developer in the log', async () => {
    const r = await proxy(S.teacher.user_id);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ name: 'Lakshmi Devi', workspaces: ['staff'] });
    // The developer's own refresh cookie is not touched; the proxy session has its own.
    expect(cookie(r, 'ems_proxy_rt')).toBeDefined();
    expect(cookie(r, 'ems_rt')).toBeUndefined();
    const t = r.body.data.accessToken;
    const me = (await as(t).get('/api/v1/auth/me')).body.data;
    expect(me).toMatchObject({ user: { name: 'Lakshmi Devi', isSuperAdmin: false }, proxy: { by: 'Developer' } });
    expect((await as(t).get('/api/v1/developer/feature-flags')).status).toBe(403); // sees only what she can
    expect((await as(t).get(`/api/v1/students/${K.a.public_id}`)).status).toBe(200);
    // Act as her: mark attendance.
    const today = (await as(t).get('/api/v1/attendance/overview')).body.data.today;
    let day = today; while (!(await as(t).get(`/api/v1/attendance/overview?date=${day}`)).body.data.working) day = new Date(new Date(`${day}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
    expect((await as(t).put(`/api/v1/attendance/sections/${sec['Class 3A']}`, { date: day, entries: [{ studentId: K.a.public_id, status: 'absent' }] })).status).toBe(200);
    const mark = await db.selectFrom('attendance_days').select('marked_by').where('section_id', '=', sec['Class 3A']).executeTakeFirst();
    expect(mark?.marked_by).toBe(S['u:Lakshmi Devi'].id);
    // Log: shown as Lakshmi, done by the developer through Login as.
    const log = (await as(dev).get('/api/v1/developer/activity?proxyOnly=1')).body.data.rows;
    expect(log.find((x: any) => x.module === 'auth' && x.action === 'proxy_start')).toMatchObject({ who: 'Developer', entity: 'Lakshmi Devi' });
    expect(log.some((x: any) => x.who === 'Lakshmi Devi' && x.actingName === 'Developer' && x.module === 'attendance')).toBe(true);
    // Her own last-login is unchanged (the developer is not her signing in).
    expect((await db.selectFrom('users').select('last_login_at').where('id', '=', S['u:Lakshmi Devi'].id).executeTakeFirstOrThrow()).last_login_at).not.toBeNull();
    // Back to my login: the proxy session ends; the developer's own login still works.
    expect((await as(t).post('/api/v1/auth/proxy/end')).status).toBe(200);
    expect((await as(t).get('/api/v1/auth/me')).status).toBe(401);
    expect((await as(dev).get('/api/v1/auth/me')).body.data.user.name).toBe('Developer');
    expect((await as(dev).post('/api/v1/auth/proxy/end')).body.code).toBe('NOT_PROXY');
  });

  it('opens the app as a parent who has never signed in, and as a driver', async () => {
    const p = await proxy(K.a.family_user_id);
    const t = p.body.data.accessToken;
    expect(p.body.data.workspaces).toEqual(['parent']);
    const me = (await as(t).get('/api/v1/auth/me')).body.data;
    expect(me.workspace).toBe('parent');
    // A pending "set your password" does not block the developer from looking around.
    expect((await as(t).get('/api/v1/students')).status).toBe(200);
    expect((await as(t).get('/api/v1/students')).body.data.map((s: any) => s.first_name)).toEqual(['Asha']);
    await as(t).post('/api/v1/auth/proxy/end');
    const d = await proxy(S.driver.user_id);
    expect(d.body.data.name).toBe('Raju Driver');
    await as(d.body.data.accessToken).post('/api/v1/auth/proxy/end');
  });

  it('refuses developers, disabled logins and people with nothing to open', async () => {
    expect((await proxy(S['u:Developer'].public_id)).body.code).toBe('PROXY_NOT_ALLOWED');
    await as(dev).post(`/api/v1/users/${S.other.user_id}/disable`);
    expect((await proxy(S.other.user_id)).body.code).toBe('PROXY_DISABLED');
    // A login-as session cannot start another one.
    const r = await proxy(S.teacher.user_id);
    expect((await as(r.body.data.accessToken).post('/api/v1/auth/proxy', { userId: S.driver.user_id })).status).toBe(403);
  });

  it('refreshes each kind of session only with its own cookie', async () => {
    const r = await proxy(S.teacher.user_id);
    const pc = cookie(r, 'ems_proxy_rt')!.split(';')[0];
    const ok = await http.post('/api/v1/auth/refresh').set('Cookie', pc).set('X-Proxy', '1').send({});
    expect(ok.status).toBe(200);
    const pc2 = cookie(ok, 'ems_proxy_rt')!.split(';')[0];
    // The proxy cookie used as if it were the developer's own login is refused.
    expect((await http.post('/api/v1/auth/refresh').set('Cookie', pc2.replace('ems_proxy_rt', 'ems_rt')).send({})).status).toBe(401);
  });

  it('logs sign-ins, wrong passwords, sign-outs and downloads with India-time filters', async () => {
    await login('9770100001', 'wrong-pass-1');
    const t = (await login('9770100001', 'NewPass@123')).body.data.accessToken;
    await as(t).post('/api/v1/auth/logout');
    await as(dev).get('/api/v1/exports/students.xlsx').buffer(true);
    const sign = (await as(dev).get(`/api/v1/developer/activity?type=signin&userId=${S.teacher.user_id}`)).body.data.rows;
    expect(sign.slice(0, 3).map((x: any) => x.action)).toEqual(['logout', 'login', 'login_failed']);
    expect(sign[2]).toMatchObject({ success: false, reason: 'bad_password', who: 'Lakshmi Devi' });
    const dl = (await as(dev).get('/api/v1/developer/activity?type=download')).body.data.rows;
    expect(dl[0]).toMatchObject({ type: 'download', who: 'Developer', after: { list: 'students', format: 'xlsx' } });
    // Date filters are India dates: nothing tomorrow, everything today.
    const ist = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 5.5 * 3600_000 + 86_400_000).toISOString().slice(0, 10);
    expect((await as(dev).get(`/api/v1/developer/activity?from=${tomorrow}&to=${tomorrow}`)).body.data.rows).toHaveLength(0);
    expect((await as(dev).get(`/api/v1/developer/activity?from=${ist}&to=${ist}`)).body.data.rows.length).toBeGreaterThan(5);
    expect((await as(teacher).get('/api/v1/developer/activity')).status).toBe(403);
    const xl = await as(dev).get('/api/v1/exports/activity.xlsx').buffer(true);
    expect(xl.status).toBe(200);
    expect((await as(teacher).get('/api/v1/exports/activity.xlsx')).status).toBe(403);
  });

  it('pages through the log and removes entries older than 2 years', async () => {
    const p1 = (await as(dev).get('/api/v1/developer/activity?limit=5')).body.data;
    expect(p1.rows).toHaveLength(5);
    const p2 = (await as(dev).get(`/api/v1/developer/activity?limit=5&before=${encodeURIComponent(p1.next)}`)).body.data;
    expect(p2.rows[0].at <= p1.rows[4].at).toBe(true);
    expect(p2.rows.find((r: any) => p1.rows.some((x: any) => x.id === r.id))).toBeUndefined();
    const old = new Date(Date.now() - 731 * 86_400_000);
    await db.insertInto('audit_logs').values({ user_id: null, workspace: 'system', module_key: 'test', action: 'old', created_at: old }).execute();
    await db.insertInto('login_logs').values({ user_id: null, identifier: 'old@test', success: 0, created_at: old }).execute();
    const r = await app.get(ActivityService).purge();
    expect(r).toEqual({ changes: 1, signIns: 1 });
    expect(deviceOf('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36')).toBe('Chrome on Android');
  });
});
