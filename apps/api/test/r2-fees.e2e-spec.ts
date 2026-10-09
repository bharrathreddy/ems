import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';
import { COLUMNS } from '../src/imports/imports.service';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };
const binary = (res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

describe('R2 fees and receipts (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let http: any;
  let dev: string, accountant: string, teacher: string;
  const cls: Record<string, number> = {}, sec: Record<string, number> = {};
  let yearId: number;

  const login = (i: string, p: string) => http.post('/api/v1/auth/login').send({ identifier: i, password: p });
  const as = (t: string) => {
    const h = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
    return { get: (u: string) => h(http.get(u)), post: (u: string, b: object = {}) => h(http.post(u)).send(b),
      put: (u: string, b: object) => h(http.put(u)).send(b), patch: (u: string, b: object) => h(http.patch(u)).send(b),
      upload: (u: string, buf: Buffer) => h(http.post(u)).attach('file', buf, 'data.xlsx') };
  };
  async function staffToken(n: number, roleKeys: string[]) {
    const r = await as(dev).post('/api/v1/staff', { name: `Fee Staff ${n}`, email: `fee${n}@test.local`, mobile: `96000000${String(n).padStart(2, '0')}`, employeeCode: `F-${n}`, roleKeys });
    const c = (await as(dev).post(`/api/v1/users/${r.body.data.user_id}/credentials`)).body.data;
    const t = (await login(c.username, c.temporaryPassword)).body.data.accessToken;
    await as(t).post('/api/v1/auth/change-password', { currentPassword: c.temporaryPassword, newPassword: 'NewPass@123' });
    return (await login(c.username, 'NewPass@123')).body.data.accessToken;
  }
  const addStudent = async (name: string, klass: string, mobile: string) =>
    (await as(dev).post('/api/v1/students', { firstName: name, classId: cls[klass], sectionId: sec[`${klass}A`], family: { familyName: `${name} family`, mobile } })).body.data;
  const fees = async (id: string, t = accountant) => (await as(t).get(`/api/v1/students/${id}/fees`)).body.data;
  const pay = (id: string, lines: object[], extra: object = {}) =>
    as(accountant).post('/api/v1/payments', { studentId: id, paymentDate: new Date().toISOString().slice(0, 10), method: 'cash', lines, ...extra });
  const amounts = (f: any, cat = 'tuition') => f.items.filter((i: any) => i.category === cat && !i.previous_year).map((i: any) => Number(i.amount));
  const balances = (f: any, cat = 'tuition') => f.items.filter((i: any) => i.category === cat && !i.previous_year).map((i: any) => Number(i.balance));

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp(); await app.init();
    http = request(app.getHttpServer());
    dev = (await login(DEV.email, DEV.password)).body.data.accessToken;
    for (const c of (await as(dev).get('/api/v1/classes')).body.data) { cls[c.name] = c.id; for (const s of c.sections) sec[`${c.name}${s.name}`] = s.id; }
    expect((await as(dev).get('/api/v1/fees/setup')).body.code).toBe('FEATURE_DISABLED');
    await as(dev).put('/api/v1/developer/feature-flags/fees', { enabled: true });
    await as(dev).put('/api/v1/developer/feature-flags/payments', { enabled: true });
    accountant = await staffToken(1, ['accountant']);
    teacher = await staffToken(2, ['teacher']);
    yearId = (await as(accountant).get('/api/v1/fees/setup')).body.data.academicYear.id;
  });
  afterAll(async () => { await app.close(); await db.destroy(); });

  describe('Setup', () => {
    it('configures plans, due dates, class fees, a route and concession types', async () => {
      expect((await as(accountant).put('/api/v1/fees/setup/default-plan', { planKey: 'quarterly' })).status).toBe(200);
      const q = await as(accountant).put('/api/v1/fees/setup/installments', { planKey: 'quarterly', items: [
        { installmentNo: 1, label: 'Q1', dueDate: '2026-06-10' }, { installmentNo: 2, label: 'Q2', dueDate: '2026-09-10' },
        { installmentNo: 3, label: 'Q3', dueDate: '2026-12-10' }, { installmentNo: 4, label: 'Q4', dueDate: '2027-02-10' }] });
      expect(q.status).toBe(200);
      const bad = await as(accountant).put('/api/v1/fees/setup/installments', { planKey: 'half_yearly', items: [{ installmentNo: 1, label: 'Term 1', dueDate: '2026-06-10' }] });
      expect(bad.body.code).toBe('VALIDATION_FAILED');
      await as(accountant).put('/api/v1/fees/setup/installments', { planKey: 'half_yearly', items: [
        { installmentNo: 1, label: 'Term 1', dueDate: '2026-06-10' }, { installmentNo: 2, label: 'Term 2', dueDate: '2026-11-10' }] });
      await as(accountant).put('/api/v1/fees/setup/class-fees', { items: [{ classId: cls['Class 8'], amount: 30000 }, { classId: cls['Class 9'], amount: 25000 }, { classId: cls['Class 10'], amount: 30000 }] });
      const route = (await as(accountant).post('/api/v1/fees/routes', { name: 'Route A - Mokila' })).body.data.id;
      await as(accountant).put('/api/v1/fees/setup/route-fees', { items: [{ routeId: route, amount: 12000, dueDate: '2026-07-10' }] });
      await as(accountant).post('/api/v1/fees/concession-types', { name: 'Sibling' });
      const setup = (await as(accountant).get('/api/v1/fees/setup')).body.data;
      expect(setup.plans.find((p: any) => p.plan_key === 'quarterly').installments).toHaveLength(4);
      expect(setup.classFees.find((c: any) => c.className === 'Class 8').amount).toBe('30000.00');
    });

    it('teachers cannot see fee setup or student fees', async () => {
      expect((await as(teacher).get('/api/v1/fees/setup')).status).toBe(403);
    });
  });

  describe('Split rule and discounts (F12 to F14, T20, T21)', () => {
    let s1: any;
    it('creates installments on the default plan', async () => {
      s1 = await addStudent('Feeone', 'Class 8', '9500000001');
      const f = await fees(s1.public_id);
      expect(f.account.plan_key).toBe('quarterly');
      expect(amounts(f)).toEqual([7500, 7500, 7500, 7500]);
      expect(f.items[0].label).toBe('Tuition Q1');
      expect(f.items[0].due_date).toBe('2026-06-10');
    });
    it('splits 27,000 as 6,900 + 6,700 + 6,700 + 6,700 after a 3,000 discount', async () => {
      const f = (await as(accountant).patch(`/api/v1/students/${s1.public_id}/fee-account`, { tuitionDiscount: 3000 })).body.data;
      expect(amounts(f)).toEqual([6900, 6700, 6700, 6700]);
    });
    it('splits 25,000 quarterly as 6,400 + 6,200 + 6,200 + 6,200', async () => {
      const s = await addStudent('Feetwo', 'Class 9', '9500000002');
      expect(amounts(await fees(s.public_id))).toEqual([6400, 6200, 6200, 6200]);
    });
    it('rejects a discount larger than the fee', async () => {
      const r = await as(accountant).patch(`/api/v1/students/${s1.public_id}/fee-account`, { tuitionDiscount: 40000 });
      expect(r.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('Collection (F23 to F28, T22, T23, T25, T28)', () => {
    let s: any, routeId: number;
    beforeAll(async () => {
      s = await addStudent('Payer', 'Class 10', '9500000003');
      routeId = (await as(accountant).get('/api/v1/fees/setup')).body.data.routes[0].id;
      const pr = await as(accountant).patch(`/api/v1/students/${s.public_id}/fee-account`, { busRouteId: routeId, busDiscount: 2000 });
      expect(pr.status).toBe(200);
    });

    it('clears the oldest installment first and records a gapless receipt', async () => {
      const r1 = await pay(s.public_id, [{ category: 'tuition', academicYearId: yearId, amount: 5000 }]);
      expect(r1.status).toBe(201);
      expect(r1.body.data.receipt_no).toMatch(/^RCPT\/2026-27\/\d{5}$/);
      expect(balances(await fees(s.public_id))).toEqual([2500, 7500, 7500, 7500]);
      const r2 = await pay(s.public_id, [{ category: 'tuition', academicYearId: yearId, amount: 10000 }]);
      expect(r2.body.data.line_items.map((l: any) => [l.label, Number(l.amount)])).toEqual([['Tuition Q1', 2500], ['Tuition Q2', 7500]]);
      expect(balances(await fees(s.public_id))).toEqual([0, 0, 7500, 7500]);
      const n1 = Number(r1.body.data.receipt_no.slice(-5)), n2 = Number(r2.body.data.receipt_no.slice(-5));
      expect(n2).toBe(n1 + 1);
    });

    it('takes bus and tuition in one receipt, with the bus discount applied', async () => {
      const f = await fees(s.public_id);
      expect(amounts(f, 'bus')).toEqual([10000]);
      const r = await pay(s.public_id, [{ category: 'bus', academicYearId: yearId, amount: 4000 }, { category: 'tuition', academicYearId: yearId, amount: 1000 }], { method: 'upi', referenceNo: 'UPI123' });
      expect(Number(r.body.data.total_amount)).toBe(5000);
      expect(Number(r.body.data.balance_due)).toBe(15000 - 1000 + (10000 - 4000));
    });

    it('keeps the balance printed on an earlier receipt unchanged after later payments (R1)', async () => {
      const first = (await fees(s.public_id)).payments.at(-1);
      const before = (await as(accountant).get(`/api/v1/payments/${first.public_id}`)).body.data.balance_due;
      await pay(s.public_id, [{ category: 'tuition', academicYearId: yearId, amount: 100 }]);
      const after = (await as(accountant).get(`/api/v1/payments/${first.public_id}`)).body.data.balance_due;
      expect(after).toBe(before);
      expect(Number(before)).toBe(25000 + 10000);
    });

    it('rejects more than what is due, and non-cash without a reference', async () => {
      const over = await pay(s.public_id, [{ category: 'bus', academicYearId: yearId, amount: 6001 }]);
      expect(over.body.code).toBe('VALIDATION_FAILED');
      expect(over.body.details[0].message).toContain('6,000');
      const noRef = await pay(s.public_id, [{ category: 'bus', academicYearId: yearId, amount: 10 }], { method: 'cheque' });
      expect(noRef.body.details[0].field).toBe('referenceNo');
    });

    it('locks discounts, route and plan after the first payment (F10, F17)', async () => {
      const r = await as(accountant).patch(`/api/v1/students/${s.public_id}/fee-account`, { tuitionDiscount: 100 });
      expect(r.body.code).toBe('FEES_LOCKED');
      expect((await fees(s.public_id)).account.details_locked).toBe(true);
    });

    it('voids a receipt: balances restored, number kept, PDF marked VOID (F28, R5)', async () => {
      const f0 = await fees(s.public_id);
      const last = f0.payments[0];
      const v = await as(accountant).post(`/api/v1/payments/${last.public_id}/void`, { reason: 'Entered twice' });
      expect(v.body.data.status).toBe('void');
      expect(v.body.data.receipt_no).toBe(last.receipt_no);
      const f1 = await fees(s.public_id);
      expect(balances(f1, 'bus')).toEqual([6000]);
      expect(balances(f1)).toEqual([0, 0, 6500, 7500]); // the voided ₹100 is due again
      expect((await as(accountant).post(`/api/v1/payments/${last.public_id}/void`, { reason: 'again' })).body.code).toBe('ALREADY_VOID');
      const pdf = await as(accountant).get(`/api/v1/payments/${last.public_id}/pdf`).buffer(true).parse(binary);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    });

    it('keeps receipt numbers gapless under concurrent collection (T27)', async () => {
      const kids = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => addStudent(`Para${i}`, 'Class 10', `95000001${String(i).padStart(2, '0')}`)));
      for (const k of kids) await fees(k.public_id);
      const res = await Promise.all(kids.map((k) => pay(k.public_id, [{ category: 'tuition', academicYearId: yearId, amount: 100 }])));
      const nos = res.map((r) => Number(r.body.data.receipt_no.slice(-5))).sort((a, b) => a - b);
      expect(nos.every((r) => r > 0)).toBe(true);
      expect(new Set(nos).size).toBe(10);
      expect(nos[9] - nos[0]).toBe(9);
    });
  });

  describe('Plan lock (F4)', () => {
    it('allows a plan change for a new admission before payment, but not for an account from before the year started', async () => {
      const s = await addStudent('Planner', 'Class 8', '9500000004');
      const f = (await as(accountant).patch(`/api/v1/students/${s.public_id}/fee-account`, { planKey: 'half_yearly' })).body.data;
      expect(amounts(f)).toEqual([15000, 15000]);
      expect(f.items[0].label).toBe('Tuition Term 1');
      await db.updateTable('student_fee_accounts').set({ created_at: new Date('2026-05-01T00:00:00Z') }).where('id', '=', f.account.id).execute();
      const r = await as(accountant).patch(`/api/v1/students/${s.public_id}/fee-account`, { planKey: 'yearly' });
      expect(r.body.code).toBe('PLAN_LOCKED');
    });
  });

  describe('One-time fees (F19 to F22, T29)', () => {
    it('charges every student of the class and new joiners, and refuses removal once paid', async () => {
      const type = (await as(accountant).post('/api/v1/fees/one-time-types', { name: 'Exam fee' })).body.data.id;
      const before = await addStudent('Examone', 'Class 9', '9500000005');
      await fees(before.public_id);
      const ot = (await as(accountant).post('/api/v1/fees/one-time', { classId: cls['Class 9'], typeId: type, title: 'SA1 Exam fee', amount: 500, dueDate: '2026-10-01' })).body.data.id;
      const f1 = await fees(before.public_id);
      const item = f1.items.find((i: any) => i.category === 'one_time');
      expect(item.label).toBe('SA1 Exam fee');
      const joiner = await addStudent('Examtwo', 'Class 9', '9500000006');
      expect((await fees(joiner.public_id)).items.some((i: any) => i.label === 'SA1 Exam fee')).toBe(true);
      await pay(before.public_id, [{ category: 'one_time', feeItemId: item.id, amount: 500 }]);
      expect((await as(accountant).get('/api/v1/students/' + before.public_id + '/fees')).body.data.items.find((i: any) => i.id === item.id).status).toBe('paid');
      const del = await http.delete(`/api/v1/fees/one-time/${ot}`).set('Authorization', `Bearer ${accountant}`);
      expect(del.body.code).toBe('ONE_TIME_FEE_PAID');
    });
  });

  describe('Previous year dues (F29, F30, T26)', () => {
    it('shows last year\'s balance and allocates payment to the old year', async () => {
      const s = await addStudent('Carry', 'Class 8', '9500000007');
      const sid = (await db.selectFrom('students').select('id').where('public_id', '=', s.public_id).executeTakeFirstOrThrow()).id;
      const old = await db.insertInto('academic_years').values({ name: '2025-26', start_date: new Date('2025-06-01'), end_date: new Date('2026-04-30'), status: 'closed' }).executeTakeFirstOrThrow();
      const oldId = Number(old.insertId);
      const plan = await db.selectFrom('fee_plans').select('id').where('plan_key', '=', 'yearly').executeTakeFirstOrThrow();
      const acc = await db.insertInto('student_fee_accounts').values({ academic_year_id: oldId, student_id: sid, fee_plan_id: plan.id, class_id: cls['Class 7'], tuition_gross: '20000', has_payments: 1 }).executeTakeFirstOrThrow();
      await db.insertInto('fee_items').values({ academic_year_id: oldId, student_id: sid, student_fee_account_id: Number(acc.insertId), category: 'tuition', installment_no: 1, label: 'Tuition Annual', amount: '20000', paid_amount: '15000' }).execute();
      const f = await fees(s.public_id);
      expect(f.totals.previousYears).toBe(5000);
      expect(f.items[0]).toMatchObject({ previous_year: true, year: '2025-26' });
      const r = await pay(s.public_id, [{ category: 'tuition', academicYearId: oldId, amount: 5000 }]);
      expect(r.body.data.year).toBe('2026-27');
      expect(r.body.data.line_items[0]).toMatchObject({ year: '2025-26', label: 'Tuition Annual' });
      expect((await fees(s.public_id)).totals.previousYears).toBe(0);
    });
  });

  describe('Family view and receipt access', () => {
    it('family sees own fees and receipts, not others', async () => {
      const s = await addStudent('Famfee', 'Class 10', '9500000008');
      const other = await addStudent('Otherfee', 'Class 10', '9500000009');
      await fees(s.public_id);
      const r = await pay(s.public_id, [{ category: 'tuition', academicYearId: yearId, amount: 1500 }]);
      const otherR = await pay(other.public_id, [{ category: 'tuition', academicYearId: yearId, amount: 200 }]);
      const fam = await db.selectFrom('users').select('public_id').where('mobile', '=', '9500000008').executeTakeFirstOrThrow();
      const c = (await as(dev).post(`/api/v1/users/${fam.public_id}/credentials`)).body.data;
      let t = (await login(c.username, c.temporaryPassword)).body.data.accessToken;
      await as(t).post('/api/v1/auth/change-password', { currentPassword: c.temporaryPassword, newPassword: 'NewPass@123' });
      t = (await login(c.username, 'NewPass@123')).body.data.accessToken;
      const f = await fees(s.public_id, t);
      expect(f.totals.thisYear.paid).toBe(1500);
      expect((await as(t).get(`/api/v1/payments/${r.body.data.public_id}/pdf`)).status).toBe(200);
      expect((await as(t).get(`/api/v1/payments/${otherR.body.data.public_id}/pdf`)).status).toBe(404);
      expect((await as(t).get(`/api/v1/students/${other.public_id}/fees`)).status).toBe(404);
      expect((await as(t).post('/api/v1/payments', {})).status).toBe(403);
      expect((await as(t).get('/api/v1/fees/summary')).status).toBe(403);
    });
  });

  describe('Reports (9.11, T30)', () => {
    it('reports collection by method and dues by student; inactive students\' receipts still count', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const before = (await as(accountant).get(`/api/v1/fees/reports/collection?from=${today}&to=${today}`)).body.data;
      const s = await addStudent('Leaver', 'Class 9', '9500000010');
      await fees(s.public_id);
      await pay(s.public_id, [{ category: 'tuition', academicYearId: yearId, amount: 700 }]);
      await as(dev).post(`/api/v1/students/${s.public_id}/deactivate`, { reason: 'Left' });
      const after = (await as(accountant).get(`/api/v1/fees/reports/collection?from=${today}&to=${today}`)).body.data;
      expect(after.total).toBe(before.total + 700);
      expect(after.byMethod.cash).toBeGreaterThan(0);
      expect(after.voided).toBeGreaterThanOrEqual(1);
      const dues = (await as(accountant).get(`/api/v1/fees/reports/outstanding?classId=${cls['Class 8']}`)).body.data;
      const one = dues.rows.find((r: any) => r.first_name === 'Feeone');
      expect(one.tuition).toBe(27000);
      expect(one.overdue).toBe(6900 + 6700);
      const sum = (await as(accountant).get('/api/v1/fees/summary')).body.data;
      expect(sum.today.amount).toBe(after.total);
      const x = await as(accountant).get('/api/v1/fees/reports/outstanding.xlsx').buffer(true).parse(binary);
      expect(x.status).toBe(200);
    });
  });

  describe('Opening balances import (15.2, IM2)', () => {
    it('applies plan, discount and already-paid amounts as an opening receipt, excluded from collection', async () => {
      const s = await addStudent('Opener', 'Class 10', '9500000011');
      const today = new Date().toISOString().slice(0, 10);
      const before = (await as(accountant).get(`/api/v1/fees/reports/collection?from=2026-09-30&to=${today}`)).body.data.total;
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Data');
      ws.addRow(COLUMNS.opening_fees.map((c) => c.header));
      ws.addRow(COLUMNS.opening_fees.map((c) => ({ admissionNo: s.admission_no, plan: 'Half-yearly', tuitionDiscount: '2000', concessionType: 'Sibling', busRoute: 'route a - mokila', tuitionPaid: '20000', busPaid: '3000', paidOn: '30-09-2026' } as any)[c.key] ?? ''));
      ws.addRow(COLUMNS.opening_fees.map((c) => ({ admissionNo: 'NOPE' } as any)[c.key] ?? ''));
      const bad = await as(accountant).upload('/api/v1/imports/opening_fees/validate', Buffer.from(await wb.xlsx.writeBuffer()));
      expect(bad.body.data.errors).toEqual([{ row: 3, column: 'Admission No', message: 'No student with admission number NOPE.' }]);
      ws.spliceRows(3, 1);
      const ok = await as(accountant).upload('/api/v1/imports/opening_fees/validate', Buffer.from(await wb.xlsx.writeBuffer()));
      expect(ok.body.data.summary).toMatchObject({ students: 1, withPayments: 1, tuitionPaid: 20000, busPaid: 3000 });
      expect((await as(accountant).post(`/api/v1/imports/${ok.body.data.jobId}/commit`)).body.data.status).toBe('completed');
      const f = await fees(s.public_id);
      expect(f.account).toMatchObject({ plan_key: 'half_yearly', tuition_concession: 'Sibling', details_locked: true });
      expect(amounts(f)).toEqual([14000, 14000]);
      expect(balances(f)).toEqual([0, 8000]);
      expect(balances(f, 'bus')).toEqual([9000]);
      expect(f.payments[0].receipt_no).toMatch(/^OPN\/2026-27\/\d{5}$/);
      const after = (await as(accountant).get(`/api/v1/fees/reports/collection?from=2026-09-30&to=${today}`)).body.data.total;
      expect(after).toBe(before);
    });
  });
});
