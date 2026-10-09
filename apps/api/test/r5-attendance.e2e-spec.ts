import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';
import { addDays } from '../src/attendance/calendar';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };
const binary = (res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

describe('Attendance (e2e)', () => {
  let app: INestApplication; let db: Database; let http: any; let dev: string;
  let ct: string, st: string, acc: string;
  const cls: Record<string, number> = {}, sec: Record<string, number> = {};
  const K: Record<string, any> = {}, fam: Record<string, string> = {};
  let today: string, day: string, oldDay: string;

  const login = (i: string, p: string) => http.post('/api/v1/auth/login').send({ identifier: i, password: p });
  const as = (t: string) => {
    const h = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
    return { get: (u: string) => h(http.get(u)), post: (u: string, b: object = {}) => h(http.post(u)).send(b), put: (u: string, b: object) => h(http.put(u)).send(b),
      del: (u: string) => h(http.delete(u)), upload: (u: string, buf: Buffer) => h(http.post(u)).attach('file', buf, 'att.xlsx') };
  };
  async function activate(identifier: string, userPublicId: string) {
    const c = (await as(dev).post(`/api/v1/users/${userPublicId}/credentials`)).body.data;
    const t = (await login(identifier, c.temporaryPassword)).body.data.accessToken;
    await as(t).post('/api/v1/auth/change-password', { currentPassword: c.temporaryPassword, newPassword: 'NewPass@123' });
    return (await login(identifier, 'NewPass@123')).body.data.accessToken as string;
  }
  async function staff(n: number, roleKeys: string[]) {
    const r = await as(dev).post('/api/v1/staff', { name: `AT Staff ${n}`, email: `at${n}@test.local`, mobile: `92200000${String(n).padStart(2, '0')}`, employeeCode: `AT-${n}`, roleKeys });
    return { ...r.body.data, token: await activate(r.body.data.mobile, r.body.data.user_id) };
  }
  const kid = async (name: string, klass: string, mobile: string) => {
    const s = (await as(dev).post('/api/v1/students', { firstName: name, classId: cls[klass], sectionId: sec[`${klass}A`], family: { familyName: `${name} family`, mobile } })).body.data;
    fam[name] = await activate(mobile, s.family_user_id);
    return s;
  };
  const working = async (d: string) => (await as(dev).get(`/api/v1/attendance/overview?date=${d}`)).body.data.working as boolean;
  const mark = (t: string, section: string, date: string, entries: Array<[any, string]>) =>
    as(t).put(`/api/v1/attendance/sections/${sec[`${section}A`]}`, { date, entries: entries.map(([s, status]) => ({ studentId: s.public_id, status })) });

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp(); await app.init(); http = request(app.getHttpServer());
    dev = (await login(DEV.email, DEV.password)).body.data.accessToken;
    await as(dev).put('/api/v1/developer/feature-flags/attendance', { enabled: true });
    for (const c of (await as(dev).get('/api/v1/classes')).body.data) { cls[c.name] = c.id; for (const s of c.sections) sec[`${c.name}${s.name}`] = s.id; }
    const ctS = await staff(1, ['teacher', 'class_teacher']); ct = ctS.token; K.ctStaff = ctS;
    const stS = await staff(2, ['teacher']); st = stS.token; K.stStaff = stS;
    acc = (await staff(3, ['accountant'])).token;
    await as(dev).put(`/api/v1/sections/${sec['Class 5A']}/class-teacher`, { staffId: ctS.public_id });
    const subj = (await as(dev).post('/api/v1/subjects', { name: 'AT Maths' })).body.data.id;
    await as(dev).post('/api/v1/teacher-assignments', { staffId: stS.public_id, sectionId: sec['Class 6A'], subjectId: subj });
    K.asha = await kid('Asha', 'Class 5', '9220001001'); K.bala = await kid('Bala', 'Class 5', '9220001002');
    K.chandu = await kid('Chandu', 'Class 5', '9220001003'); K.dev6 = await kid('Deepa', 'Class 6', '9220001004');
    today = (await as(dev).get('/api/v1/attendance/overview')).body.data.today;
    day = today; while (!(await working(day))) day = addDays(day, -1);
    oldDay = addDays(today, -12); while (!(await working(oldDay))) oldDay = addDays(oldDay, -1);
  });
  afterAll(async () => { await app.close(); await db.destroy(); });

  it('shows each teacher only the sections they may mark, class teacher first (A1)', async () => {
    const c = (await as(ct).get(`/api/v1/attendance/overview?date=${day}`)).body.data;
    expect(c.sections[0]).toMatchObject({ name: 'Class 5 A', isClassTeacher: true, marked: false, students: 3 });
    const s = (await as(st).get(`/api/v1/attendance/overview?date=${day}`)).body.data;
    expect(s.sections.map((x: any) => x.name)).toEqual(['Class 6 A']);
    expect((await as(acc).get('/api/v1/attendance/overview')).status).toBe(403);
  });

  it('marks a section, alerts the family once, and only for absentees (A4)', async () => {
    expect((await mark(st, 'Class 5', day, [[K.asha, 'present']])).status).toBe(403);
    const r = await mark(ct, 'Class 5', day, [[K.asha, 'present'], [K.bala, 'absent'], [K.chandu, 'late']]);
    expect(r.body.data).toMatchObject({ changed: 3, alerted: 1, marked: true });
    expect((await as(fam.Bala).get('/api/v1/notifications/unread-count')).body.data.unread).toBe(1);
    expect((await as(fam.Asha).get('/api/v1/notifications/unread-count')).body.data.unread).toBe(0);
    const again = await mark(ct, 'Class 5', day, [[K.asha, 'present'], [K.bala, 'absent'], [K.chandu, 'late']]);
    expect(again.body.data).toMatchObject({ changed: 0, alerted: 0 });
    expect((await as(fam.Bala).get('/api/v1/notifications/unread-count')).body.data.unread).toBe(1);
    expect((await mark(st, 'Class 6', day, [[K.dev6, 'present']])).status).toBe(200);
    expect((await as(ct).get(`/api/v1/attendance/overview?date=${day}`)).body.data.sections[0]).toMatchObject({ marked: true, absent: 1 });
  });

  it('lets teachers change only up to 3 days back; the admin any time; never the future (A3)', async () => {
    expect((await mark(ct, 'Class 5', oldDay, [[K.asha, 'absent']])).body.code).toBe('EDIT_WINDOW_CLOSED');
    expect((await mark(ct, 'Class 5', addDays(today, 1), [[K.asha, 'present']])).body.code).toBe('FUTURE_DATE');
    const r = await mark(dev, 'Class 5', oldDay, [[K.asha, 'half_day'], [K.bala, 'present'], [K.chandu, 'present']]);
    expect(r.status).toBe(200);
    const view = (await as(ct).get(`/api/v1/attendance/sections/${sec['Class 5A']}?date=${oldDay}`)).body.data;
    expect(view).toMatchObject({ editable: false, marked: true });
  });

  it('does not allow marking on a holiday', async () => {
    let h = addDays(oldDay, -3); while (!(await working(h))) h = addDays(h, -1);
    const added = await as(dev).post('/api/v1/attendance/holidays', { name: 'Test Festival', startDate: h });
    expect(added.status).toBe(201);
    expect((await mark(dev, 'Class 5', h, [[K.asha, 'present']])).body.code).toBe('NOT_A_WORKING_DAY');
    expect((await as(dev).get(`/api/v1/attendance/overview?date=${h}`)).body.data).toMatchObject({ working: false, offReason: 'Test Festival' });
    expect((await as(st).post('/api/v1/attendance/holidays', { name: 'X', startDate: h })).status).toBe(403);
  });

  it('calculates the percentage: Late present, Half day half, unmarked days left out (A10)', async () => {
    const a = (await as(fam.Asha).get(`/api/v1/students/${K.asha.public_id}/attendance`)).body.data;
    expect(a.yearSummary).toMatchObject({ workingDays: 2, presentDays: 1.5, percentage: 75 });
    const c = (await as(fam.Chandu).get(`/api/v1/students/${K.chandu.public_id}/attendance`)).body.data;
    expect(c.yearSummary).toMatchObject({ presentDays: 2, percentage: 100 });
    expect((await as(fam.Asha).get(`/api/v1/students/${K.bala.public_id}/attendance`)).status).toBe(404);
  });

  it('gives the office a WhatsApp list of absentees', async () => {
    const r = (await as(dev).get(`/api/v1/attendance/absentees?date=${day}`)).body.data;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ name: 'Bala', className: 'Class 5 A', mobile: '9220001002' });
    expect(r.rows[0].whatsappUrl).toMatch(/^https:\/\/wa\.me\/919220001002\?text=Dear%20Parent/);
    expect((await as(ct).get('/api/v1/attendance/absentees')).status).toBe(403);
  });

  it('family applies for leave, class teacher approves; past absence becomes Leave (A5)', async () => {
    const r = await as(fam.Bala).post(`/api/v1/students/${K.bala.public_id}/leave-requests`, { startDate: day, endDate: day, reason: 'Fever' });
    expect(r.status).toBe(201);
    expect((await as(fam.Bala).post(`/api/v1/students/${K.bala.public_id}/leave-requests`, { startDate: day, endDate: day, reason: 'Again' })).body.code).toBe('LEAVE_OVERLAP');
    const ctList = (await as(ct).get('/api/v1/leave-requests?status=pending')).body.data;
    expect(ctList.find((l: any) => l.id === r.body.data.id)).toMatchObject({ who: 'Bala', canDecide: true });
    expect((await as(st).post(`/api/v1/leave-requests/${r.body.data.id}/decide`, { approve: true })).status).toBe(403);
    expect((await as(ct).post(`/api/v1/leave-requests/${r.body.data.id}/decide`, { approve: true, note: 'Get well soon' })).body.data.status).toBe('approved');
    const view = (await as(ct).get(`/api/v1/attendance/sections/${sec['Class 5A']}?date=${day}`)).body.data;
    expect(view.students.find((s: any) => s.name === 'Bala')).toMatchObject({ status: 'leave', onLeave: true });
    const future = await as(fam.Chandu).post(`/api/v1/students/${K.chandu.public_id}/leave-requests`, { startDate: addDays(today, 1), endDate: addDays(today, 3), reason: 'Family function' });
    await as(ct).post(`/api/v1/leave-requests/${future.body.data.id}/decide`, { approve: false, note: 'Exams that week' });
    const mine = (await as(fam.Chandu).get('/api/v1/leave-requests')).body.data;
    expect(mine[0]).toMatchObject({ status: 'rejected', decisionNote: 'Exams that week', mine: true });
  });

  it('staff check in only on school premises, time recorded; admin can correct (A6 to A8)', async () => {
    const w = await working(today);
    expect((await as(st).post('/api/v1/staff-attendance/check-in', { lat: 17.45, lng: 78.13, accuracy: 20 })).body.code).toBe(w ? 'LOCATION_NOT_SET' : 'LOCATION_NOT_SET');
    expect((await as(st).put('/api/v1/attendance/location', { lat: 17.45, lng: 78.13, radiusM: 200 })).status).toBe(403);
    await as(dev).put('/api/v1/attendance/location', { lat: 17.45, lng: 78.13, radiusM: 200 });
    if (!w) {
      expect((await as(st).post('/api/v1/staff-attendance/check-in', { lat: 17.45, lng: 78.13, accuracy: 20 })).body.code).toBe('NOT_A_WORKING_DAY');
      return;
    }
    expect((await as(st).post('/api/v1/staff-attendance/check-in', { lat: 17.46, lng: 78.13, accuracy: 20 })).body.code).toBe('OFF_PREMISES');
    expect((await as(st).post('/api/v1/staff-attendance/check-in', { lat: 17.45, lng: 78.13, accuracy: 900 })).body.code).toBe('LOCATION_IMPRECISE');
    const ok = await as(st).post('/api/v1/staff-attendance/check-in', { lat: 17.4505, lng: 78.1302, accuracy: 15 });
    expect(ok.body.data).toMatchObject({ status: 'present', already: false });
    expect((await as(st).post('/api/v1/staff-attendance/check-in', { lat: 17.4505, lng: 78.1302, accuracy: 15 })).body.data.already).toBe(true);
    const dayView = (await as(dev).get('/api/v1/staff-attendance')).body.data.staff.find((s: any) => s.name === 'AT Staff 2');
    expect(dayView).toMatchObject({ status: 'present', source: 'self' });
    expect(dayView.checkInAt).toBeTruthy();
    const fixed = await as(dev).put('/api/v1/staff-attendance', { date: today, entries: [{ staffId: K.stStaff.public_id, status: 'half_day' }] });
    expect(fixed.body.data.staff.find((s: any) => s.name === 'AT Staff 2')).toMatchObject({ status: 'half_day', source: 'admin' });
  });

  it('staff apply for leave; only the admin approves (A9)', async () => {
    const f = addDays(today, 2);
    const r = await as(st).post('/api/v1/leave-requests/mine', { startDate: f, endDate: addDays(f, 1), reason: 'Wedding' });
    expect(r.status).toBe(201);
    expect((await as(ct).post(`/api/v1/leave-requests/${r.body.data.id}/decide`, { approve: true })).status).toBe(403);
    expect((await as(dev).post(`/api/v1/leave-requests/${r.body.data.id}/decide`, { approve: true })).body.data.status).toBe('approved');
    const mine = (await as(st).get(`/api/v1/staff-attendance/mine?month=${f.slice(0, 7)}`)).body.data;
    const leaveDays = mine.days.filter((d: any) => d.status === 'leave').map((d: any) => d.date);
    for (const d of leaveDays) expect(d >= f && d <= addDays(f, 1)).toBe(true);
    expect((await as(st).post('/api/v1/leave-requests/mine', { startDate: addDays(today, -1), endDate: today, reason: 'Late' })).body.code).toBe('VALIDATION_FAILED');
  });

  it('imports attendance from the Excel template; bad cells reported, nothing saved until all valid', async () => {
    const t = await as(dev).get(`/api/v1/attendance/import-template?sectionId=${sec['Class 6A']}&month=${oldDay.slice(0, 7)}`).buffer(true).parse(binary);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t.body);
    const ws = wb.getWorksheet('Data')!;
    const dates: string[] = []; ws.getRow(1).eachCell((c, i) => { if (i > 2) dates.push(String(c.value)); });
    expect(dates).toContain(oldDay);
    expect(ws.getRow(2).getCell(2).value).toBe('Deepa');
    const col = dates.indexOf(oldDay) + 3;
    ws.getRow(2).getCell(col).value = 'X';
    ws.addRow(['NOPE', 'Ghost']);
    const bad = await as(dev).upload('/api/v1/attendance/import/validate', Buffer.from(await wb.xlsx.writeBuffer()));
    expect(bad.body.data.errors.map((e: any) => e.message)).toEqual(expect.arrayContaining(['"X" is not a code. Use P, A, L, H or LV.', 'NOPE is not an active student in a class this year.']));
    ws.getRow(2).getCell(col).value = 'A'; ws.spliceRows(3, 1);
    const ok = await as(dev).upload('/api/v1/attendance/import/validate', Buffer.from(await wb.xlsx.writeBuffer()));
    expect(ok.body.data).toMatchObject({ status: 'ready', summary: { marks: 1 } });
    expect((await as(dev).post(`/api/v1/attendance/import/${ok.body.data.jobId}/commit`)).body.data.status).toBe('completed');
    const m = (await as(dev).get(`/api/v1/attendance/sections/${sec['Class 6A']}/month?month=${oldDay.slice(0, 7)}`)).body.data;
    expect(m.students[0].statuses[oldDay]).toBe('absent');
    expect(m.days.find((d: any) => d.date === oldDay).marked).toBe(true);
  });

  it('upgrade: existing teacher roles get the new attendance permission once', async () => {
    const role = await db.selectFrom('roles').select('id').where('role_key', '=', 'teacher').executeTakeFirstOrThrow();
    const perm = await db.selectFrom('permissions').select('id').where('module_key', '=', 'attendance').where('action', '=', 'mark').executeTakeFirstOrThrow();
    await db.deleteFrom('role_permissions').where('role_id', '=', role.id).where('permission_id', '=', perm.id).execute();
    await db.deleteFrom('settings').where('setting_group', '=', 'seed').where('setting_key', '=', 'grant_patches').execute();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    const g = await db.selectFrom('role_permissions').select('scope').where('role_id', '=', role.id).where('permission_id', '=', perm.id).executeTakeFirst();
    expect(g?.scope).toBe('subject');
    // Once applied, an admin removing it is respected
    await db.deleteFrom('role_permissions').where('role_id', '=', role.id).where('permission_id', '=', perm.id).execute();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    expect(await db.selectFrom('role_permissions').select('scope').where('role_id', '=', role.id).where('permission_id', '=', perm.id).executeTakeFirst()).toBeUndefined();
  });
});
