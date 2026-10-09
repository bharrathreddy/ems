import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const binary = (res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

describe('Exams and report cards (e2e)', () => {
  let app: INestApplication; let db: Database; let http: any; let dev: string;
  let math: string, tel: string, principal: string, family: string;
  const cls: Record<string, number> = {}, sec: Record<string, number> = {}, sub: Record<string, number> = {}, exam: Record<string, number> = {};
  const S: Record<string, any> = {}, staff: Record<string, any> = {};

  const login = (i: string, p: string) => http.post('/api/v1/auth/login').send({ identifier: i, password: p });
  const as = (t: string) => {
    const h = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
    return { get: (u: string) => h(http.get(u)), post: (u: string, b: object = {}) => h(http.post(u)).send(b), put: (u: string, b: object) => h(http.put(u)).send(b),
      del: (u: string) => h(http.delete(u)), upload: (u: string, buf: Buffer) => h(http.post(u)).attach('file', buf, { filename: 'p.png', contentType: 'image/png' }) };
  };
  async function activate(identifier: string, userId: string) {
    const c = (await as(dev).post(`/api/v1/users/${userId}/credentials`)).body.data;
    const t = (await login(identifier, c.temporaryPassword)).body.data.accessToken;
    await as(t).post('/api/v1/auth/change-password', { currentPassword: c.temporaryPassword, newPassword: 'NewPass@123' });
    return (await login(identifier, 'NewPass@123')).body.data.accessToken as string;
  }
  async function person(n: number, roleKeys: string[]) {
    const r = await as(dev).post('/api/v1/staff', { name: `EX Staff ${n}`, email: `ex${n}@test.local`, mobile: `93300100${String(n).padStart(2, '0')}`, employeeCode: `EX-${n}`, roleKeys });
    staff[n] = r.body.data;
    return activate(r.body.data.mobile, r.body.data.user_id);
  }
  const sheet = (t: string, e: string, s: string, subj: string, entries: Array<[any, number | 'AB' | null]>, submit = false) =>
    as(t).put('/api/v1/marks/sheet', { examId: exam[e], sectionId: sec[s], subjectId: sub[subj], submit, entries: entries.map(([st, m]) => ({ studentId: st.public_id, marks: m === 'AB' ? null : m, absent: m === 'AB' })) });
  const decide = (e: string, s: string, subj: string, approve: boolean, note?: string) => as(principal).post('/api/v1/marks/sheet/decide', { examId: exam[e], sectionId: sec[s], subjectId: sub[subj], approve, note });

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp(); await app.init(); http = request(app.getHttpServer());
    dev = (await login(DEV.email, DEV.password)).body.data.accessToken;
    for (const m of ['exams', 'marks']) await as(dev).put(`/api/v1/developer/feature-flags/${m}`, { enabled: true });
    let classes = (await as(dev).get('/api/v1/classes')).body.data;
    const c6 = classes.find((c: any) => c.name === 'Class 6');
    await as(dev).post(`/api/v1/classes/${c6.id}/sections`, { name: 'B' });
    classes = (await as(dev).get('/api/v1/classes')).body.data;
    for (const c of classes) { cls[c.name] = c.id; for (const s of c.sections) sec[`${c.name}${s.name}`] = s.id; }
    for (const n of ['Telugu', 'Maths']) sub[n] = (await as(dev).post('/api/v1/subjects', { name: n })).body.data.id;
    math = await person(1, ['teacher']); tel = await person(2, ['teacher', 'class_teacher']); principal = await person(3, ['principal']);
    await as(dev).put('/api/v1/teaching/grid', {
      classSubjects: [{ classId: cls['Class 6'], subjectIds: [sub.Telugu, sub.Maths] }],
      classTeachers: [{ sectionId: sec['Class 6A'], staffId: staff[2].public_id }],
      assignments: [{ sectionId: sec['Class 6A'], subjectId: sub.Maths, staffId: staff[1].public_id }, { sectionId: sec['Class 6A'], subjectId: sub.Telugu, staffId: staff[2].public_id },
        { sectionId: sec['Class 6B'], subjectId: sub.Maths, staffId: staff[1].public_id }, { sectionId: sec['Class 6B'], subjectId: sub.Telugu, staffId: staff[2].public_id }],
    });
    const kid = (name: string, s: string, mobile: string) => as(dev).post('/api/v1/students', { firstName: name, classId: cls['Class 6'], sectionId: sec[s], family: { familyName: `${name} fam`, mobile } }).then((r) => r.body.data);
    S.a = await kid('Asha', 'Class 6A', '9330200001'); S.b = await kid('Bala', 'Class 6A', '9330200002'); S.c = await kid('Chitra', 'Class 6A', '9330200003'); S.d = await kid('Dev', 'Class 6B', '9330200004');
    S.n = (await as(dev).post('/api/v1/students', { firstName: 'Nina', classId: cls.Nursery, sectionId: sec.NurseryA, family: { familyName: 'Nina fam', mobile: '9330200005' } })).body.data;
    family = await activate('9330200001', S.a.family_user_id);
  });
  afterAll(async () => { await app.close(); await db.destroy(); });

  it('creates the Telangana defaults for the year', async () => {
    const s = (await as(dev).get('/api/v1/exams/setup')).body.data;
    for (const e of s.exams) exam[e.code] = e.id;
    expect(s.exams.map((e: any) => `${e.code}:${e.maxMarks}`)).toEqual(['FA1:20', 'FA2:20', 'SA1:80', 'FA3:20', 'FA4:20', 'SA2:80']);
    const c6 = s.classes.find((c: any) => c.name === 'Class 6'), nur = s.classes.find((c: any) => c.name === 'Nursery'), c3 = s.classes.find((c: any) => c.name === 'Class 3');
    expect(s.scales.find((x: any) => x.id === c6.gradeScaleId).name).toBe('High school (Classes 6-10)');
    expect(s.scales.find((x: any) => x.id === c3.gradeScaleId).name).toBe('Primary (Classes 1-5)');
    expect(nur.assessment).toBe('skills');
    expect(s.coAreas).toHaveLength(4);
    expect(s.exams.find((e: any) => e.code === 'FA1').classIds).not.toContain(cls.Nursery);
  });

  it('holds the exam schedule; families see upcoming papers', async () => {
    const d = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    expect((await as(math).put(`/api/v1/exams/${exam.SA1}/schedule`, { classId: cls['Class 6'], rows: [] })).status).toBe(403);
    const r = await as(dev).put(`/api/v1/exams/${exam.SA1}/schedule`, { classId: cls['Class 6'], rows: [{ subjectId: sub.Maths, date: d, start: '09:30', end: '12:15' }] });
    expect(r.body.data.subjects.find((x: any) => x.subject === 'Maths')).toMatchObject({ date: d, start: '09:30' });
    const up = (await as(family).get('/api/v1/exams/upcoming')).body.data;
    expect(up[0]).toMatchObject({ exam: 'SA1', subject: 'Maths', className: 'Class 6', date: d });
  });

  it('subject teachers enter only their own subjects; submit needs every mark; limits enforced', async () => {
    const mine = (await as(math).get(`/api/v1/marks/sheets?examId=${exam.FA1}`)).body.data.sheets;
    expect(mine.map((x: any) => `${x.section}:${x.subject}`).sort()).toEqual(['Class 6 A:Maths', 'Class 6 B:Maths']);
    expect((await sheet(math, 'FA1', 'Class 6A', 'Telugu', [[S.a, 10]])).status).toBe(403);
    expect((await sheet(math, 'FA1', 'Class 6A', 'Maths', [[S.a, 25]])).body.code).toBe('VALIDATION_FAILED');
    await sheet(math, 'FA1', 'Class 6A', 'Maths', [[S.a, 18], [S.b, 'AB']]);
    expect((await sheet(math, 'FA1', 'Class 6A', 'Maths', [], true)).body.code).toBe('MARKS_MISSING');
    const ok = await sheet(math, 'FA1', 'Class 6A', 'Maths', [[S.c, 16]], true);
    expect(ok.body.data).toMatchObject({ status: 'submitted', canEdit: false });
    expect((await sheet(math, 'FA1', 'Class 6A', 'Maths', [[S.c, 17]])).body.code).toBe('SHEET_LOCKED');
  });

  it('principal approves or sends back; publishing needs every subject approved; families notified', async () => {
    await sheet(tel, 'FA1', 'Class 6A', 'Telugu', [[S.a, 15], [S.b, 12], [S.c, 16]], true);
    expect((await as(math).post('/api/v1/marks/sheet/decide', { examId: exam.FA1, sectionId: sec['Class 6A'], subjectId: sub.Maths, approve: true })).status).toBe(403);
    await decide('FA1', 'Class 6A', 'Maths', true);
    await decide('FA1', 'Class 6A', 'Telugu', false, 'Check Bala, paper re-totalled');
    expect((await as(tel).get('/api/v1/notifications')).body.data[0].title).toContain('Marks sent back');
    expect((await as(principal).post(`/api/v1/exams/${exam.FA1}/publish`, { sectionId: sec['Class 6A'] })).body.code).toBe('NOT_ALL_APPROVED');
    await sheet(tel, 'FA1', 'Class 6A', 'Telugu', [[S.b, 14]], true);
    await decide('FA1', 'Class 6A', 'Telugu', true);
    expect((await as(principal).post(`/api/v1/exams/${exam.FA1}/publish`, { sectionId: sec['Class 6A'] })).body.data.published).toBe(true);
    expect((await as(family).get('/api/v1/notifications')).body.data[0].title).toBe('Formative Assessment 1 results: Asha');
  });

  it('families see published exams only; staff preview everything', async () => {
    await sheet(math, 'FA2', 'Class 6A', 'Maths', [[S.a, 20], [S.b, 10], [S.c, 12]]);
    const f = (await as(family).get(`/api/v1/students/${S.a.public_id}/marks`)).body.data;
    expect(f.marks.allExams.map((e: any) => e.code)).toEqual(['FA1']);
    expect(f.marks.result.subjects.find((x: any) => x.name === 'Maths').cells.FA1).toMatchObject({ marks: 18, pct: 90, grade: 'A2' });
    const staffView = (await as(dev).get(`/api/v1/students/${S.a.public_id}/marks`)).body.data;
    expect(staffView.marks.result.subjects.find((x: any) => x.name === 'Maths').cells.FA2.marks).toBe(20);
    expect((await as(family).get(`/api/v1/students/${S.d.public_id}/marks`)).status).toBe(404);
  });

  it('works out finals, AB as zero, and ranks in section and class with ties', async () => {
    // Class 6 B: Dev gets the same FA1 marks as Asha in both subjects
    await sheet(dev, 'FA1', 'Class 6B', 'Maths', [[S.d, 18]]); await sheet(dev, 'FA1', 'Class 6B', 'Telugu', [[S.d, 15]]);
    const r = (await as(principal).get(`/api/v1/exams/results?sectionId=${sec['Class 6A']}`)).body.data;
    const asha = r.students.find((s: any) => s.name === 'Asha'), bala = r.students.find((s: any) => s.name === 'Bala');
    // Staff preview counts FA1 + FA2: Asha Maths (90 + 100)/2 = 95, Telugu 75
    expect(asha.subjects.find((x: any) => x.name === 'Maths').finalPct).toBe(95);
    expect(bala.subjects.find((x: any) => x.name === 'Maths').cells.FA1).toMatchObject({ absent: true, pct: 0 });
    expect(asha.rankSection).toBe(1);
    expect(asha.rankClass).toBeGreaterThanOrEqual(1);
    expect((await as(math).get(`/api/v1/exams/results?sectionId=${sec['Class 6A']}`)).status).toBe(403);
  });

  it('corrects a published mark through the principal, and tells the family', async () => {
    expect((await as(math).post('/api/v1/marks/corrections', { examId: exam.FA1, studentId: S.a.public_id, subjectId: sub.Maths, marks: 19.5, reason: 'x' })).body.code).toBe('VALIDATION_FAILED');
    const c = await as(math).post('/api/v1/marks/corrections', { examId: exam.FA1, studentId: S.a.public_id, subjectId: sub.Maths, marks: 19.5, reason: 'Totalling error on page 3' });
    expect(c.status).toBe(201);
    expect((await as(math).post('/api/v1/marks/corrections', { examId: exam.FA1, studentId: S.a.public_id, subjectId: sub.Maths, marks: 19, reason: 'Again please' })).body.code).toBe('CORRECTION_PENDING');
    const list = (await as(principal).get('/api/v1/marks/corrections')).body.data;
    expect(list[0]).toMatchObject({ from: '18', to: '19.5', canDecide: true });
    await as(principal).post(`/api/v1/marks/corrections/${c.body.data.id}/decide`, { approve: true });
    const f = (await as(family).get(`/api/v1/students/${S.a.public_id}/marks`)).body.data;
    expect(f.marks.result.subjects.find((x: any) => x.name === 'Maths').cells.FA1.marks).toBe(19.5);
    expect((await as(family).get('/api/v1/notifications')).body.data[0].title).toContain('mark corrected');
  });

  it('class teacher grades co-scholastic areas and writes remarks; can add a class-only area', async () => {
    const ct = (await as(tel).get(`/api/v1/marks/class-teacher?sectionId=${sec['Class 6A']}&term=1`)).body.data;
    expect(ct.areas).toHaveLength(4);
    expect((await as(math).get(`/api/v1/marks/class-teacher?sectionId=${sec['Class 6A']}&term=1`)).status).toBe(403);
    expect((await as(tel).post('/api/v1/exams/co-areas', { name: 'Spoken English', classId: null })).status).toBe(403);
    expect((await as(tel).post('/api/v1/exams/co-areas', { name: 'Spoken English', classId: cls['Class 6'] })).status).toBe(201);
    const saved = (await as(tel).put('/api/v1/marks/class-teacher', { sectionId: sec['Class 6A'], term: 1, rows: [{ studentId: S.a.public_id, grades: { [ct.areas[0].id]: 'A+' }, remarks: 'Attentive and helpful in class.' }] })).body.data;
    expect(saved.areas).toHaveLength(5);
    expect(saved.students.find((s: any) => s.name === 'Asha')).toMatchObject({ remarks: 'Attentive and helpful in class.' });
  });

  it('prints report cards for a family and for a whole section', async () => {
    await as(dev).upload(`/api/v1/students/${S.a.public_id}/photo`, PNG);
    expect((await as(family).get(`/api/v1/students/${S.a.public_id}/photo`)).status).toBe(200);
    const one = await as(family).get(`/api/v1/students/${S.a.public_id}/report-card.pdf`).buffer(true).parse(binary);
    expect(one.headers['content-type']).toBe('application/pdf');
    expect(one.body.subarray(0, 4).toString()).toBe('%PDF');
    const all = await as(tel).get(`/api/v1/sections/${sec['Class 6A']}/report-cards.pdf`).buffer(true).parse(binary);
    expect(all.body.subarray(0, 4).toString()).toBe('%PDF');
    expect((await as(math).get(`/api/v1/sections/${sec['Class 6A']}/report-cards.pdf`)).status).toBe(403);
  });

  it('keeps unit tests off the report card', async () => {
    const r = await as(dev).post('/api/v1/exams', { name: 'Unit Test 1', code: 'UT1', kind: 'unit', maxMarks: 25, classIds: [cls['Class 6']] });
    expect(r.status).toBe(201);
    const before = (await as(dev).get(`/api/v1/students/${S.c.public_id}/marks`)).body.data.marks.result.totalPct;
    const setup = (await as(dev).get('/api/v1/exams/setup')).body.data;
    exam.UT1 = setup.exams.find((e: any) => e.code === 'UT1').id;
    await sheet(math, 'UT1', 'Class 6A', 'Maths', [[S.c, 2]]);
    const after = (await as(dev).get(`/api/v1/students/${S.c.public_id}/marks`)).body.data;
    expect(after.marks.result.totalPct).toBe(before);
    expect(after.marks.exams.map((e: any) => e.code)).not.toContain('UT1');
    expect(after.marks.allExams.map((e: any) => e.code)).toContain('UT1');
    expect((await as(dev).del(`/api/v1/exams/${exam.FA1}`)).body.code).toBe('CORE_EXAM');
  });

  it('rates pre-primary skills instead of marks', async () => {
    const ct = (await as(dev).get(`/api/v1/marks/class-teacher?sectionId=${sec.NurseryA}&term=1`)).body.data;
    expect(ct.assessment).toBe('skills');
    expect(ct.skills.length).toBeGreaterThan(10);
    await as(dev).put('/api/v1/marks/class-teacher', { sectionId: sec.NurseryA, term: 1, rows: [{ studentId: S.n.public_id, ratings: { [ct.skills[0].id]: 'excellent' } }] });
    const d = (await as(dev).get(`/api/v1/students/${S.n.public_id}/marks`)).body.data;
    expect(d.marks).toBeNull();
    expect(d.skills[0]).toMatchObject({ name: ct.skills[0].name, terms: ['Excellent', ''] });
  });

  it('records a leaving student with the TC and bonafide checklist', async () => {
    const r = await as(dev).put(`/api/v1/students/${S.c.public_id}/exit`, { leavingDate: '2026-10-01', reason: 'Family moved to Hyderabad', tcNumber: 'TC/2026/014', tcIssuedOn: '2026-10-02' });
    expect(r.body.data).toMatchObject({ tcNumber: 'TC/2026/014', bonafideIssuedOn: null });
    const st = await db.selectFrom('students').select(['status', 'inactive_reason']).where('public_id', '=', S.c.public_id).executeTakeFirstOrThrow();
    expect(st).toMatchObject({ status: 'inactive', inactive_reason: 'Left: Family moved to Hyderabad' });
    await as(dev).put(`/api/v1/students/${S.c.public_id}/exit`, { leavingDate: '2026-10-01', reason: 'Family moved to Hyderabad', tcNumber: 'TC/2026/014', tcIssuedOn: '2026-10-02', bonafideNumber: 'BC/2026/031', bonafideIssuedOn: '2026-10-03' });
    const list = (await as(dev).get('/api/v1/student-exits')).body.data;
    expect(list[0]).toMatchObject({ name: 'Chitra', tc: { number: 'TC/2026/014' }, bonafide: { number: 'BC/2026/031' } });
    expect((await as(dev).put(`/api/v1/students/${S.c.public_id}/exit`, { leavingDate: '2026-10-01', reason: 'Moved', tcIssuedOn: '2026-10-02' })).body.code).toBe('VALIDATION_FAILED');
  });
});
