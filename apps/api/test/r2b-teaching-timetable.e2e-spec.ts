import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };

describe('Teaching grid and timetable (e2e)', () => {
  let app: INestApplication; let db: Database; let http: any; let dev: string;
  const cls: Record<string, number> = {}, sec: Record<string, number> = {}, subj: Record<string, number> = {};
  let t1: any, t2: any, grp: Record<string, number> = {}, P: Record<string, Record<string, number>> = {};

  const login = (i: string, p: string) => http.post('/api/v1/auth/login').send({ identifier: i, password: p });
  const as = (t: string) => {
    const h = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
    return { get: (u: string) => h(http.get(u)), post: (u: string, b: object = {}) => h(http.post(u)).send(b), put: (u: string, b: object) => h(http.put(u)).send(b) };
  };
  async function teacher(n: number) {
    const r = await as(dev).post('/api/v1/staff', { name: `TT Teacher ${n}`, email: `tt${n}@test.local`, mobile: `95500000${String(n).padStart(2, '0')}`, employeeCode: `TT-${n}`, roleKeys: ['teacher'] });
    const c = (await as(dev).post(`/api/v1/users/${r.body.data.user_id}/credentials`)).body.data;
    const t = (await login(c.username, c.temporaryPassword)).body.data.accessToken;
    await as(t).post('/api/v1/auth/change-password', { currentPassword: c.temporaryPassword, newPassword: 'NewPass@123' });
    return { ...r.body.data, token: (await login(c.username, 'NewPass@123')).body.data.accessToken };
  }
  const grid = (b: object) => as(dev).put('/api/v1/teaching/grid', b);
  const slot = (section: string, day: number, period: number, subjectId: number | null) => as(dev).put(`/api/v1/timetable/sections/${sec[section]}/slots`, { day, periodId: period, subjectId });

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp(); await app.init(); http = request(app.getHttpServer());
    dev = (await login(DEV.email, DEV.password)).body.data.accessToken;
    for (const c of (await as(dev).get('/api/v1/classes')).body.data) { cls[c.name] = c.id; for (const s of c.sections) sec[`${c.name}${s.name}`] = s.id; }
    for (const n of ['TT Telugu', 'TT English', 'TT Maths']) subj[n] = (await as(dev).post('/api/v1/subjects', { name: n })).body.data.id;
    t1 = await teacher(1); t2 = await teacher(2);
  });
  afterAll(async () => { await app.close(); await db.destroy(); });

  it('saves the whole teaching grid at once and reads it back', async () => {
    const r = await grid({
      classSubjects: [{ classId: cls['Class 1'], subjectIds: [subj['TT Telugu'], subj['TT Maths']] }, { classId: cls['Class 9'], subjectIds: [subj['TT English'], subj['TT Maths']] }],
      classTeachers: [{ sectionId: sec['Class 1A'], staffId: t1.public_id }],
      assignments: [
        { sectionId: sec['Class 1A'], subjectId: subj['TT Maths'], staffId: t1.public_id }, { sectionId: sec['Class 1A'], subjectId: subj['TT Telugu'], staffId: t2.public_id },
        { sectionId: sec['Class 9A'], subjectId: subj['TT Maths'], staffId: t1.public_id }, { sectionId: sec['Class 9A'], subjectId: subj['TT English'], staffId: t2.public_id },
      ],
    });
    expect(r.status).toBe(200);
    const c1 = r.body.data.classes.find((c: any) => c.name === 'Class 1');
    expect(c1.subjectIds.sort()).toEqual([subj['TT Telugu'], subj['TT Maths']].sort());
    expect(c1.sections[0]).toMatchObject({ classTeacher: t1.public_id, teachers: { [subj['TT Maths']]: t1.public_id, [subj['TT Telugu']]: t2.public_id } });
  });

  it('keeps one teacher per section and subject', async () => {
    await grid({ assignments: [{ sectionId: sec['Class 1A'], subjectId: subj['TT Maths'], staffId: t2.public_id }] });
    const n = await db.selectFrom('teacher_assignments').select((eb) => eb.fn.countAll<number>().as('n')).where('section_id', '=', sec['Class 1A']).where('subject_id', '=', subj['TT Maths']).executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(1);
  });

  it('sets up bell schedules per class group and Saturdays off', async () => {
    grp.primary = (await as(dev).post('/api/v1/timetable/groups', { name: 'TT Primary' })).body.data.id;
    grp.high = (await as(dev).post('/api/v1/timetable/groups', { name: 'TT High' })).body.data.id;
    await as(dev).put(`/api/v1/timetable/groups/${grp.primary}/classes`, { classIds: [cls['Class 1']] });
    await as(dev).put(`/api/v1/timetable/groups/${grp.high}/classes`, { classIds: [cls['Class 9']] });
    const bad = await as(dev).put(`/api/v1/timetable/groups/${grp.primary}/periods`, { periods: [{ kind: 'period', label: 'P1', start: '09:00', end: '09:40' }, { kind: 'period', label: 'P2', start: '09:30', end: '10:00' }] });
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    await as(dev).put(`/api/v1/timetable/groups/${grp.primary}/periods`, { periods: [
      { kind: 'period', label: 'P1', start: '09:00', end: '09:40' }, { kind: 'break', label: 'Break', start: '09:40', end: '09:50' }, { kind: 'period', label: 'P2', start: '09:50', end: '10:30' }] });
    const s = (await as(dev).put(`/api/v1/timetable/groups/${grp.high}/periods`, { periods: [
      { kind: 'period', label: 'P1', start: '09:00', end: '09:45' }, { kind: 'period', label: 'P2', start: '09:45', end: '10:30' }] })).body.data;
    for (const g of s.groups) P[g.name] = Object.fromEntries(g.periods.map((p: any) => [p.label, p.id]));
    expect((await as(dev).put('/api/v1/timetable/saturdays-off', { weeks: [2, 4] })).body.data.saturdaysOff).toEqual([2, 4]);
  });

  it('fills a slot by subject, with the teacher coming from the grid', async () => {
    const r = await slot('Class 1A', 1, P['TT Primary'].P1, subj['TT Maths']);
    expect(r.status).toBe(200);
    expect(r.body.data.slots).toEqual([expect.objectContaining({ day: 1, subject: 'TT Maths', teacher: 'TT Teacher 2' })]);
    expect((await slot('Class 1A', 1, P['TT Primary'].Break, subj['TT Maths'])).body.code).toBe('NOT_A_PERIOD');
    expect((await slot('Class 1A', 1, P['TT Primary'].P2, subj['TT English'])).body.code).toBe('SUBJECT_NOT_IN_CLASS');
    expect((await slot('Class 1A', 1, P['TT High'].P1, subj['TT Maths'])).body.code).toBe('WRONG_PERIOD');
  });

  it('blocks a teacher in two places at overlapping clock times, even across bell schedules (T4)', async () => {
    const r = await slot('Class 9A', 1, P['TT High'].P1, subj['TT English']);
    expect(r.body.code).toBe('TIMETABLE_CLASH');
    expect(r.body.message).toContain('TT Teacher 2');
    expect(r.body.message).toContain('Mon');
    expect((await slot('Class 9A', 1, P['TT High'].P1, subj['TT Maths'])).status).toBe(200);
    expect((await slot('Class 9A', 1, P['TT High'].P2, subj['TT English'])).status).toBe(200);
  });

  it('blocks bell timing changes that would create a clash', async () => {
    const r = await as(dev).put(`/api/v1/timetable/groups/${grp.primary}/periods`, { periods: [
      { id: P['TT Primary'].P1, kind: 'period', label: 'P1', start: '09:00', end: '09:50' }, { id: P['TT Primary'].Break, kind: 'break', label: 'Break', start: '09:50', end: '10:00' },
      { id: P['TT Primary'].P2, kind: 'period', label: 'P2', start: '10:00', end: '10:40' }] });
    expect(r.body.code).toBe('TIMETABLE_CLASH');
    const after = (await as(dev).get('/api/v1/timetable/setup')).body.data.groups.find((g: any) => g.name === 'TT Primary');
    expect(after.periods[0].end).toBe('09:40');
  });

  it('blocks a teaching-grid change that would create a clash', async () => {
    await slot('Class 1A', 2, P['TT Primary'].P1, subj['TT Telugu']);
    await slot('Class 9A', 2, P['TT High'].P1, subj['TT Maths']);
    const r = await grid({ assignments: [{ sectionId: sec['Class 9A'], subjectId: subj['TT Maths'], staffId: t2.public_id }] });
    expect(r.body.code).toBe('TIMETABLE_CLASH');
    const still = (await as(dev).get('/api/v1/teaching/grid')).body.data.classes.find((c: any) => c.name === 'Class 9').sections[0].teachers[subj['TT Maths']];
    expect(still).toBe(t1.public_id);
  });

  it('will not drop a subject that is still in the timetable', async () => {
    const r = await grid({ classSubjects: [{ classId: cls['Class 1'], subjectIds: [subj['TT Maths']] }] });
    expect(r.body.code).toBe('SUBJECT_IN_TIMETABLE');
  });

  it('copies a day to other days, all or nothing', async () => {
    const r = await as(dev).post(`/api/v1/timetable/sections/${sec['Class 1A']}/copy-day`, { fromDay: 1, toDays: [2, 3, 4, 5, 6] });
    expect(r.status).toBe(200);
    expect(r.body.data.slots.filter((s: any) => s.subject === 'TT Maths')).toHaveLength(6);
    const clash = await as(dev).post(`/api/v1/timetable/sections/${sec['Class 9A']}/copy-day`, { fromDay: 1, toDays: [3] });
    expect(clash.status).toBe(200);
  });

  it('shows a teacher their own week', async () => {
    const r = (await as(t2.token).get('/api/v1/timetable/mine')).body.data;
    expect(r.lessons.filter((l: any) => l.day === 1).map((l: any) => `${l.className} ${l.section} ${l.subject} ${l.start}`))
      .toEqual(['Class 1 A TT Maths 09:00', 'Class 9 A TT English 09:45']);
    expect((await as(t2.token).put(`/api/v1/timetable/sections/${sec['Class 1A']}/slots`, { day: 1, periodId: P['TT Primary'].P1, subjectId: null })).status).toBe(403);
  });

  it('shows a family only their child\'s timetable', async () => {
    const s = (await as(dev).post('/api/v1/students', { firstName: 'Timmy', classId: cls['Class 1'], sectionId: sec['Class 1A'], family: { familyName: 'Timmy family', mobile: '9550000099' } })).body.data;
    const c = (await as(dev).post(`/api/v1/users/${s.family_user_id}/credentials`)).body.data;
    let t = (await login(c.username, c.temporaryPassword)).body.data.accessToken;
    await as(t).post('/api/v1/auth/change-password', { currentPassword: c.temporaryPassword, newPassword: 'NewPass@123' });
    t = (await login(c.username, 'NewPass@123')).body.data.accessToken;
    const tt = (await as(t).get(`/api/v1/students/${s.public_id}/timetable`)).body.data;
    expect(tt.section).toMatchObject({ className: 'Class 1', name: 'A', classTeacher: 'TT Teacher 1' });
    expect(tt.periods.map((p: any) => p.label)).toEqual(['P1', 'Break', 'P2']);
    expect(tt.saturdaysOff).toEqual([2, 4]);
    expect((await as(t).get(`/api/v1/timetable/sections/${sec['Class 1A']}`)).status).toBe(403);
  });

  it('keeps closed years read-only', async () => {
    const y = await db.insertInto('academic_years').values({ name: '2019-20', start_date: new Date('2019-06-01'), end_date: new Date('2020-04-30'), status: 'closed' }).executeTakeFirstOrThrow();
    const r = await grid({ yearId: Number(y.insertId), classTeachers: [{ sectionId: sec['Class 1A'], staffId: t1.public_id }] });
    expect(r.body.code).toBe('YEAR_CLOSED');
    expect((await as(dev).get(`/api/v1/teaching/grid?yearId=${y.insertId}`)).body.data.year.editable).toBe(false);
  });

  it('upgrade: new permissions reach existing roles, but admin changes are kept', async () => {
    const teacherRole = await db.selectFrom('roles').select('id').where('role_key', '=', 'teacher').executeTakeFirstOrThrow();
    const ann = await db.selectFrom('permissions').select('id').where('module_key', '=', 'announcements').where('action', '=', 'view').executeTakeFirstOrThrow();
    await db.deleteFrom('role_permissions').where('role_id', '=', teacherRole.id).where('permission_id', '=', ann.id).execute(); // admin removed it
    const tv = await db.selectFrom('permissions').select('id').where('module_key', '=', 'timetable').execute();
    await db.deleteFrom('role_permissions').where('permission_id', 'in', tv.map((x) => x.id)).execute();
    await db.deleteFrom('permissions').where('module_key', '=', 'timetable').execute(); // as if installed before this version
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    const grants = await db.selectFrom('role_permissions as rp').innerJoin('permissions as p', 'p.id', 'rp.permission_id').innerJoin('roles as r', 'r.id', 'rp.role_id')
      .select(['r.role_key', 'p.module_key', 'p.action', 'rp.scope']).where('p.module_key', 'in', ['timetable', 'announcements']).where('r.role_key', 'in', ['teacher', 'parent', 'institution_admin']).execute();
    const has = (role: string, perm: string) => grants.find((g) => g.role_key === role && `${g.module_key}.${g.action}` === perm);
    expect(has('teacher', 'timetable.view')?.scope).toBe('all');
    expect(has('parent', 'timetable.view')?.scope).toBe('own_children');
    expect(has('institution_admin', 'timetable.manage')).toBeDefined();
    expect(has('teacher', 'announcements.view')).toBeUndefined();
    await db.insertInto('role_permissions').values({ role_id: teacherRole.id, permission_id: ann.id, scope: 'all' }).execute();
  });
});
