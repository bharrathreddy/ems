import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';
import { PushService } from '../src/push/push.service';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };
// Smallest valid JPEG/PNG/PDF headers are enough for the type checks.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

describe('Homework, enquiries, photos, field rules, two-step login, phone notifications (e2e)', () => {
  let app: INestApplication; let db: Database; let http: any; let dev: string;
  const T: Record<string, string> = {}; const S: Record<string, any> = {}; const K: Record<string, any> = {};
  const cls: Record<string, number> = {}, sec: Record<string, number> = {};
  const login = (i: string, p: string) => http.post('/api/v1/auth/login').send({ identifier: i, password: p });
  const as = (t: string) => {
    const h = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
    return { get: (u: string) => h(http.get(u)), post: (u: string, b: object = {}) => h(http.post(u)).send(b), put: (u: string, b: object) => h(http.put(u)).send(b),
      patch: (u: string, b: object) => h(http.patch(u)).send(b), del: (u: string) => h(http.delete(u)),
      form: (u: string, fields: Record<string, string>, file?: [Buffer, string, string]) => { let r = h(http.post(u)); for (const [k, v] of Object.entries(fields)) r = r.field(k, v); return file ? r.attach('file', file[0], { filename: file[1], contentType: file[2] }) : r; } };
  };
  async function activate(identifier: string, userId: string) {
    const c = (await as(dev).post(`/api/v1/users/${userId}/credentials`)).body.data;
    const t = (await login(identifier, c.temporaryPassword)).body.data.accessToken;
    await as(t).post('/api/v1/auth/change-password', { currentPassword: c.temporaryPassword, newPassword: 'NewPass@123' });
    return (await login(identifier, 'NewPass@123')).body.data.accessToken as string;
  }
  const staff = async (key: string, n: number, roleKeys: string[]) => {
    S[key] = (await as(dev).post('/api/v1/staff', { name: `HW ${key}`, email: `hw${n}@test.local`, mobile: `93300000${String(n).padStart(2, '0')}`, employeeCode: `HW-${n}`, roleKeys })).body.data;
    T[key] = await activate(S[key].mobile, S[key].user_id);
  };
  const lastCode = async (to: string) => {
    const m = await db.selectFrom('email_outbox').select(['body_html', 'subject']).where('to_email', '=', to).where('template_key', '=', 'login_code').orderBy('id', 'desc').executeTakeFirstOrThrow();
    return /letter-spacing:6px[^>]*>(\d{6})</.exec(m.body_html)![1];
  };

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp(); await app.init(); http = request(app.getHttpServer());
    dev = (await login(DEV.email, DEV.password)).body.data.accessToken;
    for (const m of ['homework', 'cms']) await as(dev).put(`/api/v1/developer/feature-flags/${m}`, { enabled: true });
    for (const c of (await as(dev).get('/api/v1/classes')).body.data) { cls[c.name] = c.id; for (const s of c.sections) sec[`${c.name}${s.name}`] = s.id; }
    await staff('ct', 1, ['teacher', 'class_teacher']);   // class teacher of Class 5 A
    await staff('maths', 2, ['teacher']);                // teaches maths in Class 5 A
    await staff('other', 3, ['teacher']);                // teaches only in Class 6 A
    await staff('admin', 4, ['institution_admin']);
    await staff('acc', 5, ['accountant']);
    await as(dev).put(`/api/v1/sections/${sec['Class 5A']}/class-teacher`, { staffId: S.ct.public_id });
    K.maths = (await as(dev).post('/api/v1/subjects', { name: 'HW Maths' })).body.data.id;
    K.sci = (await as(dev).post('/api/v1/subjects', { name: 'HW Science' })).body.data.id;
    await as(dev).post('/api/v1/teacher-assignments', { staffId: S.maths.public_id, sectionId: sec['Class 5A'], subjectId: K.maths });
    await as(dev).post('/api/v1/teacher-assignments', { staffId: S.other.public_id, sectionId: sec['Class 6A'], subjectId: K.sci });
    const kid = async (name: string, klass: string, mobile: string) => {
      const s = (await as(dev).post('/api/v1/students', { firstName: name, classId: cls[klass], sectionId: sec[`${klass}A`], family: { familyName: `${name} family`, mobile, address: '1 Main Road' } })).body.data;
      T[name] = await activate(mobile, s.family_user_id);
      return s;
    };
    K.asha = await kid('Asha', 'Class 5', '9330001001');
    K.deepa = await kid('Deepa', 'Class 6', '9330001002');
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  describe('Homework and class diary', () => {
    it('lets any teacher of the section post, with subjects they teach first; others cannot', async () => {
      const o = (await as(T.maths).get('/api/v1/homework/options')).body.data;
      expect(o.sections.map((s: any) => s.label)).toEqual(['Class 5 A']);
      expect(o.sections[0].subjects[0]).toMatchObject({ id: K.maths, mine: true });
      expect((await as(T.ct).get('/api/v1/homework/options')).body.data.sections[0]).toMatchObject({ label: 'Class 5 A', classTeacher: true });
      const r = await as(T.maths).form('/api/v1/homework', { sectionId: String(sec['Class 5A']), subjectId: String(K.maths), type: 'homework', title: 'Page 42, sums 1-10', dueDate: '2099-01-01' }, [PNG, 'board.png', 'image/png']);
      expect(r.status).toBe(201);
      K.hw = r.body.data;
      expect(K.hw).toMatchObject({ className: 'Class 5 A', subject: 'HW Maths', type: 'homework', canChange: true, file: { name: 'board.png', mime: 'image/png' } });
      // A teacher of another section, and the accountant, cannot post here.
      expect((await as(T.other).form('/api/v1/homework', { sectionId: String(sec['Class 5A']), type: 'diary', title: 'Bring crayons' })).body.code).toBe('NOT_YOUR_SECTION');
      expect((await as(T.acc).form('/api/v1/homework', { sectionId: String(sec['Class 5A']), type: 'diary', title: 'Bring crayons' })).status).toBe(403);
      // Class diary without a subject, by the class teacher; and a bad attachment is refused.
      expect((await as(T.ct).form('/api/v1/homework', { sectionId: String(sec['Class 5A']), type: 'diary', title: 'Sports day on Friday, wear white' })).status).toBe(201);
      expect((await as(T.ct).form('/api/v1/homework', { sectionId: String(sec['Class 5A']), type: 'diary', title: 'Bad file' }, [Buffer.from('MZ not a picture'), 'x.exe', 'image/png'])).body.code).toBe('BAD_FILE');
      expect((await as(T.ct).form('/api/v1/homework', { sectionId: String(sec['Class 5A']), type: 'homework', title: 'Wrong subject', subjectId: String(K.sci) })).body.details[0].field).toBe('subjectId');
    });

    it('shows parents their child\'s homework with an alert, and the attachment only to them', async () => {
      const n = (await as(T.Asha).get('/api/v1/notifications')).body.data;
      expect(n.map((x: any) => x.title)).toEqual(expect.arrayContaining(['Homework · HW Maths: Asha', 'Class diary: Asha']));
      const list = (await as(T.Asha).get(`/api/v1/students/${K.asha.public_id}/homework`)).body.data.rows;
      expect(list.map((x: any) => x.title)).toEqual(['Sports day on Friday, wear white', 'Page 42, sums 1-10']);
      expect(list[1].canChange).toBe(false);
      expect((await as(T.Asha).get(`/api/v1/homework/${K.hw.id}/file`)).headers['content-type']).toBe('image/png');
      expect((await as(T.Deepa).get(`/api/v1/homework/${K.hw.id}/file`)).status).toBe(404);
      expect((await as(T.Deepa).get(`/api/v1/students/${K.deepa.public_id}/homework`)).body.data.rows).toEqual([]);
      expect((await as(T.Deepa).get(`/api/v1/students/${K.asha.public_id}/homework`)).status).toBe(404);
      expect((await as(T.other).get(`/api/v1/homework/${K.hw.id}/file`)).status).toBe(404);
    });

    it('lets the poster or the class teacher change or delete it; not another subject teacher', async () => {
      const diary = (await as(T.ct).get('/api/v1/homework')).body.data.rows.find((r: any) => r.type === 'diary');
      expect((await as(T.maths).get('/api/v1/homework')).body.data.rows.find((r: any) => r.id === diary.id).canChange).toBe(false);
      expect((await as(T.maths).patch(`/api/v1/homework/${diary.id}`, { title: 'Changed' })).body.code).toBe('NOT_YOURS');
      expect((await as(T.ct).patch(`/api/v1/homework/${K.hw.id}`, { title: 'Page 42, sums 1-12' })).body.data.title).toBe('Page 42, sums 1-12');
      expect((await as(T.ct).patch(`/api/v1/homework/${K.hw.id}`, { dueDate: '2000-01-01' })).body.details[0].field).toBe('dueDate');
      expect((await as(T.maths).del(`/api/v1/homework/${diary.id}`)).body.code).toBe('NOT_YOURS');
      expect((await as(T.ct).del(`/api/v1/homework/${diary.id}`)).status).toBe(200);
      expect((await as(T.Asha).get(`/api/v1/students/${K.asha.public_id}/homework`)).body.data.rows).toHaveLength(1);
    });
  });

  describe('Student photo', () => {
    it('can be uploaded by any teacher of the class, not by others', async () => {
      expect((await as(T.maths).form(`/api/v1/students/${K.asha.public_id}/photo`, {}, [PNG, 'p.png', 'image/png'])).status).toBe(201);
      expect((await as(T.ct).form(`/api/v1/students/${K.asha.public_id}/photo`, {}, [PNG, 'p.png', 'image/png'])).status).toBe(201);
      expect((await as(T.other).form(`/api/v1/students/${K.asha.public_id}/photo`, {}, [PNG, 'p.png', 'image/png'])).status).toBe(404);
      expect((await as(T.acc).form(`/api/v1/students/${K.asha.public_id}/photo`, {}, [PNG, 'p.png', 'image/png'])).status).toBe(403);
      expect((await as(T.Asha).form(`/api/v1/students/${K.asha.public_id}/photo`, {}, [PNG, 'p.png', 'image/png'])).status).toBe(403);
      const cp = (await as(T.maths).get('/api/v1/student-photos')).body.data;
      expect(cp.sections.map((x: any) => x.label)).toEqual(['Class 5 A']);
      expect(cp.students).toEqual([{ id: K.asha.public_id, name: 'Asha', rollNo: null, hasPhoto: true }]);
      expect((await as(T.other).get(`/api/v1/student-photos?sectionId=${sec['Class 5A']}`)).body.data).toMatchObject({ sectionId: null, students: [] });
      expect((await as(T.acc).get('/api/v1/student-photos')).status).toBe(403);
      const log = (await as(dev).get('/api/v1/developer/activity?module=students')).body.data.rows;
      expect(log.find((r: any) => r.action === 'photo')).toBeTruthy();
    });
  });

  describe('Field rules', () => {
    it('lets the developer show or hide parents\' phone and addresses per role, kept after a restart', async () => {
      const o = (await as(dev).get('/api/v1/developer/access')).body.data;
      expect(o.fieldRules.map((f: any) => f.key)).toEqual(['family.mobile', 'family.address', 'address']);
      const teacher = o.roles.find((r: any) => r.key === 'teacher');
      expect(teacher.fields).toEqual({ 'family.mobile': 'hidden', 'family.address': 'hidden', address: 'hidden' });
      const one = async () => (await as(T.maths).get(`/api/v1/students/${K.asha.public_id}`)).body.data;
      expect((await one()).family_mobile).not.toBe('9330001001');
      // The class teacher role shows phone numbers; the maths teacher only has the teacher role.
      const r = await as(dev).put(`/api/v1/developer/access/roles/${teacher.id}/fields`, { fields: { 'family.mobile': 'view' } });
      expect(r.body.data.roles.find((x: any) => x.key === 'teacher').fields['family.mobile']).toBe('view');
      expect((await one()).family_mobile).toBe('9330001001');
      expect((await one()).family_address).not.toBe('1 Main Road');
      await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
      expect((await one()).family_mobile).toBe('9330001001');
      expect((await as(dev).put(`/api/v1/developer/access/roles/${teacher.id}/fields`, { fields: { fees: 'view' } })).status).toBe(422);
      const parent = o.roles.find((x: any) => x.key === 'parent');
      expect((await as(dev).put(`/api/v1/developer/access/roles/${parent.id}/fields`, { fields: { address: 'hidden' } })).body.code).toBe('STAFF_ONLY');
      expect((await as(T.admin).put(`/api/v1/developer/access/roles/${teacher.id}/fields`, { fields: { address: 'view' } })).status).toBe(403);
    });
  });

  describe('Admission enquiries', () => {
    it('keeps every website message as an enquiry, alerts the admin, and follows it up with notes', async () => {
      await http.post('/api/v1/public/contact').send({ name: 'Ravi Kumar', mobile: '98765 43210', message: 'Is admission open for Class 3 next year?' });
      const n = (await as(T.admin).get('/api/v1/notifications')).body.data;
      expect(n[0]).toMatchObject({ title: 'New enquiry: Ravi Kumar', link_path: '/enquiries' });
      const l = (await as(T.admin).get('/api/v1/enquiries')).body.data;
      expect(l).toMatchObject({ unseen: 1, counts: { new: 1, contacted: 0 } });
      const id = l.rows[0].id;
      expect((await as(T.admin).get(`/api/v1/enquiries/${id}`)).body.data).toMatchObject({ name: 'Ravi Kumar', mobile: '9876543210', status: 'new' });
      expect((await as(T.admin).get('/api/v1/enquiries')).body.data.unseen).toBe(0);
      const u = await as(T.admin).patch(`/api/v1/enquiries/${id}`, { status: 'visit', followUpOn: '2099-03-01', note: 'Called; visiting Saturday with the child.' });
      expect(u.body.data).toMatchObject({ status: 'visit', followUpOn: '2099-03-01', notes: [{ note: 'Called; visiting Saturday with the child.', statusTo: 'visit', by: 'HW admin' }] });
      expect((await as(T.admin).get('/api/v1/enquiries?status=open')).body.data.rows).toHaveLength(1);
      expect((await as(T.admin).get('/api/v1/enquiries?q=ravi')).body.data.rows).toHaveLength(1);
      expect((await as(dev).get('/api/v1/enquiries')).status).toBe(200);
      for (const t of [T.ct, T.acc, T.Asha]) expect((await as(t).get('/api/v1/enquiries')).status).toBe(403);
      expect((await as(T.admin).patch(`/api/v1/enquiries/${id}`, {})).status).toBe(422);
    });
  });

  describe('Phone notifications', () => {
    const sent: Array<{ endpoint: string; payload: any }> = [];
    const EP = (n: number) => `https://fcm.googleapis.com/fcm/send/test-device-${n}`;
    const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
    beforeAll(() => { app.get(PushService).sender = async (sub, payload) => { sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }); }; });

    it('registers a phone with every group on, and sends tagged alerts to it', async () => {
      const k = (await as(T.Asha).get('/api/v1/push/key')).body.data;
      expect(k.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
      expect(k.groups).toEqual(['absence', 'notices', 'results']);
      expect((await as(T.ct).get('/api/v1/push/key')).body.data.groups).toEqual(['absence', 'notices', 'approvals']);
      expect((await as(T.Asha).post('/api/v1/push/subscribe', { endpoint: 'https://192.168.1.5/x', keys })).status).toBe(422);
      const s = await as(T.Asha).post('/api/v1/push/subscribe', { endpoint: EP(1), keys, device: 'Android phone' });
      expect(s.body.data).toMatchObject({ subscribed: true, prefs: { absence: true, notices: true, results: true }, devices: 1 });
      await as(T.ct).form('/api/v1/homework', { sectionId: String(sec['Class 5A']), type: 'diary', title: 'Library books due' });
      expect(await app.get(PushService).deliver()).toEqual({ sent: 1 });
      expect(sent[0]).toMatchObject({ endpoint: EP(1), payload: { title: 'Class diary: Asha', body: 'Library books due', url: `/app/students/${K.asha.public_id}?tab=homework` } });
      expect(await app.get(PushService).deliver()).toEqual({ sent: 0 }); // never twice
    });

    it('keeps each phone\'s own on/off choices and stops when switched off', async () => {
      await as(T.Asha).post('/api/v1/push/subscribe', { endpoint: EP(2), keys });
      const p = await as(T.Asha).patch('/api/v1/push/device', { endpoint: EP(1), notices: false });
      expect(p.body.data.prefs).toEqual({ absence: true, notices: false, results: true });
      expect((await as(T.Asha).post('/api/v1/push/device', { endpoint: EP(2) })).body.data.prefs.notices).toBe(true);
      sent.length = 0;
      await as(T.ct).form('/api/v1/homework', { sectionId: String(sec['Class 5A']), type: 'diary', title: 'PTM on Saturday' });
      await app.get(PushService).deliver();
      expect(sent.map((x) => x.endpoint)).toEqual([EP(2)]);
      // Someone else cannot change this phone's settings.
      expect((await as(T.Deepa).patch('/api/v1/push/device', { endpoint: EP(1), notices: true })).status).toBe(404);
      await as(T.Asha).post('/api/v1/push/unsubscribe', { endpoint: EP(2) });
      sent.length = 0;
      await as(T.ct).form('/api/v1/homework', { sectionId: String(sec['Class 5A']), type: 'diary', title: 'Holiday on Monday' });
      await app.get(PushService).deliver();
      expect(sent).toEqual([]);
    });

    it('drops phones the push service says are gone', async () => {
      app.get(PushService).sender = async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); };
      await as(T.Asha).patch('/api/v1/push/device', { endpoint: EP(1), notices: true });
      await as(T.ct).form('/api/v1/homework', { sectionId: String(sec['Class 5A']), type: 'diary', title: 'Bring an umbrella' });
      await app.get(PushService).deliver();
      expect((await as(T.Asha).post('/api/v1/push/device', { endpoint: EP(1) })).body.data.subscribed).toBe(false);
    });
  });

  describe('Two-step login', () => {
    it('cannot be switched on before a test code arrives by email', async () => {
      let s = (await as(dev).get('/api/v1/developer/two-step')).body.data;
      expect(s).toMatchObject({ enabled: false, emailConfigured: false });
      expect(s.covered.map((c: any) => c.name)).toEqual(expect.arrayContaining(['HW admin']));
      expect((await as(dev).post('/api/v1/developer/two-step/test')).body.code).toBe('EMAIL_NOT_SET_UP');
      expect((await as(dev).post('/api/v1/developer/two-step/enable', { code: '123456' })).body.code).toBe('TEST_FIRST');
      await db.updateTable('institution_settings').set({ smtp_config: JSON.stringify({ host: '127.0.0.1', port: 1, secure: false, fromName: 'T', fromEmail: 't@test.local' }) }).where('id', '=', 1).execute();
      expect((await as(dev).post('/api/v1/developer/two-step/test')).body.data.sentTo).toBe('d••@test.local');
      expect((await as(dev).post('/api/v1/developer/two-step/enable', { code: '000000' === (await lastCode(DEV.email)) ? '111111' : '000000' })).status).toBe(422);
      s = (await as(dev).post('/api/v1/developer/two-step/enable', { code: await lastCode(DEV.email) })).body.data;
      expect(s.enabled).toBe(true);
      expect((await as(T.admin).get('/api/v1/developer/two-step')).status).toBe(403);
    });

    it('asks the developer and Institution Admin for the emailed code; others sign in as before', async () => {
      const r = await login('hw4@test.local', 'NewPass@123');
      expect(r.body.data).toMatchObject({ twoStep: true, sentTo: 'h••@test.local' });
      expect(r.body.data.accessToken).toBeUndefined();
      expect(r.headers['set-cookie']).toBeUndefined();
      const code = await lastCode('hw4@test.local');
      const bad = await http.post('/api/v1/auth/login/verify').send({ challengeId: r.body.data.challengeId, code: code === '000000' ? '111111' : '000000' });
      expect(bad.body.details[0].message).toContain('4 tries left');
      const ok = await http.post('/api/v1/auth/login/verify').send({ challengeId: r.body.data.challengeId, code });
      expect(ok.body.data.accessToken).toBeTruthy();
      expect((await as(ok.body.data.accessToken).get('/api/v1/auth/me')).status).toBe(200);
      // Each code works once.
      expect((await http.post('/api/v1/auth/login/verify').send({ challengeId: r.body.data.challengeId, code })).body.code).toBe('CODE_EXPIRED');
      // Five wrong codes and it stops working.
      const r2 = (await login('hw4@test.local', 'NewPass@123')).body.data;
      const c2 = await lastCode('hw4@test.local');
      const wrong = c2 === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) await http.post('/api/v1/auth/login/verify').send({ challengeId: r2.challengeId, code: wrong });
      expect((await http.post('/api/v1/auth/login/verify').send({ challengeId: r2.challengeId, code: c2 })).body.code).toBe('CODE_EXPIRED');
      // A teacher is not asked.
      expect((await login('9330000001', 'NewPass@123')).body.data.accessToken).toBeTruthy();
      // The developer is asked too.
      expect((await login(DEV.email, DEV.password)).body.data.twoStep).toBe(true);
    });

    it('can be switched off again', async () => {
      expect((await as(dev).post('/api/v1/developer/two-step/disable')).body.data.enabled).toBe(false);
      expect((await login('hw4@test.local', 'NewPass@123')).body.data.accessToken).toBeTruthy();
    });
  });
});
