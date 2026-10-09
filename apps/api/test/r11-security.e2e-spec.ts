import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { sign } from 'jsonwebtoken';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';
import { isWeakSecret } from '../src/config';
import { hashPassword } from '../src/auth/passwords';
import { newPublicId } from '../src/common/ids';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };
const SECRET = process.env.JWT_ACCESS_SECRET!;

describe('Security checks (e2e)', () => {
  let app: INestApplication; let db: Database; let http: any; let dev: string;
  const login = (i: string, p: string) => http.post('/api/v1/auth/login').send({ identifier: i, password: p });
  const as = (t: string) => ({ get: (u: string) => http.get(u).set('Authorization', `Bearer ${t}`), patch: (u: string, b: object) => http.patch(u).set('Authorization', `Bearer ${t}`).send(b),
    post: (u: string, b: object = {}) => http.post(u).set('Authorization', `Bearer ${t}`).send(b), put: (u: string, b: object) => http.put(u).set('Authorization', `Bearer ${t}`).send(b) });

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp(); await app.init(); http = request(app.getHttpServer());
    dev = (await login(DEV.email, DEV.password)).body.data.accessToken;
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('treats example or short signing keys as weak', () => {
    for (const v of [undefined, '', 'short', 'change-this-to-a-long-random-string-0123456789', 'paste-a-long-random-string-here', 'generate-a-64-char-random-string']) expect(isWeakSecret(v)).toBe(true);
    expect(isWeakSecret('q8Zr0vT3nX1mK7pL2sW9yB4cD6fH5jG0aE')).toBe(false);
  });

  it('rejects forged, unsigned, wrongly signed and mismatched tokens', async () => {
    const me = await db.selectFrom('users').select('id').where('email', '=', DEV.email).executeTakeFirstOrThrow();
    const sid = (await db.selectFrom('sessions').select('id').where('user_id', '=', me.id).executeTakeFirstOrThrow()).id;
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: me.id, sid })).toString('base64url')}.`;
    expect((await as(unsigned).get('/api/v1/auth/me')).status).toBe(401);
    expect((await as(sign({ sub: me.id, sid }, 'some-other-secret-some-other-secret')).get('/api/v1/auth/me')).status).toBe(401);
    expect((await as(sign({ sub: me.id, sid }, SECRET, { algorithm: 'HS512' })).get('/api/v1/auth/me')).status).toBe(401);
    // A real session id paired with another user's id is refused.
    const other = await db.insertInto('users').values({ public_id: newPublicId(), name: 'Other', email: 'other@test.local', password_hash: await hashPassword('Other@1234'), must_change_password: 0 }).executeTakeFirstOrThrow();
    expect((await as(sign({ sub: Number(other.insertId), sid }, SECRET, { algorithm: 'HS256' })).get('/api/v1/auth/me')).status).toBe(401);
    expect((await as(sign({ sub: me.id, sid }, SECRET, { algorithm: 'HS256', expiresIn: '5m' })).get('/api/v1/auth/me')).status).toBe(200);
    expect((await http.get('/api/v1/students')).status).toBe(401);
  });

  it('makes the developer change a password printed in the guides, on new and existing installs', async () => {
    await seed(db, { institutionName: 'Test School', superAdminEmail: 'second.dev@test.local', superAdminPassword: 'ChangeMe@123' });
    const r = await login('second.dev@test.local', 'ChangeMe@123');
    expect(r.body.data.mustChangePassword).toBe(true);
    expect((await as(r.body.data.accessToken).get('/api/v1/students')).body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    // An older install whose developer still uses the example password.
    await db.insertInto('users').values({ public_id: newPublicId(), name: 'Old dev', email: 'old.dev@test.local', password_hash: await hashPassword('YourPass@123'), must_change_password: 0, is_super_admin: 1 }).execute();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    expect((await login('old.dev@test.local', 'YourPass@123')).body.data.mustChangePassword).toBe(true);
    expect((await login(DEV.email, DEV.password)).body.data.mustChangePassword).toBe(false);
    // Common passwords are refused when choosing a new one.
    const t = r.body.data.accessToken;
    const bad = await as(t).post('/api/v1/auth/change-password', { currentPassword: 'ChangeMe@123', newPassword: 'ChangeMe@123' });
    expect(bad.body.details[0].message).toMatch(/too common/);
    expect((await as(t).post('/api/v1/auth/change-password', { currentPassword: 'ChangeMe@123', newPassword: 'Br1ght-Mango-77' })).status).toBe(200);
  });

  it('sends security headers and no server fingerprint', async () => {
    for (const path of ['/api/v1/public/version', '/robots.txt']) {
      const r = await http.get(path);
      expect(r.headers['x-powered-by']).toBeUndefined();
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['content-security-policy']).toContain("frame-ancestors 'self'");
      expect(r.headers['content-security-policy']).toContain("object-src 'none'");
      expect(r.headers['permissions-policy']).toContain('microphone=()');
      expect(r.headers['referrer-policy']).toBeDefined();
    }
  });

  it('allows the app\'s own address only for cross-site requests', async () => {
    const evil = await http.get('/api/v1/public/version').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const own = await http.get('/api/v1/public/version').set('Origin', 'http://localhost:5173');
    expect(own.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('keeps private files private and the API docs off', async () => {
    const f = await db.insertInto('files').values({ public_id: newPublicId(), disk: 'local', storage_path: 'imports/x', original_name: 'x.xlsx', mime_type: 'application/octet-stream', size_bytes: 1, visibility: 'private', module_key: 'imports', uploaded_by: 1 }).executeTakeFirstOrThrow();
    const row = await db.selectFrom('files').select('public_id').where('id', '=', Number(f.insertId)).executeTakeFirstOrThrow();
    expect((await http.get(`/api/v1/files/${row.public_id}`)).status).toBe(404);
    expect((await http.get('/api/docs')).text).not.toContain('swagger');
    expect((await http.get('/.env')).text).not.toContain('DB_PASSWORD');
  });

  it('refuses script and off-site tricks in website links', async () => {
    const save = (buttonLink: string) => as(dev).patch('/api/v1/cms/home/admissions', { content: { heading: 'Admissions open', text: 'Apply now', buttonLabel: 'Apply', buttonLink } });
    for (const bad of ['javascript:alert(1)', '//evil.example/login', '/\\evil.example', 'data:text/html,<script>alert(1)</script>']) expect((await save(bad)).status).toBe(422);
    for (const good of ['/contact', 'https://forms.example.org/apply']) expect((await save(good)).status).toBe(200);
    const social = await as(dev).put('/api/v1/cms/settings', { social: { facebook: 'javascript:alert(1)' } });
    expect(social.status).toBe(422);
  });

  it('puts names into email subjects as plain text on one line', async () => {
    await db.updateTable('institution_settings').set({ contact_email: 'office@test.local' }).where('id', '=', 1).execute();
    const r = await http.post('/api/v1/public/contact').send({ name: 'Ravi & Sons <b>', mobile: '9876543210', message: 'Please call me about admission.' });
    expect(r.status).toBe(200);
    const m = await db.selectFrom('email_outbox').select(['subject', 'body_html']).where('template_key', '=', 'contact_message').orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect(m.subject).toBe('Website message from Ravi & Sons <b>');
    expect(m.body_html).toContain('Ravi &amp; Sons &lt;b&gt;');
    expect(m.body_html).not.toContain('<b>');
  });

  it('does not leak server details in errors', async () => {
    const r = await as(dev).get('/api/v1/students/not-a-real-id');
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toMatch(/stack|sql|at \w+ \(/i);
  });
});
