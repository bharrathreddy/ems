import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };
const binary = (res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

describe('Hall tickets (e2e)', () => {
  let app: INestApplication; let db: Database; let http: any; let dev: string;
  const T: Record<string, string> = {}; const S: Record<string, any> = {}; const cls: Record<string, number> = {}, sec: Record<string, number> = {}, sub: Record<string, number> = {}, exam: Record<string, number> = {};
  const login = (i: string, p: string) => http.post('/api/v1/auth/login').send({ identifier: i, password: p });
  const as = (t: string) => {
    const h = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
    return { get: (u: string) => h(http.get(u)), put: (u: string, b: object) => h(http.put(u)).send(b), post: (u: string, b: object = {}) => h(http.post(u)).send(b), pdf: (u: string) => h(http.get(u)).buffer(true).parse(binary) };
  };
  async function activate(identifier: string, userId: string) {
    const c = (await as(dev).post(`/api/v1/users/${userId}/credentials`)).body.data;
    const t = (await login(identifier, c.temporaryPassword)).body.data.accessToken;
    await as(t).post('/api/v1/auth/change-password', { currentPassword: c.temporaryPassword, newPassword: 'NewPass@123' });
    return (await login(identifier, 'NewPass@123')).body.data.accessToken as string;
  }
  const staff = async (key: string, n: number, roleKeys: string[]) => {
    S[key] = (await as(dev).post('/api/v1/staff', { name: `HT ${key}`, email: `ht${n}@test.local`, mobile: `93400000${String(n).padStart(2, '0')}`, employeeCode: `HT-${n}`, roleKeys })).body.data;
    T[key] = await activate(S[key].mobile, S[key].user_id);
  };

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp(); await app.init(); http = request(app.getHttpServer());
    dev = (await login(DEV.email, DEV.password)).body.data.accessToken;
    for (const m of ['exams', 'marks']) await as(dev).put(`/api/v1/developer/feature-flags/${m}`, { enabled: true });
    for (const c of (await as(dev).get('/api/v1/classes')).body.data) { cls[c.name] = c.id; for (const s of c.sections) sec[`${c.name}${s.name}`] = s.id; }
    for (const n of ['Telugu', 'Maths', 'Science']) sub[n] = (await as(dev).post('/api/v1/subjects', { name: n })).body.data.id;
    await staff('maths', 1, ['teacher']); await staff('other', 2, ['teacher']); await staff('principal', 3, ['principal']); await staff('acc', 4, ['accountant']);
    await as(dev).put('/api/v1/teaching/grid', {
      classSubjects: [{ classId: cls['Class 6'], subjectIds: [sub.Telugu, sub.Maths, sub.Science] }, { classId: cls['Class 7'], subjectIds: [sub.Maths] }],
      classTeachers: [], assignments: [{ sectionId: sec['Class 6A'], subjectId: sub.Maths, staffId: S.maths.public_id }, { sectionId: sec['Class 7A'], subjectId: sub.Maths, staffId: S.other.public_id }],
    });
    const kid = (name: string, k: string, mobile: string) => as(dev).post('/api/v1/students', { firstName: name, classId: cls[k], sectionId: sec[`${k}A`], family: { familyName: `${name} fam`, fatherName: `${name} Father`, mobile } }).then((r) => r.body.data);
    S.a = await kid('Asha', 'Class 6', '9340100001'); S.b = await kid('Bala', 'Class 6', '9340100002'); S.c = await kid('Chitra', 'Class 6', '9340100003');
    S.d = await kid('Deepa', 'Class 7', '9340100004');
    T.Asha = await activate('9340100001', S.a.family_user_id); T.Deepa = await activate('9340100004', S.d.family_user_id);
    for (const e of (await as(dev).get('/api/v1/exams/setup')).body.data.exams) exam[e.code] = e.id;
    await as(dev).put(`/api/v1/exams/${exam.SA1}/schedule`, { classId: cls['Class 6'], rows: [
      { subjectId: sub.Science, date: '2099-03-04', start: '09:30', end: '12:15' }, { subjectId: sub.Telugu, date: '2099-03-02', start: '09:30', end: '12:15' }, { subjectId: sub.Maths, date: '2099-03-03', start: '14:00', end: '16:45' }] });
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('lists exams with a timetable and the sections each person may print', async () => {
    const o = (await as(T.principal).get('/api/v1/hall-tickets/options')).body.data;
    expect(o.exams.map((e: any) => e.code)).toEqual(['SA1']);
    expect(o.exams[0]).toMatchObject({ first: '2099-03-02', last: '2099-03-04', customNote: false, classIds: [cls['Class 6']] });
    expect(o.sections.length).toBeGreaterThan(5);
    expect(o.canEditNote).toBe(false);
    expect((await as(T.maths).get('/api/v1/hall-tickets/options')).body.data.sections.map((s: any) => s.label)).toEqual(['Class 6 A']);
    expect((await as(T.acc).get('/api/v1/hall-tickets/options')).status).toBe(403);
    expect((await as(T.Asha).get('/api/v1/hall-tickets/options')).status).toBe(403);
  });

  it('checks the section before printing: timetable in order, missing photos and roll numbers', async () => {
    const c = (await as(T.maths).get(`/api/v1/hall-tickets/check?examId=${exam.SA1}&sectionId=${sec['Class 6A']}`)).body.data;
    expect(c.papers.map((p: any) => `${p.date} ${p.subject} ${p.start}`)).toEqual(['2099-03-02 Telugu 09:30', '2099-03-03 Maths 14:00', '2099-03-04 Science 09:30']);
    expect(c).toMatchObject({ students: 3, noPhoto: ['Asha', 'Bala', 'Chitra'] });
    expect((await as(T.maths).get(`/api/v1/hall-tickets/check?examId=${exam.SA1}&sectionId=${sec['Class 7A']}`)).body.code).toBe('NOT_YOUR_SECTION');
  });

  it('prints two hall tickets per A4 page for a section; teachers only for their sections', async () => {
    const r = await as(T.maths).pdf(`/api/v1/hall-tickets/section.pdf?examId=${exam.SA1}&sectionId=${sec['Class 6A']}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(pages(r.body)).toBe(2); // 3 students, 2 per page
    expect((await as(T.other).get(`/api/v1/hall-tickets/section.pdf?examId=${exam.SA1}&sectionId=${sec['Class 6A']}`)).body.code).toBe('NOT_YOUR_SECTION');
    // Class 7 has no SA1 timetable yet.
    expect((await as(T.other).get(`/api/v1/hall-tickets/section.pdf?examId=${exam.SA1}&sectionId=${sec['Class 7A']}`)).body.code).toBe('NO_TIMETABLE');
    expect(pages((await as(T.principal).pdf(`/api/v1/hall-tickets/section.pdf?examId=${exam.SA1}&sectionId=${sec['Class 6A']}`)).body)).toBe(2);
    const log = (await as(dev).get('/api/v1/developer/activity?module=exams')).body.data.rows;
    expect(log.find((x: any) => x.action === 'hall_tickets')).toBeTruthy();
  });

  it('lets the office write the instructions per exam', async () => {
    expect((await as(T.principal).put(`/api/v1/exams/${exam.SA1}/hall-ticket-note`, { text: 'x' })).status).toBe(403);
    const r = await as(dev).put(`/api/v1/exams/${exam.SA1}/hall-ticket-note`, { text: 'Come in full uniform.\nNo calculators.' });
    expect(r.body.data).toEqual({ note: 'Come in full uniform.\nNo calculators.', customNote: true });
    expect((await as(dev).get('/api/v1/hall-tickets/options')).body.data.exams[0]).toMatchObject({ customNote: true, note: 'Come in full uniform.\nNo calculators.' });
    expect((await as(dev).put(`/api/v1/exams/${exam.SA1}/hall-ticket-note`, { text: '' })).body.data.customNote).toBe(false);
  });

  it('lets parents download their own child\'s hall ticket, never tied to fees', async () => {
    const list = (await as(T.Asha).get(`/api/v1/students/${S.a.public_id}/hall-tickets`)).body.data;
    expect(list).toEqual([{ examId: exam.SA1, code: 'SA1', name: expect.any(String), first: '2099-03-02', last: '2099-03-04' }]);
    const r = await as(T.Asha).pdf(`/api/v1/students/${S.a.public_id}/hall-ticket.pdf?examId=${exam.SA1}`);
    expect(r.status).toBe(200);
    expect(pages(r.body)).toBe(1);
    expect((await as(T.Deepa).get(`/api/v1/students/${S.a.public_id}/hall-ticket.pdf?examId=${exam.SA1}`)).status).toBe(404);
    expect((await as(T.Deepa).get(`/api/v1/students/${S.d.public_id}/hall-tickets`)).body.data).toEqual([]);
    expect((await as(T.Deepa).get(`/api/v1/students/${S.d.public_id}/hall-ticket.pdf?examId=${exam.SA1}`)).body.code).toBe('NO_TIMETABLE');
  });
});
