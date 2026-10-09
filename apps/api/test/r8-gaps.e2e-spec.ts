import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';
import { addDays } from '../src/attendance/calendar';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };
const binary = (res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

describe('Exports, fee reminder emails, sitemap (e2e)', () => {
  let app: INestApplication; let db: Database; let http: any; let dev: string; let teacher: string; let family: string;
  const cls: Record<string, number> = {}, sec: Record<string, number> = {}; const K: Record<string, any> = {};
  let today: string, day: string;

  const login = (i: string, p: string) => http.post('/api/v1/auth/login').send({ identifier: i, password: p });
  const as = (t: string) => {
    const h = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
    return { get: (u: string) => h(http.get(u)), post: (u: string, b: object = {}) => h(http.post(u)).send(b), put: (u: string, b: object) => h(http.put(u)).send(b),
      file: (u: string) => h(http.get(u)).buffer(true).parse(binary) };
  };
  async function activate(identifier: string, userId: string) {
    const c = (await as(dev).post(`/api/v1/users/${userId}/credentials`)).body.data;
    const t = (await login(identifier, c.temporaryPassword)).body.data.accessToken;
    await as(t).post('/api/v1/auth/change-password', { currentPassword: c.temporaryPassword, newPassword: 'NewPass@123' });
    return (await login(identifier, 'NewPass@123')).body.data.accessToken as string;
  }
  const sheetRows = async (buf: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any); const out: string[][] = []; wb.worksheets[0].eachRow((r) => out.push((r.values as any[]).slice(1).map((v) => String(v ?? '')))); return out; };
  const outbox = () => db.selectFrom('email_outbox').select(['to_email', 'subject', 'body_html']).where('template_key', '=', 'fee_reminder').orderBy('id').execute();

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp(); await app.init(); http = request(app.getHttpServer());
    dev = (await login(DEV.email, DEV.password)).body.data.accessToken;
    for (const m of ['attendance', 'fees', 'payments', 'cms', 'exams', 'marks']) await as(dev).put(`/api/v1/developer/feature-flags/${m}`, { enabled: true });
    for (const c of (await as(dev).get('/api/v1/classes')).body.data) { cls[c.name] = c.id; for (const s of c.sections) sec[`${c.name}${s.name}`] = s.id; }
    const t = await as(dev).post('/api/v1/staff', { name: 'Gap Teacher', email: 'gt@test.local', mobile: '9440100001', employeeCode: 'G-1', roleKeys: ['teacher', 'class_teacher'] });
    teacher = await activate('9440100001', t.body.data.user_id);
    await as(dev).put(`/api/v1/sections/${sec['Class 3A']}/class-teacher`, { staffId: t.body.data.public_id });
    const kid = (n: string, k: string, mobile: string, email?: string) => as(dev).post('/api/v1/students', { firstName: n, classId: cls[k], sectionId: sec[`${k}A`], family: { familyName: `${n} family`, fatherName: `${n} Father`, mobile, email } }).then((r) => r.body.data);
    K.a = await kid('Asha', 'Class 3', '9440200001', 'asha.parent@test.local');
    K.b = await kid('Bala', 'Class 4', '9440200002', 'bala.parent@test.local');
    K.c = await kid('Chandu', 'Class 4', '9440200003');
    family = await activate('9440200001', K.a.family_user_id);
    today = (await as(dev).get('/api/v1/attendance/overview')).body.data.today;
    day = today; while (!(await as(dev).get(`/api/v1/attendance/overview?date=${day}`)).body.data.working) day = addDays(day, -1);
    await as(dev).put(`/api/v1/attendance/sections/${sec['Class 3A']}`, { date: day, entries: [{ studentId: K.a.public_id, status: 'absent' }] });
  });
  afterAll(async () => { await app.close(); await db.destroy(); });

  describe('Exports', () => {
    it('downloads the student list as Excel and as PDF', async () => {
      const x = await as(dev).file('/api/v1/exports/students.xlsx');
      expect(x.headers['content-disposition']).toContain('students.xlsx');
      const rows = await sheetRows(x.body);
      expect(rows[0]).toEqual(['Adm no', 'Student', 'Gender', 'Class', 'Roll', 'Parent', 'Mobile']);
      expect(rows.map((r) => r[1])).toEqual(expect.arrayContaining(['Asha', 'Bala', 'Chandu']));
      expect(rows.find((r) => r[1] === 'Asha')![6]).toBe('9440200001');
      const p = await as(dev).file('/api/v1/exports/students.pdf?classId=' + cls['Class 4']);
      expect(p.body.subarray(0, 4).toString()).toBe('%PDF');
    });

    it("keeps a teacher's scope and hidden fields in exports", async () => {
      // Class teacher: own section only; the export matches what the screen shows.
      const rows = await sheetRows((await as(teacher).file('/api/v1/exports/students.xlsx')).body);
      expect(rows.slice(1).map((r) => r[1])).toEqual(['Asha']);
      const screen = (await as(teacher).get('/api/v1/students')).body.data[0];
      expect(rows[1][6]).toBe(screen.family_mobile === '__hidden__' ? 'Hidden' : screen.family_mobile);
      // A plain subject teacher may not see family mobiles: hidden in the export too.
      const st = await as(dev).post('/api/v1/staff', { name: 'Subject Teacher', email: 'subj@test.local', mobile: '9440100002', employeeCode: 'G-2', roleKeys: ['teacher'] });
      const subj = (await as(dev).post('/api/v1/subjects', { name: 'Gap Science' })).body.data.id;
      await as(dev).post('/api/v1/teacher-assignments', { staffId: st.body.data.public_id, sectionId: sec['Class 3A'], subjectId: subj });
      const subjTeacher = await activate('9440100002', st.body.data.user_id);
      const r2 = await sheetRows((await as(subjTeacher).file('/api/v1/exports/students.xlsx')).body);
      expect(r2[1][1]).toBe('Asha');
      expect(r2[1][6]).toBe('Hidden');
      expect((await as(teacher).get('/api/v1/exports/fee-dues.xlsx')).status).toBe(403);
      expect((await as(teacher).get('/api/v1/exports/staff.pdf')).status).toBe(403);
    });

    it('exports attendance, absentees, dues and collection; families cannot export', async () => {
      const m = await sheetRows((await as(dev).file(`/api/v1/exports/attendance-month.xlsx?sectionId=${sec['Class 3A']}&month=${day.slice(0, 7)}`)).body);
      expect(m[1]).toContain('A');
      const ab = await sheetRows((await as(dev).file(`/api/v1/exports/absentees.xlsx?date=${day}`)).body);
      expect(ab[1]).toEqual(['Class 3 A', 'Asha', 'Asha Father', '9440200001']);
      await as(dev).put('/api/v1/fees/setup/default-plan', { planKey: 'yearly' });
      await as(dev).put('/api/v1/fees/setup/class-fees', { items: [{ classId: cls['Class 3'], amount: 20000 }, { classId: cls['Class 4'], amount: 22000 }] });
      for (const k of ['a', 'b', 'c']) await as(dev).get(`/api/v1/students/${K[k].public_id}/fees`);
      const dues = await sheetRows((await as(dev).file('/api/v1/exports/fee-dues.xlsx')).body);
      expect(dues[dues.length - 1]).toContain('Total');
      expect(dues[dues.length - 1]).toContain('64000');
      expect((await as(dev).file(`/api/v1/exports/fee-collection.pdf?from=${today}&to=${today}`)).body.subarray(0, 4).toString()).toBe('%PDF');
      expect((await as(family).get('/api/v1/exports/students.xlsx')).status).toBe(403);
      expect((await as(dev).get('/api/v1/exports/nothing.xlsx')).status).toBe(404);
      expect((await as(dev).get('/api/v1/exports/students.docx')).status).toBe(404);
      expect((await as(dev).get('/api/v1/exports/attendance-month.xlsx?sectionId=x')).body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('Fee reminder emails', () => {
    beforeAll(async () => {
      // Tuition due in 3 days; Class 4 also has a one-time fee that is already overdue.
      await as(dev).put('/api/v1/fees/setup/installments', { planKey: 'yearly', items: [{ installmentNo: 1, label: 'Annual', dueDate: addDays(today, 3) }] });
      const type = (await as(dev).post('/api/v1/fees/one-time-types', { name: 'Exam fee' })).body.data.id;
      await as(dev).post('/api/v1/fees/one-time', { classId: cls['Class 4'], typeId: type, title: 'SA1 exam fee', amount: 500, dueDate: addDays(today, -2) });
      for (const k of ['a', 'b', 'c']) await as(dev).get(`/api/v1/students/${K[k].public_id}/fees`);
    });

    it('is off until switched on, and only the configurer can change it', async () => {
      expect((await as(dev).get('/api/v1/fees/reminders')).body.data).toMatchObject({ enabled: false, daysBefore: 3, overdueEveryDays: 7, studentsWithDuesWithoutEmail: 1, emailConfigured: false });
      expect((await as(teacher).put('/api/v1/fees/reminders', { enabled: true, daysBefore: 3, overdueEveryDays: 7 })).status).toBe(403);
      expect((await as(dev).put('/api/v1/fees/reminders', { enabled: true, daysBefore: 3, overdueEveryDays: 7 })).body.data.enabled).toBe(true);
    });

    it('emails each family once: upcoming dues and overdue fees; skips families without email', async () => {
      const r = (await as(dev).post('/api/v1/fees/reminders/run')).body.data;
      expect(r).toEqual({ emails: 2, noEmail: 1, appAlerts: 1 });
      const mails = await outbox();
      expect(mails.map((m) => m.to_email).sort()).toEqual(['asha.parent@test.local', 'bala.parent@test.local']);
      const bala = mails.find((m) => m.to_email.startsWith('bala'))!;
      expect(bala.subject).toBe('Fee reminder: Bala (Test School)');
      expect(bala.body_html).toContain('SA1 exam fee');
      expect(bala.body_html).toContain('Annual');
      // Nothing is repeated the same day; the family without email is still reported to the office.
      expect((await as(dev).post('/api/v1/fees/reminders/run')).body.data).toEqual({ emails: 0, noEmail: 1, appAlerts: 0 });
      expect(await outbox()).toHaveLength(2);
    });

    it('sends one reminder now from the dues list', async () => {
      expect((await as(dev).post(`/api/v1/students/${K.c.public_id}/fee-reminder`)).body.code).toBe('NO_EMAIL');
      const r = await as(dev).post(`/api/v1/students/${K.a.public_id}/fee-reminder`);
      expect(r.body.data).toEqual({ sentTo: 'asha.parent@test.local', appAlert: true, amount: 20000 });
      expect((await as(teacher).post(`/api/v1/students/${K.a.public_id}/fee-reminder`)).status).toBe(403);
    });
  });

  describe('Search engines', () => {
    it('lists the public pages and events, and keeps /app and /api out', async () => {
      await as(dev).post('/api/v1/cms/events', { title: 'Sports Day', eventDate: addDays(today, 10) });
      const robots = await http.get('/robots.txt');
      expect(robots.text).toContain('Disallow: /app');
      expect(robots.text).toMatch(/Sitemap: http:\/\/.+\/sitemap\.xml/);
      const map = await http.get('/sitemap.xml');
      expect(map.headers['content-type']).toContain('xml');
      expect(map.text).toContain('/about</loc>');
      expect(map.text).toContain('/privacy</loc>');
      expect(map.text).toMatch(/\/events\/sports-day-\d{4}<\/loc>/);
      expect(map.text).not.toContain('/app');
      await as(dev).put('/api/v1/developer/feature-flags/cms', { enabled: false });
      expect((await http.get('/robots.txt')).text).toBe('User-agent: *\nDisallow: /\n');
      expect((await http.get('/sitemap.xml')).text).not.toContain('<url>');
      await as(dev).put('/api/v1/developer/feature-flags/cms', { enabled: true });
    });
  });
});
