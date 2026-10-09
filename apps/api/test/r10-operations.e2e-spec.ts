import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';
import { addDays } from '../src/attendance/calendar';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };
const binary = (res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

describe('Transport, stock and sales (e2e)', () => {
  let app: INestApplication; let db: Database; let http: any;
  let dev: string, driver: string, family: string, transportMgr: string, reception: string, accountant: string, teacher: string;
  const S: Record<string, any> = {}; const K: Record<string, any> = {}; const cls: Record<string, number> = {}; const sec: Record<string, number> = {};
  let today: string, routeA: number, routeB: number;

  const login = (i: string, p: string) => http.post('/api/v1/auth/login').send({ identifier: i, password: p });
  const as = (t: string) => {
    const h = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
    return { get: (u: string) => h(http.get(u)), post: (u: string, b: object = {}) => h(http.post(u)).send(b), put: (u: string, b: object) => h(http.put(u)).send(b),
      patch: (u: string, b: object) => h(http.patch(u)).send(b), file: (u: string) => h(http.get(u)).buffer(true).parse(binary) };
  };
  async function activate(identifier: string, userId: string) {
    const c = (await as(dev).post(`/api/v1/users/${userId}/credentials`)).body.data;
    const t = (await login(identifier, c.temporaryPassword)).body.data.accessToken;
    await as(t).post('/api/v1/auth/change-password', { currentPassword: c.temporaryPassword, newPassword: 'NewPass@123' });
    return (await login(identifier, 'NewPass@123')).body.data.accessToken as string;
  }
  const staff = (name: string, mobile: string, code: string, roleKeys: string[]) =>
    as(dev).post('/api/v1/staff', { name, email: `${code.toLowerCase()}@test.local`, mobile, employeeCode: code, roleKeys }).then((r) => r.body.data);
  const sheetRows = async (buf: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any); const out: string[][] = []; wb.worksheets[0].eachRow((r) => out.push((r.values as any[]).slice(1).map((v) => String(v ?? '')))); return out; };

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp(); await app.init(); http = request(app.getHttpServer());
    dev = (await login(DEV.email, DEV.password)).body.data.accessToken;
    for (const c of (await as(dev).get('/api/v1/classes')).body.data) { cls[c.name] = c.id; for (const s of c.sections) sec[`${c.name}${s.name}`] = s.id; }
    S.driver = await staff('Raju Driver', '9660100001', 'D-1', ['driver']);
    S.tm = await staff('Tara Transport', '9660100002', 'TM-1', ['transport_manager']);
    S.rec = await staff('Rekha Reception', '9660100003', 'R-1', ['receptionist']);
    S.acc = await staff('Anil Accounts', '9660100004', 'A-1', ['accountant']);
    S.teacher = await staff('Ravi Teacher', '9660100005', 'T-1', ['teacher']);
    driver = await activate('9660100001', S.driver.user_id);
    transportMgr = await activate('9660100002', S.tm.user_id);
    reception = await activate('9660100003', S.rec.user_id);
    accountant = await activate('9660100004', S.acc.user_id);
    teacher = await activate('9660100005', S.teacher.user_id);
    const kid = (n: string, k: string, mobile: string) => as(dev).post('/api/v1/students', { firstName: n, classId: cls[k], sectionId: sec[`${k}A`], family: { familyName: `${n} family`, fatherName: `${n} Father`, mobile } }).then((r) => r.body.data);
    K.a = await kid('Asha', 'Class 3', '9660200001');
    K.b = await kid('Bala', 'Class 3', '9660200002');
    K.c = await kid('Chandu', 'Class 5', '9660200003');
    family = await activate('9660200001', K.a.family_user_id);
    today = (await as(dev).get('/api/v1/attendance/overview')).body?.data?.today ?? new Date().toISOString().slice(0, 10);
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('is off until switched on; transport and stock are separate switches', async () => {
    expect((await as(transportMgr).get('/api/v1/transport/routes')).body.code).toBe('FEATURE_DISABLED');
    expect((await as(reception).get('/api/v1/inventory/items')).body.code).toBe('FEATURE_DISABLED');
    for (const m of ['fees', 'payments', 'expenses', 'transport', 'inventory']) await as(dev).put(`/api/v1/developer/feature-flags/${m}`, { enabled: true });
    expect((await as(transportMgr).get('/api/v1/transport/routes')).status).toBe(200);
  });

  describe('Transport', () => {
    beforeAll(async () => {
      routeA = (await as(dev).post('/api/v1/fees/routes', { name: 'Route A - Mokila' })).body.data.id;
      routeB = (await as(dev).post('/api/v1/fees/routes', { name: 'Route B - Shankarpalli' })).body.data.id;
      await as(dev).put('/api/v1/fees/setup/default-plan', { planKey: 'yearly' });
      await as(dev).put('/api/v1/fees/setup/installments', { planKey: 'yearly', items: [{ installmentNo: 1, label: 'Annual', dueDate: addDays(today, 30) }] });
      await as(dev).put('/api/v1/fees/setup/class-fees', { items: [{ classId: cls['Class 3'], amount: 20000 }, { classId: cls['Class 5'], amount: 22000 }] });
      await as(dev).put('/api/v1/fees/setup/route-fees', { items: [{ routeId: routeA, amount: 12000 }, { routeId: routeB, amount: 9000 }] });
      for (const [k, r] of [['a', routeA], ['b', routeA], ['c', routeB]] as const) {
        await as(dev).get(`/api/v1/students/${K[k].public_id}/fees`);
        const res = await as(dev).patch(`/api/v1/students/${K[k].public_id}/fee-account`, { busRouteId: r });
        if (res.status !== 200) throw new Error(JSON.stringify(res.body));
      }
    });

    it('adds vehicles with a driver; registration numbers are unique; only transport managers edit', async () => {
      const r = await as(transportMgr).post('/api/v1/transport/vehicles', { regNo: 'ts 07 ub 1234', name: 'Tata Starbus', seats: 40, driverStaffId: S.driver.public_id, helperName: 'Lakshmi', helperMobile: '9660300001' });
      expect(r.status).toBe(201);
      expect(r.body.data[0]).toMatchObject({ regNo: 'TS 07 UB 1234', seats: 40, driver: { name: 'Raju Driver', mobile: '9660100001' } });
      expect((await as(transportMgr).post('/api/v1/transport/vehicles', { regNo: 'TS 07 UB 1234' })).body.details[0].field).toBe('regNo');
      expect((await as(accountant).post('/api/v1/transport/vehicles', { regNo: 'TS 07 UB 9999' })).status).toBe(403);
      await as(transportMgr).post('/api/v1/transport/vehicles', { regNo: 'TS 07 UB 5678', seats: 30 });
      const v = (await as(transportMgr).get('/api/v1/transport/vehicles')).body.data;
      S.v1 = v.find((x: any) => x.regNo === 'TS 07 UB 1234').id; S.v2 = v.find((x: any) => x.regNo === 'TS 07 UB 5678').id;
      expect((await as(transportMgr).put(`/api/v1/transport/routes/${routeA}/vehicle`, { vehicleId: S.v1 })).status).toBe(200);
      await as(transportMgr).put(`/api/v1/transport/routes/${routeB}/vehicle`, { vehicleId: S.v2 });
    });

    it('keeps stops in order with pickup and drop times, and counts students per stop', async () => {
      const bad = await as(transportMgr).put(`/api/v1/transport/routes/${routeA}/stops`, { stops: [{ name: 'Mokila X Roads', pickupTime: '7.15' }] });
      expect(bad.body.details[0]).toMatchObject({ field: 'stops.0.pickupTime' });
      const r = await as(transportMgr).put(`/api/v1/transport/routes/${routeA}/stops`, { stops: [
        { name: 'Mokila X Roads', landmark: 'Bus shelter', pickupTime: '07:15', dropTime: '16:40' }, { name: 'Shankarpalli Bus Stand', pickupTime: '07:35', dropTime: '16:20' }] });
      const route = r.body.data.routes.find((x: any) => x.id === routeA);
      expect(route.stops.map((s: any) => [s.name, s.pickupTime, s.dropTime])).toEqual([['Mokila X Roads', '07:15', '16:40'], ['Shankarpalli Bus Stand', '07:35', '16:20']]);
      expect(route).toMatchObject({ students: 2, withoutStop: 2, vehicle: { regNo: 'TS 07 UB 1234', driverName: 'Raju Driver' } });
      S.stop1 = route.stops[0].id; S.stop2 = route.stops[1].id;
      expect((await as(transportMgr).put(`/api/v1/transport/routes/${routeA}/stops`, { stops: [{ name: 'Gate' }, { name: 'gate' }] })).body.details[0].field).toBe('stops.1.name');
    });

    it('assigns each bus student a stop on their own route', async () => {
      const wrong = await as(transportMgr).put(`/api/v1/transport/routes/${routeA}/students`, { items: [{ studentId: K.c.public_id, stopId: S.stop1 }] });
      expect(wrong.body.details[0].message).toMatch(/not on this route/);
      const r = await as(transportMgr).put(`/api/v1/transport/routes/${routeA}/students`, { items: [{ studentId: K.a.public_id, stopId: S.stop2 }, { studentId: K.b.public_id, stopId: S.stop1 }] });
      expect(r.body.data.map((x: any) => [x.name, x.stopId])).toEqual([['Bala', S.stop1], ['Asha', S.stop2]]); // ordered by stop
      const route = (await as(transportMgr).get('/api/v1/transport/routes')).body.data.routes.find((x: any) => x.id === routeA);
      expect(route.withoutStop).toBe(0);
      expect(route.stops.map((s: any) => s.students)).toEqual([1, 1]);
      // A stop in use cannot be removed.
      const rm = await as(transportMgr).put(`/api/v1/transport/routes/${routeA}/stops`, { stops: [{ id: S.stop1, name: 'Mokila X Roads' }] });
      expect(rm.body.code).toBe('STOP_IN_USE');
    });

    it('shows the family the route, stop, times, vehicle, driver and helper', async () => {
      const r = (await as(family).get(`/api/v1/students/${K.a.public_id}/transport`)).body.data;
      expect(r).toEqual({ usesBus: true, route: 'Route A - Mokila', stop: 'Shankarpalli Bus Stand', landmark: null, pickupTime: '07:35', dropTime: '16:20',
        vehicle: 'TS 07 UB 1234', driverName: 'Raju Driver', driverMobile: '9660100001', helperName: 'Lakshmi', helperMobile: '9660300001' });
      expect((await as(family).get(`/api/v1/students/${K.c.public_id}/transport`)).status).toBe(404); // not their child
    });

    it('lets a driver see only the routes of the bus they drive, with family phone numbers', async () => {
      const routes = (await as(driver).get('/api/v1/transport/routes')).body.data.routes;
      expect(routes.map((r: any) => r.id)).toEqual([routeA]);
      const kids = (await as(driver).get(`/api/v1/transport/routes/${routeA}/students`)).body.data;
      expect(kids.map((k: any) => [k.name, k.mobile])).toEqual([['Bala', '9660200002'], ['Asha', '9660200001']]);
      expect((await as(driver).get(`/api/v1/transport/routes/${routeB}/students`)).status).toBe(404);
      expect((await as(driver).put(`/api/v1/transport/routes/${routeA}/students`, { items: [{ studentId: K.a.public_id, stopId: S.stop1 }] })).status).toBe(403);
      expect((await as(driver).get(`/api/v1/students/${K.a.public_id}/transport`)).body.data.stop).toBe('Shankarpalli Bus Stand');
      expect((await as(driver).get(`/api/v1/students/${K.c.public_id}/transport`)).status).toBe(404);
      const xl = await as(driver).file(`/api/v1/exports/route-students.xlsx?routeId=${routeA}`);
      expect(xl.status).toBe(200);
      const rows = await sheetRows(xl.body);
      expect(rows.some((r) => r.includes('Asha') && r.includes('07:35'))).toBe(true);
    });

    it('logs fuel and service as expenses, works out km per litre, and cancels both together', async () => {
      const d1 = addDays(today, -10), d2 = addDays(today, -3);
      expect((await as(transportMgr).post('/api/v1/transport/logs', { vehicleId: S.v1, kind: 'fuel', date: d1, odometer: 10000, amount: 4000, method: 'cash' })).body.details[0].field).toBe('litres');
      const f1 = await as(transportMgr).post('/api/v1/transport/logs', { vehicleId: S.v1, kind: 'fuel', date: d1, odometer: 10000, litres: 40, amount: 4000, vendor: 'HP Petrol Bunk', method: 'cash' });
      expect(f1.status).toBe(201);
      expect(f1.body.data.voucherNo).toMatch(/^EXP\//);
      expect((await as(transportMgr).post('/api/v1/transport/logs', { vehicleId: S.v1, kind: 'fuel', date: d2, odometer: 9000, litres: 30, amount: 3000, method: 'cash' })).body.details[0].field).toBe('odometer');
      await as(accountant).post('/api/v1/transport/logs', { vehicleId: S.v1, kind: 'fuel', date: d2, odometer: 10360, litres: 30, amount: 3050, vendor: 'HP Petrol Bunk', method: 'upi' });
      // Above the ₹5,000 approval limit: waits for the principal/admin like any expense.
      const svc = await as(accountant).post('/api/v1/transport/logs', { vehicleId: S.v1, kind: 'service', date: d2, odometer: 10360, amount: 6500, vendor: 'Sai Motors', description: 'Brake pads and oil change', method: 'cash' });
      expect(svc.body.data.expenseStatus).toBe('pending');
      expect((await as(teacher).get('/api/v1/transport/logs')).status).toBe(403);
      const logs = (await as(transportMgr).get(`/api/v1/transport/logs?from=${addDays(today, -30)}&to=${today}`)).body.data;
      expect(logs.totals).toEqual({ fuel: 7050, service: 6500, litres: 70 });
      const second = logs.rows.find((r: any) => r.kind === 'fuel' && r.odometer === 10360);
      expect(second).toMatchObject({ km: 360, kmpl: 12 });
      const exp = (await as(dev).get(`/api/v1/expenses?from=${addDays(today, -30)}&to=${today}`)).body.data;
      expect(exp.rows.filter((e: any) => e.source === 'transport' && e.category === 'Transport & fuel')).toHaveLength(3);
      expect(exp.total).toBe(7050); // the pending service is not counted yet
      // Cancelling the expense directly is refused; cancelling the log entry cancels its expense.
      const e1 = exp.rows.find((e: any) => e.amount === 4000);
      expect((await as(dev).post(`/api/v1/expenses/${e1.id}/cancel`, { reason: 'wrong' })).body.code).toBe('TRANSPORT_EXPENSE');
      const l1 = logs.rows.find((r: any) => r.amount === 4000);
      expect((await as(transportMgr).post(`/api/v1/transport/logs/${l1.id}/cancel`, { reason: 'Entered twice' })).body.data.status).toBe('cancelled');
      const after = (await as(dev).get(`/api/v1/expenses?from=${addDays(today, -30)}&to=${today}`)).body.data;
      expect(after.rows.find((e: any) => e.id === e1.id).status).toBe('cancelled');
      expect(after.total).toBe(3050);
      const xl = await as(transportMgr).file(`/api/v1/exports/vehicle-log.pdf?from=${addDays(today, -30)}&to=${today}`);
      expect(xl.headers['content-type']).toContain('application/pdf');
    });
  });

  describe('Stock and sales', () => {
    const I: Record<string, number> = {};
    let stationery: number;
    beforeAll(async () => {
      stationery = (await as(dev).get('/api/v1/expenses/categories')).body.data.find((c: any) => c.name === 'Stationery & printing').id;
    });

    it('adds items with opening stock; only stock managers add items', async () => {
      const add = (b: object, t = accountant) => as(t).post('/api/v1/inventory/items', b).then((r) => r.body.data);
      expect((await as(reception).post('/api/v1/inventory/items', { name: 'Chalk box', category: 'Stationery', unit: 'box', trackStock: true })).status).toBe(403);
      I.chalk = (await add({ name: 'Chalk box', category: 'Stationery', unit: 'box', trackStock: true, lowStockAt: 5, openingQty: 8 })).id;
      I.tel = (await add({ name: 'Telugu Reader 3', category: 'Books', unit: 'pcs', salePrice: 180, trackStock: true, openingQty: 20 })).id;
      I.eng = (await add({ name: 'English Reader 3', category: 'Books', unit: 'pcs', salePrice: 220, trackStock: true, lowStockAt: 2, openingQty: 3 })).id;
      I.nb = (await add({ name: 'Notebook 200 pages', category: 'Notebooks', unit: 'pcs', salePrice: 45, trackStock: true, openingQty: 100 })).id;
      I.tie = (await add({ name: 'School tie', category: 'Uniform', unit: 'pcs', salePrice: 120, trackStock: false })).id;
      expect((await as(accountant).post('/api/v1/inventory/items', { name: 'chalk box', category: 'Stationery', unit: 'box', trackStock: true })).body.details[0].field).toBe('name');
      const list = (await as(reception).get('/api/v1/inventory/items')).body.data;
      expect(list.categories).toEqual(['Books', 'Notebooks', 'Stationery', 'Uniform']);
      expect(list.items.find((i: any) => i.id === I.chalk)).toMatchObject({ stock: 8, isLow: false });
    });

    it('records purchases (optionally as an expense), issues and stock counts, and alerts on low stock', async () => {
      const buy = await as(accountant).post('/api/v1/inventory/movements', { itemId: I.chalk, kind: 'purchase', qty: 10, date: today, amount: 600, party: 'Sri Sai Stationers', expense: { categoryId: stationery, method: 'cash' } });
      expect(buy.body.data.voucherNo).toMatch(/^EXP\//);
      expect((await as(accountant).post('/api/v1/inventory/movements', { itemId: I.chalk, kind: 'issue', qty: 50, date: today, party: 'Class 3A' })).body.code).toBe('NOT_ENOUGH_STOCK');
      expect((await as(accountant).post('/api/v1/inventory/movements', { itemId: I.chalk, kind: 'issue', qty: 2, date: today })).body.details[0].field).toBe('party');
      await as(accountant).post('/api/v1/inventory/movements', { itemId: I.chalk, kind: 'issue', qty: 13, date: today, party: 'Primary block' });
      const alerts = (await as(accountant).get('/api/v1/notifications')).body.data;
      expect(JSON.stringify(alerts)).toContain('Low stock: Chalk box');
      const counted = await as(accountant).post('/api/v1/inventory/movements', { itemId: I.chalk, kind: 'adjust', qty: 4, date: today, note: 'Monthly count' });
      expect(counted.status).toBe(201);
      const hist = (await as(accountant).get(`/api/v1/inventory/items/${I.chalk}/history`)).body.data;
      expect(hist.map((h: any) => [h.kind, h.qty, h.balance])).toEqual([['adjust', -1, 4], ['issue', -13, 5], ['purchase', 10, 18], ['adjust', 8, 8]]);
      // Undo the purchase: stock comes back out and its expense is cancelled.
      const p = hist.find((h: any) => h.kind === 'purchase');
      expect((await as(accountant).post(`/api/v1/inventory/movements/${p.id}/undo`, { reason: 'Wrong item' })).body.code).toBe('NOT_ENOUGH_STOCK'); // only 4 left of the 10
      await as(accountant).post('/api/v1/inventory/movements', { itemId: I.chalk, kind: 'purchase', qty: 10, date: today, party: 'Return stock' });
      expect((await as(accountant).post(`/api/v1/inventory/movements/${p.id}/undo`, { reason: 'Wrong item' })).status).toBe(200);
      expect((await as(accountant).post(`/api/v1/inventory/movements/${p.id}/undo`, { reason: 'Wrong item' })).body.code).toBe('ALREADY_UNDONE');
      const exp = (await as(dev).get('/api/v1/expenses')).body.data.rows.find((e: any) => e.voucherNo === buy.body.data.voucherNo);
      expect(exp).toMatchObject({ status: 'cancelled', source: 'inventory' });
    });

    it('builds class book sets and shows how many can be made from stock', async () => {
      const r = await as(accountant).post('/api/v1/inventory/sets', { name: 'Class 3 book set', classId: cls['Class 3'], price: 600, lines: [{ itemId: I.tel, qty: 1 }, { itemId: I.eng, qty: 1 }, { itemId: I.nb, qty: 4 }] });
      expect(r.status).toBe(201);
      const set = r.body.data.find((s: any) => s.name === 'Class 3 book set');
      expect(set).toMatchObject({ className: 'Class 3', price: 600, itemsValue: 580, available: 3 });
      I.set3 = set.id;
      expect((await as(accountant).post('/api/v1/inventory/sets', { name: 'Bad', price: 10, lines: [{ itemId: I.tel, qty: 1 }, { itemId: I.tel, qty: 2 }] })).body.details[0].field).toBe('lines');
    });

    it('sells sets and items at the counter with gapless receipts, and blocks selling more than stock', async () => {
      const sell = (b: object) => as(reception).post('/api/v1/sales', { date: today, method: 'cash', ...b });
      const s1 = await sell({ studentId: K.a.public_id, lines: [{ setId: I.set3, qty: 1 }, { itemId: I.tie, qty: 2 }] });
      expect(s1.status).toBe(201);
      expect(s1.body.data).toMatchObject({ receiptNo: expect.stringMatching(/^SALE\/\d{4}-\d{2}\/00001$/), total: 840 });
      const s2 = await sell({ studentId: K.b.public_id, method: 'upi', reference: 'UPI123', lines: [{ setId: I.set3, qty: 1 }, { itemId: I.eng, qty: 1 }] });
      expect(s2.body.data.receiptNo).toMatch(/00002$/);
      // English Reader: 3 - 1 - 1 - 1 = 0 left; another set cannot be sold.
      const s3 = await sell({ studentId: K.c.public_id, lines: [{ setId: I.set3, qty: 1 }] });
      expect(s3.body).toMatchObject({ code: 'NOT_ENOUGH_STOCK', message: 'Only 0 pcs of English Reader 3 in stock.' });
      expect((await sell({ lines: [{ itemId: I.nb, qty: 1 }] })).body.details[0].field).toBe('studentId');
      const walkIn = await sell({ buyerName: 'Old student', lines: [{ itemId: I.nb, qty: 2 }] });
      expect(walkIn.body.data).toMatchObject({ receiptNo: expect.stringMatching(/00003$/), total: 90 });
      expect((await sell({ studentId: K.a.public_id, lines: [{ itemId: I.chalk, qty: 1 }] })).body.details[0].message).toMatch(/not for sale/);
      const items = (await as(reception).get('/api/v1/inventory/items')).body.data.items;
      expect(items.find((i: any) => i.id === I.nb).stock).toBe(100 - 4 - 4 - 2);
      expect(items.find((i: any) => i.id === I.eng).stock).toBe(0);
      const day = (await as(reception).get('/api/v1/sales')).body.data;
      expect(day).toMatchObject({ count: 3, total: 1750 });
      expect(day.rows[2].items).toBe('Class 3 book set, 2 × School tie');
      S.sale1 = s1.body.data.id;
      const pdf = await as(reception).file(`/api/v1/sales/${S.sale1}/pdf`);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect((await as(teacher).get('/api/v1/sales')).status).toBe(403);
    });

    it('cancels a sale: keeps the number, puts stock back, and only managers can cancel', async () => {
      expect((await as(reception).post(`/api/v1/sales/${S.sale1}/cancel`, { reason: 'Wrong student' })).status).toBe(403);
      expect((await as(accountant).post(`/api/v1/sales/${S.sale1}/cancel`, { reason: 'Wrong student' })).body.data.status).toBe('cancelled');
      expect((await as(accountant).post(`/api/v1/sales/${S.sale1}/cancel`, { reason: 'Wrong student' })).body.code).toBe('ALREADY_CANCELLED');
      const items = (await as(reception).get('/api/v1/inventory/items')).body.data.items;
      expect(items.find((i: any) => i.id === I.eng).stock).toBe(1);
      expect(items.find((i: any) => i.id === I.nb).stock).toBe(94);
      const day = (await as(reception).get('/api/v1/sales')).body.data;
      expect(day).toMatchObject({ count: 2, total: 910 });
      const next = await as(reception).post('/api/v1/sales', { date: today, method: 'cash', studentId: K.c.public_id, lines: [{ itemId: I.tel, qty: 1 }] });
      expect(next.body.data.receiptNo).toMatch(/00004$/);
      const xl = await as(reception).file(`/api/v1/exports/sales.xlsx?from=${today}&to=${today}`);
      const rows = await sheetRows(xl.body);
      expect(rows.some((r) => r.includes('Cancelled'))).toBe(true);
      const low = await as(accountant).file('/api/v1/exports/stock.xlsx?low=1');
      expect((await sheetRows(low.body)).some((r) => r.includes('English Reader 3'))).toBe(true);
    });
  });
});
