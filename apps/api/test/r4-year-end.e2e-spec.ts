import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };

describe('Year end: promotion, switch, closed year, waivers (e2e)', () => {
  let app: INestApplication; let db: Database; let http: any; let dev: string; let accountant: string; let teacher: string;
  const cls: Record<string, number> = {}, sec: Record<string, number> = {};
  const S: Record<string, any> = {};
  let fromId: number, toId: number;

  const login = (i: string, p: string) => http.post('/api/v1/auth/login').send({ identifier: i, password: p });
  const as = (t: string) => {
    const h = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
    return { get: (u: string) => h(http.get(u)), post: (u: string, b: object = {}) => h(http.post(u)).send(b), put: (u: string, b: object) => h(http.put(u)).send(b), patch: (u: string, b: object) => h(http.patch(u)).send(b) };
  };
  async function staff(n: number, roleKeys: string[]) {
    const r = await as(dev).post('/api/v1/staff', { name: `YE Staff ${n}`, email: `ye${n}@test.local`, mobile: `93300000${String(n).padStart(2, '0')}`, employeeCode: `YE-${n}`, roleKeys });
    const c = (await as(dev).post(`/api/v1/users/${r.body.data.user_id}/credentials`)).body.data;
    const t = (await login(c.username, c.temporaryPassword)).body.data.accessToken;
    await as(t).post('/api/v1/auth/change-password', { currentPassword: c.temporaryPassword, newPassword: 'NewPass@123' });
    return (await login(c.username, 'NewPass@123')).body.data.accessToken as string;
  }
  const kid = async (name: string, klass: string, mobile: string) =>
    (await as(dev).post('/api/v1/students', { firstName: name, classId: cls[klass], sectionId: sec[`${klass}A`], family: { familyName: `${name} family`, mobile } })).body.data;
  const decide = (decisions: object[]) => as(dev).post('/api/v1/year-end/apply', { toYearId: toId, decisions });

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp(); await app.init(); http = request(app.getHttpServer());
    dev = (await login(DEV.email, DEV.password)).body.data.accessToken;
    for (const c of (await as(dev).get('/api/v1/classes')).body.data) { cls[c.name] = c.id; for (const s of c.sections) sec[`${c.name}${s.name}`] = s.id; }
    await as(dev).put('/api/v1/developer/feature-flags/fees', { enabled: true });
    await as(dev).put('/api/v1/developer/feature-flags/payments', { enabled: true });
    accountant = await staff(1, ['accountant']);
    teacher = await staff(2, ['teacher']);
    fromId = (await db.selectFrom('academic_years').select('id').where('is_current', '=', 1).executeTakeFirstOrThrow()).id;
    toId = (await as(dev).post('/api/v1/academic-years', { name: '2030-31', startDate: '2030-06-01', endDate: '2031-04-30' })).body.data.id;
    // Fees for this year so the detained student has dues to carry
    const setup = (await as(accountant).get('/api/v1/fees/setup')).body.data;
    if (!setup.defaultPlanId) await as(accountant).put('/api/v1/fees/setup/default-plan', { planKey: 'yearly' });
    await as(accountant).put('/api/v1/fees/setup/class-fees', { items: [{ classId: cls['Class 9'], amount: 20000 }, { classId: cls['Class 10'], amount: 24000 }] });
    S.p = await kid('Promo', 'Class 9', '9330001001');
    S.d = await kid('Detain', 'Class 9', '9330001002');
    S.c = await kid('Complete', 'Class 10', '9330001003');
    S.l = await kid('Leaver', 'Class 10', '9330001004');
  });

  afterAll(async () => {
    await app.close(); await db.destroy();
  });

  it('shows each section with sensible defaults: next class, same section; top class completes', async () => {
    const c9 = (await as(dev).get(`/api/v1/year-end/sections/${sec['Class 9A']}?toYearId=${toId}`)).body.data;
    expect(c9).toMatchObject({ defaultAction: 'promote', defaultTarget: { classId: cls['Class 10'], sectionId: sec['Class 10A'] } });
    expect(c9.students.map((s: any) => s.name)).toEqual(expect.arrayContaining(['Promo', 'Detain']));
    const c10 = (await as(dev).get(`/api/v1/year-end/sections/${sec['Class 10A']}?toYearId=${toId}`)).body.data;
    expect(c10).toMatchObject({ defaultAction: 'complete', section: { isTopClass: true } });
  });

  it('applies decisions: promote, detain (reason required), complete, leave; only the admin may', async () => {
    expect((await as(teacher).post('/api/v1/year-end/apply', { toYearId: toId, decisions: [{ studentId: S.p.public_id, action: 'promote' }] })).status).toBe(403);
    const noReason = await decide([{ studentId: S.d.public_id, action: 'detain', sectionId: sec['Class 9A'] }]);
    expect(noReason.body.details[0].message).toContain('reason');
    const same = await decide([{ studentId: S.p.public_id, action: 'promote', classId: cls['Class 9'], sectionId: sec['Class 9A'] }]);
    expect(same.body.code).toBe('VALIDATION_FAILED');
    const r = await decide([
      { studentId: S.p.public_id, action: 'promote', classId: cls['Class 10'], sectionId: sec['Class 10A'] },
      { studentId: S.d.public_id, action: 'detain', sectionId: sec['Class 9A'], remarks: 'Long absence, repeats the year' },
      { studentId: S.c.public_id, action: 'complete' },
      { studentId: S.l.public_id, action: 'leave', remarks: 'Moved to Hyderabad (TC issued)' },
    ]);
    expect(r.body.data.saved).toBe(4);
    const c9 = (await as(dev).get(`/api/v1/year-end/sections/${sec['Class 9A']}?toYearId=${toId}`)).body.data.students;
    expect(c9.find((s: any) => s.name === 'Promo')).toMatchObject({ action: 'promote', classId: cls['Class 10'] });
    expect(c9.find((s: any) => s.name === 'Detain')).toMatchObject({ action: 'detain', classId: cls['Class 9'], remarks: 'Long absence, repeats the year' });
  });

  it('can undo a decision before the switch', async () => {
    await decide([{ studentId: S.p.public_id, action: 'pending' }]);
    const p = (await as(dev).get(`/api/v1/year-end/sections/${sec['Class 9A']}?toYearId=${toId}`)).body.data.students.find((s: any) => s.name === 'Promo');
    expect(p).toMatchObject({ decided: false, classId: null });
    await decide([{ studentId: S.p.public_id, action: 'promote', classId: cls['Class 10'], sectionId: sec['Class 10A'] }]);
  });

  it('gives roll numbers alphabetically, by admission number, or by hand without duplicates', async () => {
    const auto = await as(dev).post('/api/v1/year-end/rolls/auto', { yearId: toId, sectionId: sec['Class 9A'], mode: 'alpha' });
    expect(auto.body.data.find((r: any) => r.name === 'Detain').rollNo).toMatch(/^\d+$/);
    const list = auto.body.data;
    if (list.length >= 2) {
      const dup = await as(dev).put('/api/v1/year-end/rolls', { yearId: toId, sectionId: sec['Class 9A'], rolls: [{ studentId: list[0].studentId, rollNo: '7' }, { studentId: list[1].studentId, rollNo: '7' }] });
      expect(dup.body.code).toBe('VALIDATION_FAILED');
    }
    const one = await as(dev).put('/api/v1/year-end/rolls', { yearId: toId, sectionId: sec['Class 9A'], rolls: [{ studentId: S.d.public_id, rollNo: '42' }] });
    expect(one.body.data.find((r: any) => r.name === 'Detain').rollNo).toBe('42');
  });

  it('copies fee setup exactly (dates moved by the year gap) and bell schedules, once', async () => {
    const r = await as(accountant).post('/api/v1/fees/setup/copy', { fromYearId: fromId, toYearId: toId });
    expect(r.status).toBe(201);
    expect(r.body.data.classFees.find((c: any) => c.className === 'Class 9').amount).toBe('20000.00');
    expect((await as(accountant).post('/api/v1/fees/setup/copy', { fromYearId: fromId, toYearId: toId })).body.code).toBe('ALREADY_SET_UP');
    const fromPlan = (await as(accountant).get('/api/v1/fees/setup')).body.data.plans.find((p: any) => p.installments.length);
    if (fromPlan) {
      const toPlan = r.body.data.plans.find((p: any) => p.plan_key === fromPlan.plan_key);
      expect(new Date(toPlan.installments[0].due_date).getUTCFullYear()).toBe(new Date(fromPlan.installments[0].due_date).getUTCFullYear() + 4);
    }
    await as(dev).post('/api/v1/timetable/groups', { name: 'YE Primary' });
    const t = await as(dev).post('/api/v1/timetable/copy-schedules', { fromYearId: fromId, toYearId: toId });
    expect(t.body.data.groups.map((g: any) => g.name)).toContain('YE Primary');
  });

  it('warns before switching, then switches: old year closed, leavers inactive, next year current', async () => {
    const chk = (await as(dev).get(`/api/v1/year-end/switch-check?toYearId=${toId}`)).body.data;
    expect(chk.counts).toMatchObject({ promoted: expect.any(Number), leaving: expect.any(Number) });
    expect(chk.warnings.noClassTeacher.length).toBeGreaterThan(0);
    expect((await as(dev).post('/api/v1/year-end/switch', { toYearId: toId })).body.code).toBe('SWITCH_WARNINGS');
    expect((await as(accountant).post('/api/v1/year-end/switch', { toYearId: toId, acceptWarnings: true })).status).toBe(403);
    const r = await as(dev).post('/api/v1/year-end/switch', { toYearId: toId, acceptWarnings: true });
    expect(r.body.data).toMatchObject({ current: '2030-31', studentsMadeInactive: expect.any(Number) });
    const st = await db.selectFrom('students').select(['first_name', 'status', 'inactive_reason']).where('public_id', 'in', [S.c.public_id, S.l.public_id, S.p.public_id]).execute();
    expect(st.find((x) => x.first_name === 'Complete')).toMatchObject({ status: 'inactive', inactive_reason: 'Completed school' });
    expect(st.find((x) => x.first_name === 'Leaver')).toMatchObject({ status: 'inactive', inactive_reason: 'Moved to Hyderabad (TC issued)' });
    expect(st.find((x) => x.first_name === 'Promo')?.status).toBe('active');
    const y = await db.selectFrom('academic_years').select(['status', 'is_current']).where('id', '=', fromId).executeTakeFirstOrThrow();
    expect(y).toMatchObject({ status: 'closed', is_current: 0 });
    const hist = (await as(dev).get(`/api/v1/students/${S.d.public_id}`)).body.data;
    expect(hist.class_name).toBe('Class 9');
    expect(hist.history.find((h: any) => h.status === 'detained').remarks).toBe('Long absence, repeats the year');
  });

  it('locks the closed year but keeps its dues payable', async () => {
    expect((await as(dev).put('/api/v1/teaching/grid', { yearId: fromId, classTeachers: [] , assignments: [{ sectionId: sec['Class 9A'], subjectId: 1, staffId: null }] })).body.code).toBe('YEAR_CLOSED');
    expect((await as(accountant).put(`/api/v1/fees/setup/class-fees?yearId=${fromId}`, { items: [{ classId: cls['Class 9'], amount: 1 }] })).body.code).toBe('YEAR_CLOSED');
    const f = (await as(accountant).get(`/api/v1/students/${S.d.public_id}/fees`)).body.data;
    expect(f.totals.previousYears).toBe(20000);
    const pay = await as(accountant).post('/api/v1/payments', { studentId: S.d.public_id, paymentDate: new Date().toISOString().slice(0, 10), method: 'cash', lines: [{ category: 'tuition', academicYearId: fromId, amount: 5000 }] });
    expect(pay.status).toBe(201);
    expect(pay.body.data.line_items[0].year).not.toBe('2030-31');
    S.oldReceipt = pay.body.data.public_id;
  });

  it('waivers: closed years only, admin only, latest unpaid first; Fee = Paid + Waived + Still due', async () => {
    expect((await as(accountant).post(`/api/v1/students/${S.d.public_id}/waivers`, { academicYearId: fromId, amount: 1000, reason: 'Family hardship' })).status).toBe(403);
    expect((await as(dev).post(`/api/v1/students/${S.d.public_id}/waivers`, { academicYearId: toId, amount: 1000, reason: 'Wrong year test' })).body.code).toBe('YEAR_NOT_CLOSED');
    expect((await as(dev).post(`/api/v1/students/${S.d.public_id}/waivers`, { academicYearId: fromId, amount: 999999, reason: 'Too much test' })).body.code).toBe('VALIDATION_FAILED');
    const r = (await as(dev).post(`/api/v1/students/${S.d.public_id}/waivers`, { academicYearId: fromId, amount: 3000, reason: 'Family hardship, approved by principal' })).body.data;
    expect(r.totals.previousYears).toBe(20000 - 5000 - 3000);
    expect(r.waivers[0]).toMatchObject({ amount: '3000.00', reason: 'Family hardship, approved by principal' });
    const old = r.items.filter((i: any) => i.academic_year_id === fromId);
    const fee = old.reduce((t: number, i: any) => t + Number(i.amount), 0), paid = old.reduce((t: number, i: any) => t + Number(i.paid_amount), 0);
    const waived = old.reduce((t: number, i: any) => t + Number(i.waived_amount), 0), due = old.reduce((t: number, i: any) => t + Number(i.balance), 0);
    expect(fee).toBe(paid + waived + due);
    const over = await as(accountant).post('/api/v1/payments', { studentId: S.d.public_id, paymentDate: new Date().toISOString().slice(0, 10), method: 'cash', lines: [{ category: 'tuition', academicYearId: fromId, amount: 12001 }] });
    expect(over.body.code).toBe('VALIDATION_FAILED');
  });

  it('only the Institution Admin can void a receipt for a closed year', async () => {
    // Collected after the switch, but it pays closed-year fees
    const r = await as(accountant).post(`/api/v1/payments/${S.oldReceipt}/void`, { reason: 'Entered by mistake' });
    expect(r.body.code).toBe('CLOSED_YEAR_RECEIPT');
    const ok = await as(dev).post(`/api/v1/payments/${S.oldReceipt}/void`, { reason: 'Entered by mistake' });
    expect(ok.body.data.status).toBe('void');
    expect((await as(accountant).get(`/api/v1/students/${S.d.public_id}/fees`)).body.data.totals.previousYears).toBe(20000 - 3000);
  });
});
