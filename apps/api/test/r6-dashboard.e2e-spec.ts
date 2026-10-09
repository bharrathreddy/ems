import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';
import { addDays } from '../src/attendance/calendar';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };

describe('Dashboard analytics (e2e)', () => {
  let app: INestApplication; let db: Database; let http: any; let dev: string; let teacher: string; let family: string;
  const cls: Record<string, number> = {}, sec: Record<string, number> = {};
  let today: string, day: string, yearId: number;
  const K: Record<string, any> = {};

  const login = (i: string, p: string) => http.post('/api/v1/auth/login').send({ identifier: i, password: p });
  const as = (t: string) => {
    const h = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
    return { get: (u: string) => h(http.get(u)), post: (u: string, b: object = {}) => h(http.post(u)).send(b), put: (u: string, b: object) => h(http.put(u)).send(b) };
  };
  async function activate(identifier: string, userId: string) {
    const c = (await as(dev).post(`/api/v1/users/${userId}/credentials`)).body.data;
    const t = (await login(identifier, c.temporaryPassword)).body.data.accessToken;
    await as(t).post('/api/v1/auth/change-password', { currentPassword: c.temporaryPassword, newPassword: 'NewPass@123' });
    return (await login(identifier, 'NewPass@123')).body.data.accessToken as string;
  }
  const dash = (t: string, q = '') => as(t).get(`/api/v1/dashboard${q}`);

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp(); await app.init(); http = request(app.getHttpServer());
    dev = (await login(DEV.email, DEV.password)).body.data.accessToken;
    for (const m of ['attendance', 'fees', 'payments', 'cms']) await as(dev).put(`/api/v1/developer/feature-flags/${m}`, { enabled: true });
    for (const c of (await as(dev).get('/api/v1/classes')).body.data) { cls[c.name] = c.id; for (const s of c.sections) sec[`${c.name}${s.name}`] = s.id; }
    yearId = (await db.selectFrom('academic_years').select('id').where('is_current', '=', 1).executeTakeFirstOrThrow()).id;
    today = (await as(dev).get('/api/v1/attendance/overview')).body.data.today;
    day = today; while (!(await as(dev).get(`/api/v1/attendance/overview?date=${day}`)).body.data.working) day = addDays(day, -1);
    const bday = (offset: number, birthYear: number) => `${birthYear}-${addDays(today, offset).slice(5)}`;
    const t = await as(dev).post('/api/v1/staff', { name: 'Dash Teacher', email: 'dt@test.local', mobile: '9110000001', employeeCode: 'D-1', roleKeys: ['teacher', 'class_teacher'], dob: bday(0, 1990) });
    K.teacherStaff = t.body.data;
    teacher = await activate('9110000001', t.body.data.user_id);
    await as(dev).put(`/api/v1/sections/${sec['Class 3A']}/class-teacher`, { staffId: t.body.data.public_id });
    const add = (firstName: string, klass: string, mobile: string, gender: string, dob?: string) =>
      as(dev).post('/api/v1/students', { firstName, gender, dob, classId: cls[klass], sectionId: sec[`${klass}A`], family: { familyName: `${firstName} fam`, mobile } }).then((r) => r.body.data);
    K.a = await add('Anu', 'Class 3', '9110000101', 'female', bday(2, 2018));
    K.b = await add('Bhanu', 'Class 3', '9110000102', 'male');
    K.c = await add('Charan', 'Class 4', '9110000103', 'male', bday(3, 2017));
    family = await activate('9110000101', K.a.family_user_id);
    await as(dev).put(`/api/v1/attendance/sections/${sec['Class 3A']}`, { date: day, entries: [{ studentId: K.a.public_id, status: 'present' }, { studentId: K.b.public_id, status: 'absent' }] });
    await as(dev).put('/api/v1/fees/setup/default-plan', { planKey: 'yearly' });
    await as(dev).put('/api/v1/fees/setup/class-fees', { items: [{ classId: cls['Class 3'], amount: 20000 }, { classId: cls['Class 4'], amount: 22000 }] });
    await as(dev).get(`/api/v1/students/${K.a.public_id}/fees`); await as(dev).get(`/api/v1/students/${K.b.public_id}/fees`); await as(dev).get(`/api/v1/students/${K.c.public_id}/fees`);
    await as(dev).post('/api/v1/payments', { studentId: K.a.public_id, paymentDate: today, method: 'cash', lines: [{ category: 'tuition', academicYearId: yearId, amount: 5000 }] });
    let h = addDays(today, 5); while (new Date(`${h}T00:00:00Z`).getUTCDay() === 0) h = addDays(h, 1);
    K.holiday = h;
    await as(dev).post('/api/v1/attendance/holidays', { name: 'Dash Festival', startDate: h });
    await as(dev).post('/api/v1/cms/events', { title: 'Science Day', eventDate: addDays(today, 10) });
    const lr = await as(teacher).post('/api/v1/leave-requests/mine', { startDate: addDays(today, 1), endDate: addDays(today, 1), reason: 'Personal' });
    K.leaveId = lr.body.data.id;
  });
  afterAll(async () => { await app.close(); await db.destroy(); });

  it('gives the admin counts, attendance week, finance, upcoming days, birthdays and staff leave', async () => {
    const d = (await dash(dev)).body.data;
    expect(d.year.id).toBe(yearId);
    expect(d.counts).toMatchObject({ students: 3, boys: 2, girls: 1, families: 3, staff: 1, newAdmissions: 3, pendingLeave: 1 });
    const wk = d.attendance.days.find((x: any) => x.date === day);
    expect(wk).toMatchObject({ present: 1, absent: 1, sectionsMarked: 1, percentage: 50 });
    expect(d.attendance.days).toHaveLength(6);
    expect(d.finance).toMatchObject({ totalFee: 62000, collected: 5000, outstanding: 57000, receivedToday: 5000, receipts: 1, studentsWithDues: 3 });
    expect(d.finance.byMonth).toEqual([{ month: today.slice(0, 7), amount: 5000 }]);
    expect(d.upcoming.map((x: any) => x.title)).toEqual(expect.arrayContaining(['Dash Festival', 'Science Day']));
    const b = d.birthdays.map((x: any) => `${x.kind}:${x.name}:${x.age}`);
    expect(b).toEqual(expect.arrayContaining([`staff:Dash Teacher:${Number(today.slice(0, 4)) - 1990}`, expect.stringMatching(/^student:Anu:/), expect.stringMatching(/^student:Charan:/)]));
    expect(d.staffLeave.list[0]).toMatchObject({ name: 'Dash Teacher', status: 'pending' });
  });

  it('shows a teacher only their own students and no school money', async () => {
    const d = (await dash(teacher)).body.data;
    expect(d.counts.students).toBe(2);
    expect(d.counts.staff).toBeUndefined();
    expect(d.finance).toBeNull();
    expect(d.attendance).toBeNull();
    expect(d.birthdays.map((x: any) => x.name)).toEqual(['Anu']);
  });

  it('switches everything to another academic year with the filter', async () => {
    const y = await db.insertInto('academic_years').values({ name: '2019-20', start_date: new Date('2019-06-01'), end_date: new Date('2020-04-30'), status: 'closed' }).executeTakeFirstOrThrow();
    const d = (await dash(dev, `?yearId=${y.insertId}`)).body.data;
    expect(d.year.name).toBe('2019-20');
    expect(d.counts.students).toBe(0);
    expect(d.finance).toMatchObject({ collected: 0, receipts: 0 });
    expect(d.attendance.from >= '2020-04-20').toBe(true);
    expect(d.years.map((x: any) => x.name)).toEqual(expect.arrayContaining(['2019-20']));
  });

  it('is for staff only', async () => {
    expect((await dash(family)).status).toBe(403);
  });
});
