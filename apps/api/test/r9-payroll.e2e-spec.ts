import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';
import { addDays } from '../src/attendance/calendar';
import { calculateSlip, type PayItem } from '../src/payroll/calc';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };
const binary = (res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

describe('Pay calculation (unit)', () => {
  const item = (o: Partial<PayItem> & Pick<PayItem, 'componentId' | 'code' | 'kind' | 'calc' | 'value'>): PayItem =>
    ({ name: o.code, maxAmount: null, prorate: true, isBasic: false, sortOrder: o.componentId, ...o });
  const items: PayItem[] = [
    item({ componentId: 1, code: 'BASIC', kind: 'earning', calc: 'fixed', value: 20000_00, isBasic: true }),
    item({ componentId: 2, code: 'DA', kind: 'earning', calc: 'pct_basic', value: 1000 }),
    item({ componentId: 3, code: 'HRA', kind: 'earning', calc: 'fixed', value: 5000_00 }),
    item({ componentId: 4, code: 'PF', kind: 'deduction', calc: 'pct_basic', value: 1200, maxAmount: 1800_00 }),
    item({ componentId: 5, code: 'PT', kind: 'deduction', calc: 'fixed', value: 200_00, prorate: false }),
    item({ componentId: 6, code: 'ESI', kind: 'deduction', calc: 'pct_gross', value: 75 }),
    item({ componentId: 7, code: 'EPF', kind: 'employer', calc: 'pct_basic', value: 1200, maxAmount: 1800_00 }),
  ];
  it('pays the full month without loss of pay', () => {
    const s = calculateSlip(items, 0, 30);
    expect(s.gross).toBe(27000_00); // 20,000 + 2,000 + 5,000
    expect(s.lines.find((l) => l.code === 'PF')!.amount).toBe(1800_00); // 12% of 20,000 = 2,400, capped at 1,800
    expect(s.lines.find((l) => l.code === 'ESI')!.amount).toBe(203_00); // 0.75% of 27,000 = 202.50 -> 203
    expect(s.totalDeductions).toBe(2203_00);
    expect(s.net).toBe(24797_00);
    expect(s.employerTotal).toBe(1800_00);
  });
  it('reduces pay for loss-of-pay days; fixed deductions not marked prorate stay the same', () => {
    const s = calculateSlip(items, 3, 30, [{ label: 'Exam duty', kind: 'earning', amount: 500_00 }, { label: 'Advance', kind: 'deduction', amount: 1000_00 }]);
    expect(s.lines.find((l) => l.code === 'BASIC')!.amount).toBe(18000_00);
    expect(s.lines.find((l) => l.code === 'DA')!.amount).toBe(1800_00);
    expect(s.lines.find((l) => l.code === 'HRA')!.amount).toBe(4500_00);
    expect(s.lines.find((l) => l.code === 'PT')!.amount).toBe(200_00);
    expect(s.lines.find((l) => l.code === 'ESI')!.amount).toBe(182_00); // 0.75% of salary gross 24,300 (not the one-off addition)
    expect(s.gross).toBe(24800_00);
    expect(s.totalDeductions).toBe(1800_00 + 200_00 + 182_00 + 1000_00);
    expect(s.paidDays).toBe(27);
  });
});

describe('HR, payroll and expenses (e2e)', () => {
  let app: INestApplication; let db: Database; let http: any; let dev: string; let teacher: string; let accountant: string;
  const S: Record<string, any> = {}; const C: Record<string, number> = {};
  let today: string, prevMonth: string;

  const login = (i: string, p: string) => http.post('/api/v1/auth/login').send({ identifier: i, password: p });
  const as = (t: string) => {
    const h = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
    return { get: (u: string) => h(http.get(u)), post: (u: string, b: object = {}) => h(http.post(u)).send(b), put: (u: string, b: object) => h(http.put(u)).send(b),
      patch: (u: string, b: object) => h(http.patch(u)).send(b), del: (u: string) => h(http.delete(u)), file: (u: string) => h(http.get(u)).buffer(true).parse(binary),
      upload: (u: string, buf: Buffer, name: string) => h(http.post(u)).attach('file', buf, name) };
  };
  async function activate(identifier: string, userId: string) {
    const c = (await as(dev).post(`/api/v1/users/${userId}/credentials`)).body.data;
    const t = (await login(identifier, c.temporaryPassword)).body.data.accessToken;
    await as(t).post('/api/v1/auth/change-password', { currentPassword: c.temporaryPassword, newPassword: 'NewPass@123' });
    return (await login(identifier, 'NewPass@123')).body.data.accessToken as string;
  }
  const sheetRows = async (buf: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any); const out: string[][] = []; wb.worksheets[0].eachRow((r) => out.push((r.values as any[]).slice(1).map((v) => String(v ?? '')))); return out; };
  const staff = (name: string, mobile: string, code: string, roleKeys: string[]) =>
    as(dev).post('/api/v1/staff', { name, email: `${code.toLowerCase()}@test.local`, mobile, employeeCode: code, joiningDate: '2025-01-01', roleKeys }).then((r) => r.body.data);

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp(); await app.init(); http = request(app.getHttpServer());
    dev = (await login(DEV.email, DEV.password)).body.data.accessToken;
    S.teacher = await staff('Ravi Teacher', '9550100001', 'T-1', ['teacher']);
    S.acc = await staff('Anil Accounts', '9550100002', 'A-1', ['accountant']);
    S.new = await staff('Nisha New', '9550100003', 'N-1', ['non_teaching_staff']);
    teacher = await activate('9550100001', S.teacher.user_id);
    accountant = await activate('9550100002', S.acc.user_id);
    today = (await as(dev).get('/api/v1/attendance/overview')).body?.data?.today ?? new Date().toISOString().slice(0, 10);
    prevMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  });
  afterAll(async () => { await app.close(); await db.destroy(); });

  it('stays switched off until the developer turns the modules on', async () => {
    expect((await as(dev).get('/api/v1/payroll/runs')).body.code).toBe('FEATURE_DISABLED');
    expect((await as(dev).get('/api/v1/expenses')).body.code).toBe('FEATURE_DISABLED');
    expect((await as(teacher).get('/api/v1/leave-balances/mine')).body.data.enabled).toBe(false);
    for (const m of ['attendance', 'hr', 'payroll', 'expenses']) await as(dev).put(`/api/v1/developer/feature-flags/${m}`, { enabled: true });
    today = (await as(dev).get('/api/v1/attendance/overview')).body.data.today;
    prevMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  });

  describe('HR records and leave types', () => {
    it('keeps bank and ID details for HR only, with format checks', async () => {
      expect((await as(dev).put(`/api/v1/hr/staff/${S.teacher.public_id}`, { bankIfsc: 'SBI123' })).body.code).toBe('VALIDATION_FAILED');
      const r = (await as(dev).put(`/api/v1/hr/staff/${S.teacher.public_id}`, { employmentType: 'permanent', bankName: 'SBI', bankAccountNo: '12345678901', bankIfsc: 'sbin0001234', panNo: 'abcde1234f' })).body.data;
      expect(r).toMatchObject({ bankIfsc: 'SBIN0001234', panNo: 'ABCDE1234F', employmentType: 'permanent' });
      expect(r.leave.map((l: any) => l.code)).toEqual(['CL', 'SL', 'LWP']);
      expect((await as(teacher).get(`/api/v1/hr/staff/${S.teacher.public_id}`)).status).toBe(403);
      expect((await as(accountant).get(`/api/v1/hr/staff/${S.teacher.public_id}`)).status).toBe(200);
      expect((await as(accountant).put(`/api/v1/hr/staff/${S.teacher.public_id}`, { notes: 'x' })).status).toBe(403);
      const log = await db.selectFrom('audit_logs').select('after_data').where('action', '=', 'update_record').executeTakeFirstOrThrow();
      expect(JSON.stringify(log.after_data)).not.toContain('12345678901');
    });

    it('asks staff for a leave type and stops requests over the yearly allowance', async () => {
      const start = addDays(today, 1);
      let end = addDays(today, 30);
      while (new Date(`${end}T00:00:00Z`).getUTCDay() === 0) end = addDays(end, -1); // a working day, not a Sunday
      expect((await as(teacher).post('/api/v1/leave-requests/mine', { startDate: start, endDate: start, reason: 'Family function' })).body.code).toBe('VALIDATION_FAILED');
      const types = (await as(teacher).get('/api/v1/leave-balances/mine')).body.data.types;
      C.cl = types.find((t: any) => t.code === 'CL').id; C.lwp = types.find((t: any) => t.code === 'LWP').id;
      const over = await as(teacher).post('/api/v1/leave-requests/mine', { startDate: start, endDate: end, reason: 'Long trip', leaveTypeId: C.cl });
      expect(over.body.code).toBe('LEAVE_BALANCE');
      const ok = await as(teacher).post('/api/v1/leave-requests/mine', { startDate: end, endDate: end, reason: 'Personal work', leaveTypeId: C.lwp });
      expect(ok.body.data.status).toBe('pending');
      const lr = (await as(dev).get('/api/v1/leave-requests')).body.data.find((l: any) => l.id === ok.body.data.id);
      expect(lr).toMatchObject({ leaveType: 'Leave without pay', unpaid: true, canDecide: true });
      expect((await as(teacher).post('/api/v1/leave-requests/mine', { startDate: end, endDate: end, reason: 'Again', leaveTypeId: C.cl })).body.code).toBe('LEAVE_OVERLAP');
      await as(dev).post(`/api/v1/leave-requests/${ok.body.data.id}/decide`, { approve: true });
      const lwp = (await as(teacher).get('/api/v1/leave-balances/mine')).body.data.types.find((t: any) => t.code === 'LWP');
      expect(lwp.allowed).toBeNull();
    });

    it('lets HR add and change leave types', async () => {
      const r = await as(dev).post('/api/v1/hr/leave-types', { code: 'ml', name: 'Maternity leave', daysPerYear: 180, isPaid: true });
      expect(r.body.data.find((t: any) => t.code === 'ML')).toMatchObject({ daysPerYear: 180, isPaid: true, isActive: true });
      expect((await as(dev).post('/api/v1/hr/leave-types', { code: 'CL', name: 'Dup', daysPerYear: 1, isPaid: true })).body.code).toBe('VALIDATION_FAILED');
      const ml = r.body.data.find((t: any) => t.code === 'ML');
      const off = await as(dev).patch(`/api/v1/hr/leave-types/${ml.id}`, { code: 'ML', name: 'Maternity leave', daysPerYear: 180, isPaid: true, isActive: false });
      expect(off.body.data.find((t: any) => t.code === 'ML').isActive).toBe(false);
      expect((await as(dev).get('/api/v1/hr/leave-balances')).body.data.staff.length).toBe(3);
    });
  });

  describe('Salaries and templates', () => {
    it('adds pay items as a fixed amount or a percentage', async () => {
      const add = (b: object) => as(dev).post('/api/v1/payroll/components', b);
      expect((await add({ code: 'BONUS', name: 'Bonus', kind: 'earning', calc: 'pct_gross', defaultValue: 5, prorate: false })).body.code).toBe('VALIDATION_FAILED');
      await add({ code: 'DA', name: 'Dearness allowance', kind: 'earning', calc: 'pct_basic', defaultValue: 10, prorate: true, sortOrder: 1 });
      await add({ code: 'HRA', name: 'House rent allowance', kind: 'earning', calc: 'fixed', defaultValue: 0, prorate: true, sortOrder: 2 });
      await add({ code: 'PF', name: 'Provident fund', kind: 'deduction', calc: 'pct_basic', defaultValue: 12, maxAmount: 1800, prorate: false, sortOrder: 3 });
      await add({ code: 'PT', name: 'Professional tax', kind: 'deduction', calc: 'fixed', defaultValue: 200, prorate: false, sortOrder: 4 });
      const all = (await add({ code: 'EPF', name: 'Employer PF', kind: 'employer', calc: 'pct_basic', defaultValue: 12, maxAmount: 1800, prorate: false, sortOrder: 5 })).body.data;
      for (const c of all) C[c.code] = c.id;
      expect(all.find((c: any) => c.code === 'BASIC')).toMatchObject({ isBasic: true, kind: 'earning' });
      expect((await as(dev).patch(`/api/v1/payroll/components/${C.BASIC}`, { code: 'BASIC', name: 'Basic', kind: 'earning', calc: 'pct_basic', defaultValue: 0, prorate: true })).body.code).toBe('BASIC_FIXED');
      expect((await as(teacher).get('/api/v1/payroll/components')).status).toBe(403);
    });

    it('builds a template, then gives it to staff and edits one person', async () => {
      const lines = [{ componentId: C.BASIC, value: 20000 }, { componentId: C.DA, value: 10 }, { componentId: C.HRA, value: 5000 }, { componentId: C.PF, value: 12 }, { componentId: C.PT, value: 200 }, { componentId: C.EPF, value: 12 }];
      expect((await as(dev).post('/api/v1/payroll/templates', { name: 'No basic', lines: lines.slice(1) })).body.code).toBe('VALIDATION_FAILED');
      const t = (await as(dev).post('/api/v1/payroll/templates', { name: 'Teacher', lines })).body.data[0];
      expect(t.preview).toEqual({ gross: 27000, deductions: 2000, employer: 1800, net: 25000 });
      C.tpl = t.id;
      const from = `${prevMonth}-01`;
      expect((await as(accountant).post(`/api/v1/payroll/templates/${t.id}/apply`, { staffIds: [S.teacher.public_id, S.acc.public_id], effectiveFrom: from })).body.data.updated).toBe(2);
      // The accountant's own pay is lower: change one amount.
      const acc = (await as(accountant).put(`/api/v1/payroll/salaries/${S.acc.public_id}`, { effectiveFrom: from, templateId: t.id, lines: lines.map((l) => (l.componentId === C.BASIC ? { ...l, value: 15000 } : l)) })).body.data;
      expect(acc.revisions).toHaveLength(1);
      expect(acc.revisions[0].preview.gross).toBe(15000 + 1500 + 5000);
      const list = (await as(dev).get('/api/v1/payroll/salaries')).body.data;
      expect(list.find((s: any) => s.id === S.new.public_id).gross).toBeNull();
      expect(list.find((s: any) => s.id === S.teacher.public_id)).toMatchObject({ template: 'Teacher', net: 25000 });
    });
  });

  describe('Monthly payroll', () => {
    it('creates a draft for a past month and lists staff without a salary', async () => {
      const future = addDays(`${today.slice(0, 7)}-28`, 10).slice(0, 7);
      expect((await as(dev).post('/api/v1/payroll/runs', { month: future })).body.code).toBe('VALIDATION_FAILED');
      const r = (await as(accountant).post('/api/v1/payroll/runs', { month: prevMonth })).body.data;
      expect(r.status).toBe('draft');
      expect(r.slips.map((s: any) => s.name)).toEqual(['Anil Accounts', 'Ravi Teacher']);
      expect(r.missing.map((m: any) => m.name)).toEqual(['Nisha New']);
      expect(r.divisor).toBe(new Date(Date.UTC(Number(prevMonth.slice(0, 4)), Number(prevMonth.slice(5)), 0)).getUTCDate());
      expect(r.totals.net).toBe(25000 + (21500 - 1800 - 200));
      expect((await as(dev).post('/api/v1/payroll/runs', { month: prevMonth })).body.code).toBe('RUN_EXISTS');
    });

    it('suggests loss-of-pay days from attendance; the accountant decides', async () => {
      const days: string[] = [];
      for (let d = `${prevMonth}-01`; days.length < 2 && d.startsWith(prevMonth); d = addDays(d, 1)) if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) days.push(d);
      for (const d of days) await as(dev).put('/api/v1/staff-attendance', { date: d, entries: [{ staffId: S.teacher.public_id, status: 'absent' }] });
      let r = (await as(accountant).get(`/api/v1/payroll/runs/${prevMonth}`)).body.data;
      const slip = r.slips.find((s: any) => s.name === 'Ravi Teacher');
      expect(slip.lopDays).toBe(0);
      expect(slip.hint).toMatchObject({ absent: 2, suggested: 2 });
      r = (await as(accountant).post(`/api/v1/payroll/runs/${prevMonth}/fill-lop`)).body.data;
      const t = r.slips.find((s: any) => s.name === 'Ravi Teacher');
      expect(t.lopDays).toBe(2);
      const f = (r.divisor - 2) / r.divisor;
      const basic = Math.round(20000 * f);
      expect(t.lines.find((l: any) => l.code === 'BASIC').amount).toBe(basic);
      expect(t.gross).toBe(basic + Math.round(basic * 0.1) + Math.round(5000 * f));
      // One-off addition and a manual change of the days
      r = (await as(accountant).patch(`/api/v1/payroll/runs/${prevMonth}/slips/${t.id}`, { lopDays: 1, adjustments: [{ label: 'Exam duty', kind: 'earning', amount: 1000 }], note: 'Approved by principal' })).body.data;
      const t2 = r.slips.find((s: any) => s.id === t.id);
      expect(t2.lopDays).toBe(1);
      expect(t2.adjustments).toEqual([{ label: 'Exam duty', kind: 'earning', amount: 1000 }]);
      expect((await as(accountant).patch(`/api/v1/payroll/runs/${prevMonth}/slips/${t.id}`, { lopDays: 40, adjustments: [] })).body.code).toBe('VALIDATION_FAILED');
      expect((await as(accountant).patch(`/api/v1/payroll/runs/${prevMonth}/slips/${t.id}`, { lopDays: 0, adjustments: [{ label: 'Advance', kind: 'deduction', amount: 99999 }] })).body.code).toBe('NEGATIVE_NET');
    });

    it('only the finaliser locks the month; staff then see their own payslip', async () => {
      expect((await as(teacher).get('/api/v1/payslips/mine')).body.data).toEqual([]);
      expect((await as(accountant).post(`/api/v1/payroll/runs/${prevMonth}/finalise`)).status).toBe(403);
      const r = (await as(dev).post(`/api/v1/payroll/runs/${prevMonth}/finalise`)).body.data;
      expect(r.status).toBe('finalised');
      const mine = (await as(teacher).get('/api/v1/payslips/mine')).body.data;
      expect(mine).toHaveLength(1);
      expect(mine[0].net).toBe(r.slips.find((s: any) => s.name === 'Ravi Teacher').net);
      const pdf = await as(teacher).file(`/api/v1/payslips/${mine[0].id}/pdf`);
      expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
      const other = r.slips.find((s: any) => s.name === 'Anil Accounts').id;
      expect((await as(teacher).get(`/api/v1/payslips/${other}/pdf`)).status).toBe(404);
      expect((await as(accountant).get(`/api/v1/payslips/${mine[0].id}/pdf`)).status).toBe(200);
      const n = await db.selectFrom('notifications').select('title').where('user_id', '=', (await db.selectFrom('users').select('id').where('public_id', '=', S.teacher.user_id).executeTakeFirstOrThrow()).id).execute();
      expect(n.map((x) => x.title).join()).toContain('Payslip for');
      expect((await as(accountant).patch(`/api/v1/payroll/runs/${prevMonth}/slips/${other}`, { lopDays: 0, adjustments: [] })).body.code).toBe('PAYROLL_LOCKED');
    });

    it('can be reopened with a reason until it is paid; paying records the expense', async () => {
      expect((await as(dev).post(`/api/v1/payroll/runs/${prevMonth}/reopen`, { reason: '' })).body.code).toBe('VALIDATION_FAILED');
      expect((await as(dev).post(`/api/v1/payroll/runs/${prevMonth}/reopen`, { reason: 'Wrong LOP' })).body.data.status).toBe('draft');
      expect((await as(teacher).get('/api/v1/payslips/mine')).body.data).toEqual([]);
      await as(dev).post(`/api/v1/payroll/runs/${prevMonth}/finalise`);
      const net = (await as(dev).get(`/api/v1/payroll/runs/${prevMonth}`)).body.data.totals.net;
      const paid = (await as(accountant).post(`/api/v1/payroll/runs/${prevMonth}/paid`, { paidOn: today, method: 'bank_transfer', reference: 'NEFT-1' })).body.data;
      expect(paid.status).toBe('paid');
      const ex = (await as(dev).get(`/api/v1/expenses?from=${today}&to=${today}`)).body.data;
      expect(ex.rows[0]).toMatchObject({ category: 'Salaries', amount: net, status: 'approved', source: 'payroll' });
      expect((await as(dev).post(`/api/v1/payroll/runs/${prevMonth}/reopen`, { reason: 'Too late' })).body.code).toBe('PAYROLL_PAID');
      expect((await as(dev).post(`/api/v1/expenses/${ex.rows[0].id}/cancel`, { reason: 'Not needed' })).body.code).toBe('PAYROLL_EXPENSE');
    });

    it('exports the salary register and the bank transfer list', async () => {
      const reg = await sheetRows((await as(accountant).file(`/api/v1/exports/payroll-register.xlsx?month=${prevMonth}`)).body);
      expect(reg[0]).toEqual(expect.arrayContaining(['Code', 'Name', 'Basic pay', 'Dearness allowance', 'Gross', 'Provident fund', 'Net pay', 'Employer PF']));
      expect(reg[reg.length - 1]).toContain('Total');
      const bank = await sheetRows((await as(accountant).file(`/api/v1/exports/bank-transfer.xlsx?month=${prevMonth}`)).body);
      expect(bank.find((r) => r[1] === 'Ravi Teacher')!.slice(2, 5)).toEqual(['SBI', '12345678901', 'SBIN0001234']);
      expect(bank.find((r) => r[1] === 'Anil Accounts')![3]).toBe('MISSING');
      expect((await as(teacher).get(`/api/v1/exports/payroll-register.pdf?month=${prevMonth}`)).status).toBe(403);
      expect((await as(accountant).file(`/api/v1/exports/payroll-register.pdf?month=${prevMonth}`)).body.subarray(0, 4).toString()).toBe('%PDF');
    });
  });

  describe('Expenses', () => {
    let cat: number;
    beforeAll(async () => { cat = (await as(accountant).get('/api/v1/expenses/categories')).body.data.find((c: any) => c.name === 'Electricity').id; });
    const add = (t: string, amount: number, extra: object = {}) => as(t).post('/api/v1/expenses', { date: today, categoryId: cat, amount, paidTo: 'TSSPDCL', method: 'upi', ...extra });

    it('approves small amounts at once and holds bigger ones for approval (default above ₹5,000)', async () => {
      expect((await as(accountant).get('/api/v1/expenses/settings')).body.data).toEqual({ mode: 'above', limit: 5000 });
      const small = (await add(accountant, 2000)).body.data;
      expect(small).toMatchObject({ status: 'approved' });
      expect(small.voucher).toMatch(/^EXP\/.+\/00002$/); // 00001 is the salary entry
      const big = (await add(accountant, 8000)).body.data;
      expect(big.status).toBe('pending');
      expect((await as(accountant).post(`/api/v1/expenses/${big.publicId}/decide`, { approve: true })).status).toBe(403);
      expect((await as(dev).post(`/api/v1/expenses/${big.publicId}/decide`, { approve: false })).body.code).toBe('VALIDATION_FAILED');
      expect((await as(dev).post(`/api/v1/expenses/${big.publicId}/decide`, { approve: true })).body.data.status).toBe('approved');
      expect((await add(dev, 50000)).body.data.status).toBe('approved'); // an approver's own entry
      expect((await add(accountant, 100, { date: addDays(today, 1) })).body.code).toBe('VALIDATION_FAILED');
      expect((await add(teacher, 100)).status).toBe(403);
    });

    it('follows the rule the school chooses, and keeps cancelled vouchers', async () => {
      expect((await as(accountant).put('/api/v1/expenses/settings', { mode: 'all', limit: 0 })).status).toBe(403);
      await as(dev).put('/api/v1/expenses/settings', { mode: 'all', limit: 0 });
      const e = (await add(accountant, 100, { paidTo: 'Stationery shop' })).body.data;
      expect(e.status).toBe('pending');
      expect((await as(accountant).post(`/api/v1/expenses/${e.publicId}/cancel`, { reason: 'Entered twice' })).body.data.status).toBe('cancelled');
      await as(dev).put('/api/v1/expenses/settings', { mode: 'none', limit: 0 });
      expect((await add(accountant, 90000)).body.data.status).toBe('approved');
      const list = (await as(dev).get(`/api/v1/expenses?from=${today}&to=${today}`)).body.data;
      expect(list.rows.find((r: any) => r.id === e.publicId).status).toBe('cancelled');
      expect(list.byCategory.find((c: any) => c.name === 'Electricity').amount).toBe(2000 + 8000 + 50000 + 90000);
      expect((await as(dev).get(`/api/v1/expenses?from=${today}&to=${today}&status=cancelled`)).body.data.rows).toHaveLength(1);
    });

    it('attaches a bill photo or PDF only', async () => {
      const e = (await add(accountant, 300, { paidTo: 'Plumber' })).body.data;
      expect((await as(accountant).upload(`/api/v1/expenses/${e.publicId}/bill`, Buffer.from('hello'), 'bill.txt')).body.code).toBe('BAD_FILE');
      expect((await as(accountant).upload(`/api/v1/expenses/${e.publicId}/bill`, PNG, 'bill.png')).body.data).toEqual({ ok: true });
      const b = await as(dev).file(`/api/v1/expenses/${e.publicId}/bill`);
      expect(b.headers['content-type']).toBe('image/png');
      expect(Buffer.compare(b.body, PNG)).toBe(0);
      const rows = await sheetRows((await as(dev).file(`/api/v1/exports/expenses.xlsx?from=${today}&to=${today}`)).body);
      expect(rows[0].slice(0, 4)).toEqual(['Date', 'Voucher', 'Category', 'Paid to']);
      expect(rows.some((r) => r[3] === 'Plumber')).toBe(true);
    });
  });
});
