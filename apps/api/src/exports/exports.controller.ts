import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { CurrentUser, type RequestUser } from '../common/request-user';
import { PermissionsService } from '../permissions/permissions.service';
import { StudentsService } from '../students/students.service';
import { StaffService } from '../staff/staff.service';
import { AttendanceService } from '../attendance/attendance.service';
import { LeaveStaffService } from '../attendance/leave-staff.service';
import { schoolToday } from '../attendance/calendar';
import { ExamsService } from '../exams/exams.service';
import { FeeReportsService } from '../fees/fee-reports.service';
import { PayrollService } from '../payroll/payroll.service';
import { ExpensesService } from '../payroll/expenses.service';
import { TransportService } from '../transport/transport.service';
import { InventoryService } from '../inventory/inventory.service';
import { ActivityService } from '../activity/activity.service';
import { clientMeta, type AppRequest } from '../common/request-user';
import { toPdf, toXlsx, type ExportTable } from './table';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const id = z.coerce.number().int().positive();
const ATT: Record<string, string> = { present: 'P', absent: 'A', late: 'L', half_day: 'H', leave: 'LV' };
const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', cheque: 'Cheque', bank_transfer: 'Bank transfer', card: 'Card' };
const nm = (a?: string | null, b?: string | null) => [a, b].filter(Boolean).join(' ');
const d = (x: unknown) => (x ? new Date(x as string).toISOString().slice(0, 10) : '');

/**
 * Every list can be downloaded as Excel or PDF (requirements 15.4). Each export checks the same
 * permission and module switch as its screen, and reuses the screen's query, so scope (own classes,
 * own children) and hidden fields are exactly what the person can already see.
 */
@ApiTags('Exports')
@ApiBearerAuth()
@Controller('exports')
export class ExportsController {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly perms: PermissionsService, private readonly audit: AuditService,
    private readonly students: StudentsService, private readonly staff: StaffService, private readonly att: AttendanceService, private readonly leave: LeaveStaffService,
    private readonly exams: ExamsService, private readonly fees: FeeReportsService,
    private readonly payroll: PayrollService, private readonly expenses: ExpensesService,
    private readonly transport: TransportService, private readonly inventory: InventoryService, private readonly activity: ActivityService) {}

  private async need(u: RequestUser, module: string, perm: string, scope?: 'all') {
    const has = scope ? u.permissions.get(perm) === scope : u.permissions.has(perm);
    if (u.workspace !== 'staff' || !has || !(await this.perms.isModuleEnabled(module))) throw Errors.forbidden();
  }

  private async build(u: RequestUser, name: string, q: Record<string, string>): Promise<ExportTable> {
    switch (name) {
      case 'students': {
        await this.need(u, 'students', 'students.view');
        const p = z.object({ classId: id.optional(), sectionId: id.optional(), search: z.string().max(100).optional(), status: z.enum(['active', 'inactive']).default('active') }).parse(q);
        const r = await this.students.list(u, { ...p, page: 1, pageSize: 5000 });
        return { title: `Students (${p.status})`, subtitle: `Academic year ${r.meta.academicYear}`, fileName: 'students', columns: [
          { key: 'admission_no', label: 'Adm no', width: 9 }, { key: 'name', label: 'Student', width: 22 }, { key: 'gender', label: 'Gender', width: 8 },
          { key: 'cls', label: 'Class', width: 11 }, { key: 'roll_no', label: 'Roll', width: 6, align: 'center' }, { key: 'parent', label: 'Parent', width: 20 }, { key: 'family_mobile', label: 'Mobile', width: 13 }],
          rows: r.data.map((s: any) => ({ ...s, name: nm(s.first_name, s.last_name), cls: nm(s.class_name, s.section_name), parent: s.father_name || s.family_name })) };
      }
      case 'staff': {
        await this.need(u, 'staff', 'staff.view');
        const p = z.object({ status: z.enum(['active', 'inactive']).optional(), search: z.string().max(100).optional() }).parse(q);
        const r = await this.staff.list({ ...p, page: 1, pageSize: 5000 });
        return { title: 'Staff', fileName: 'staff', columns: [
          { key: 'employee_code', label: 'Code', width: 9 }, { key: 'name', label: 'Name', width: 22 }, { key: 'designation', label: 'Designation', width: 16 },
          { key: 'roles', label: 'Roles', width: 20 }, { key: 'mobile', label: 'Mobile', width: 13 }, { key: 'email', label: 'Email', width: 24 }, { key: 'status', label: 'Status', width: 8 }],
          rows: r.data as any[] };
      }
      case 'attendance-month': {
        await this.need(u, 'attendance', 'attendance.view');
        const p = z.object({ sectionId: id, month }).parse(q);
        const r = await this.att.sectionMonth(u, p.sectionId, p.month);
        const sec = await this.sectionName(p.sectionId);
        const days = r.days.filter((x: any) => x.working);
        return { title: `Attendance ${sec}`, subtitle: `${new Date(`${p.month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })} · P present, A absent, L late, H half day, LV leave`,
          fileName: `attendance-${sec}-${p.month}`, columns: [{ key: 'rollNo', label: 'Roll', width: 4, align: 'center' }, { key: 'name', label: 'Student', width: 16 },
            ...days.map((x: any) => ({ key: x.date, label: String(Number(x.date.slice(8))), width: 2.6, align: 'center' as const })),
            { key: 'presentDays', label: 'Present', width: 5, align: 'right' }, { key: 'workingDays', label: 'Days', width: 4, align: 'right' }, { key: 'percentage', label: '%', width: 4, align: 'right' }],
          rows: r.students.map((s: any) => ({ ...s, ...Object.fromEntries(days.map((x: any) => [x.date, ATT[s.statuses[x.date]] ?? ''])) })) };
      }
      case 'absentees': {
        await this.need(u, 'attendance', 'attendance.view', 'all');
        const p = z.object({ date: date.optional() }).parse(q);
        const r = await this.att.absentees(p.date);
        return { title: 'Absent students', subtitle: new Date(`${r.date}T00:00:00Z`).toLocaleDateString('en-IN', { dateStyle: 'full', timeZone: 'UTC' }), fileName: `absentees-${r.date}`,
          columns: [{ key: 'className', label: 'Class', width: 10 }, { key: 'name', label: 'Student', width: 22 }, { key: 'parent', label: 'Parent', width: 20 }, { key: 'mobile', label: 'Mobile', width: 13 }],
          rows: r.rows };
      }
      case 'leave': {
        const p = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional() }).parse(q);
        if (u.workspace !== 'staff') throw Errors.forbidden();
        const r = await this.leave.list(u, p.status);
        return { title: 'Leave requests', subtitle: p.status ? `Status: ${p.status}` : undefined, fileName: 'leave-requests', columns: [
          { key: 'who', label: 'Name', width: 18 }, { key: 'kind', label: 'For', width: 7 }, { key: 'className', label: 'Class', width: 10 }, { key: 'startDate', label: 'From', width: 10 },
          { key: 'endDate', label: 'To', width: 10 }, { key: 'reason', label: 'Reason', width: 24 }, { key: 'status', label: 'Status', width: 9 }, { key: 'decidedBy', label: 'Decided by', width: 14 }],
          rows: r.map((l) => ({ ...l, kind: l.kind === 'student' ? 'Student' : 'Staff' })) };
      }
      case 'exam-results': {
        await this.need(u, 'marks', 'marks.view');
        const p = z.object({ sectionId: id }).parse(q);
        const r = await this.exams.sectionResults(u, p.sectionId);
        return { title: `Results ${r.section}`, subtitle: 'Final per subject (out of 100) with grade. Includes marks not yet published.', fileName: `results-${r.section}`, columns: [
          { key: 'rankSection', label: 'Rank', width: 5, align: 'center' }, { key: 'rollNo', label: 'Roll', width: 5, align: 'center' }, { key: 'name', label: 'Student', width: 18 },
          ...r.subjects.map((s) => ({ key: `s${s.id}`, label: s.name, width: 9, align: 'center' as const })),
          { key: 'totalPct', label: 'Total %', width: 7, align: 'right' }, { key: 'grade', label: 'Grade', width: 6, align: 'center' }, { key: 'rankClass', label: 'Class rank', width: 7, align: 'center' }],
          rows: r.students.map((st: any) => ({ ...st, ...Object.fromEntries(st.subjects.map((x: any) => [`s${x.subjectId}`, x.finalPct == null ? '' : `${x.finalPct}${x.grade ? ` ${x.grade}` : ''}`])) })) };
      }
      case 'fee-dues': {
        await this.need(u, 'fees', 'fees.view', 'all');
        const p = z.object({ classId: id.optional(), sectionId: id.optional(), overdueOnly: z.enum(['0', '1']).optional(), search: z.string().max(100).optional() }).parse(q);
        const r = await this.fees.outstanding({ ...p, overdueOnly: p.overdueOnly === '1' });
        const sum = (k: string) => Math.round(r.rows.reduce((t: number, x: any) => t + Number(x[k]) * 100, 0)) / 100;
        return { title: 'Fee dues', subtitle: `Academic year ${r.academicYear} · ${r.students} students`, fileName: 'fee-dues', columns: [
          { key: 'admission_no', label: 'Adm no', width: 8 }, { key: 'name', label: 'Student', width: 18 }, { key: 'cls', label: 'Class', width: 9 }, { key: 'parent', label: 'Parent', width: 16 },
          { key: 'primary_mobile', label: 'Mobile', width: 11 }, { key: 'tuition', label: 'Tuition', width: 9, money: true }, { key: 'bus', label: 'Bus', width: 8, money: true },
          { key: 'one_time', label: 'Other', width: 8, money: true }, { key: 'previous', label: 'Old years', width: 9, money: true }, { key: 'overdue', label: 'Overdue', width: 9, money: true }, { key: 'total', label: 'Total', width: 10, money: true }],
          rows: r.rows.map((x: any) => ({ ...x, name: nm(x.first_name, x.last_name), cls: nm(x.class_name, x.section_name), parent: x.father_name || x.family_name })),
          totals: { name: 'Total', tuition: sum('tuition'), bus: sum('bus'), one_time: sum('one_time'), previous: sum('previous'), overdue: sum('overdue'), total: r.total } };
      }
      case 'fee-collection': {
        await this.need(u, 'payments', 'payments.view', 'all');
        const today = await schoolToday(this.db);
        const p = z.object({ from: date.default(today), to: date.default(today) }).parse(q);
        const r = await this.fees.collection(p.from, p.to);
        return { title: 'Fee collection', subtitle: `${p.from} to ${p.to} · valid receipts total ₹${new Intl.NumberFormat('en-IN').format(r.total)} (void and opening-balance receipts not counted)`, fileName: `fee-collection-${p.from}-to-${p.to}`, columns: [
          { key: 'date', label: 'Date', width: 10 }, { key: 'receipt_no', label: 'Receipt', width: 18 }, { key: 'name', label: 'Student', width: 18 }, { key: 'cls', label: 'Class', width: 9 },
          { key: 'method', label: 'Method', width: 9 }, { key: 'reference_no', label: 'Reference', width: 12 }, { key: 'total_amount', label: 'Amount', width: 10, money: true },
          { key: 'status', label: 'Status', width: 7 }, { key: 'collected_by', label: 'Collected by', width: 14 }],
          rows: r.receipts.map((x: any) => ({ ...x, date: d(x.payment_date), name: nm(x.first_name, x.last_name), cls: nm(x.class_name, x.section_name), method: METHOD[x.method] ?? x.method, status: x.status === 'void' ? 'VOID' : x.receipt_type === 'opening_balance' ? 'Opening' : 'Valid' })),
          totals: { name: 'Total (valid)', total_amount: r.total } };
      }
      case 'leaving-students': {
        await this.need(u, 'students', 'students.view', 'all');
        const r = await this.exams.exits(u);
        return { title: 'Leaving students', subtitle: 'TC and bonafide certificate checklist', fileName: 'leaving-students', columns: [
          { key: 'admissionNo', label: 'Adm no', width: 8 }, { key: 'name', label: 'Student', width: 18 }, { key: 'leavingDate', label: 'Left on', width: 10 }, { key: 'reason', label: 'Reason', width: 22 },
          { key: 'tc', label: 'TC', width: 18 }, { key: 'bonafide', label: 'Bonafide', width: 18 }],
          rows: r.map((x) => ({ ...x, tc: x.tc ? `${x.tc.number} (${x.tc.issuedOn})` : 'Not issued', bonafide: x.bonafide ? `${x.bonafide.number} (${x.bonafide.issuedOn})` : 'Not issued' })) };
      }
      case 'payroll-register': {
        await this.need(u, 'payroll', 'payroll.view');
        const p = z.object({ month }).parse(q);
        const r = await this.payroll.register(p.month);
        const earn = r.components.filter((c) => c.kind === 'earning'), ded = r.components.filter((c) => c.kind === 'deduction'), emp = r.components.filter((c) => c.kind === 'employer');
        const amt = (s: any, id: number) => s.lines.find((l: any) => l.componentId === id)?.amount ?? 0;
        const adj = (s: any, k: string) => s.adjustments.filter((a: any) => a.kind === k).reduce((t: number, a: any) => t + a.amount, 0);
        const cols = (list: typeof earn) => list.map((c) => ({ key: `c${c.id}`, label: c.name, width: 8, money: true }));
        const rows = r.slips.map((s) => ({ ...s, ...Object.fromEntries(r.components.map((c) => [`c${c.id}`, amt(s, c.id)])), addOther: adj(s, 'earning'), dedOther: adj(s, 'deduction') }));
        const tot = (k: string) => Math.round(rows.reduce((t: number, x: any) => t + Number(x[k] ?? 0) * 100, 0)) / 100;
        const moneyKeys = [...r.components.map((c) => `c${c.id}`), 'addOther', 'dedOther', 'gross', 'deductions', 'employer', 'net'];
        return { title: `Salary register ${r.label}`, subtitle: `${r.status === 'draft' ? 'DRAFT · ' : ''}${r.slips.length} staff · days in month ${r.divisor}`, fileName: `salary-register-${p.month}`, columns: [
          { key: 'code', label: 'Code', width: 7 }, { key: 'name', label: 'Name', width: 16 }, { key: 'paidDays', label: 'Paid days', width: 6, align: 'right' }, { key: 'lopDays', label: 'LOP', width: 5, align: 'right' },
          ...cols(earn), { key: 'addOther', label: 'Other additions', width: 8, money: true }, { key: 'gross', label: 'Gross', width: 9, money: true },
          ...cols(ded), { key: 'dedOther', label: 'Other deductions', width: 8, money: true }, { key: 'deductions', label: 'Total deductions', width: 9, money: true },
          { key: 'net', label: 'Net pay', width: 9, money: true }, ...cols(emp)],
          rows, totals: { name: 'Total', ...Object.fromEntries(moneyKeys.map((k) => [k, tot(k)])) } };
      }
      case 'bank-transfer': {
        await this.need(u, 'payroll', 'payroll.view');
        const p = z.object({ month }).parse(q);
        const r = await this.payroll.register(p.month);
        const rows = r.slips.map((s) => { const b = r.bank.get(s.id); return { code: s.code, name: s.name, bank: b?.bank_name ?? '', account: b?.bank_account_no ?? 'MISSING', ifsc: b?.bank_ifsc ?? '', net: s.net }; });
        return { title: `Salary bank transfer ${r.label}`, subtitle: `${r.status === 'draft' ? 'DRAFT · ' : ''}Net pay to each staff member's bank account`, fileName: `bank-transfer-${p.month}`, columns: [
          { key: 'code', label: 'Code', width: 8 }, { key: 'name', label: 'Name', width: 20 }, { key: 'bank', label: 'Bank', width: 16 }, { key: 'account', label: 'Account no', width: 16 },
          { key: 'ifsc', label: 'IFSC', width: 12 }, { key: 'net', label: 'Amount', width: 10, money: true }],
          rows, totals: { name: 'Total', net: r.totals.net } };
      }
      case 'expenses': {
        await this.need(u, 'expenses', 'expenses.view');
        const p = z.object({ from: date.optional(), to: date.optional(), status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(), categoryId: id.optional(), search: z.string().max(100).optional() }).parse(q);
        const r = await this.expenses.list(u, p);
        return { title: 'Expenses', subtitle: `${r.from} to ${r.to}${p.status ? ` · ${p.status}` : ''} · approved total ₹${new Intl.NumberFormat('en-IN').format(r.total)}`, fileName: `expenses-${r.from}-to-${r.to}`, columns: [
          { key: 'date', label: 'Date', width: 10 }, { key: 'voucherNo', label: 'Voucher', width: 17 }, { key: 'category', label: 'Category', width: 14 }, { key: 'paidTo', label: 'Paid to', width: 18 },
          { key: 'method', label: 'Method', width: 9 }, { key: 'reference', label: 'Reference', width: 11 }, { key: 'amount', label: 'Amount', width: 10, money: true }, { key: 'status', label: 'Status', width: 9 },
          { key: 'createdBy', label: 'Recorded by', width: 13 }, { key: 'decidedBy', label: 'Approved by', width: 13 }],
          rows: r.rows.map((x) => ({ ...x, method: METHOD[x.method] ?? x.method })), totals: { paidTo: 'Total approved', amount: r.total } };
      }
      case 'route-students': {
        await this.need(u, 'transport', 'transport.view');
        const p = z.object({ routeId: id }).parse(q);
        const r = (await this.transport.routes(u)).routes.find((x) => x.id === p.routeId);
        if (!r) throw Errors.notFound('Route');
        const list = await this.transport.routeStudents(u, p.routeId);
        const stop = new Map(r.stops.map((s) => [s.id, s]));
        return { title: `Bus list: ${r.name}`, subtitle: [r.vehicle && `${r.vehicle.regNo}${r.vehicle.driverName ? ` · driver ${r.vehicle.driverName}${r.vehicle.driverMobile ? ` ${r.vehicle.driverMobile}` : ''}` : ''}`, `${list.length} students`].filter(Boolean).join(' · '),
          fileName: `bus-list-${r.name.replace(/[^\w-]+/g, '-')}`, columns: [
          { key: 'stop', label: 'Stop', width: 16 }, { key: 'pickup', label: 'Pickup', width: 7 }, { key: 'drop', label: 'Drop', width: 7 }, { key: 'name', label: 'Student', width: 18 },
          { key: 'className', label: 'Class', width: 10 }, { key: 'parent', label: 'Parent', width: 16 }, { key: 'mobile', label: 'Mobile', width: 12 }],
          rows: list.map((x) => { const s = x.stopId ? stop.get(x.stopId) : null; return { ...x, stop: s?.name ?? 'No stop yet', pickup: s?.pickupTime ?? '', drop: s?.dropTime ?? '' }; }) };
      }
      case 'vehicle-log': {
        await this.need(u, 'transport', 'transport.log');
        const p = z.object({ vehicleId: id.optional(), from: date.optional(), to: date.optional() }).parse(q);
        const r = await this.transport.logs(p);
        const rows = r.rows.filter((x) => x.status === 'active');
        return { title: 'Fuel and service log', subtitle: `${r.from} to ${r.to} · fuel ₹${new Intl.NumberFormat('en-IN').format(r.totals.fuel)} · service ₹${new Intl.NumberFormat('en-IN').format(r.totals.service)} · ${r.totals.litres} L`,
          fileName: `vehicle-log-${r.from}-to-${r.to}`, columns: [
          { key: 'date', label: 'Date', width: 10 }, { key: 'regNo', label: 'Vehicle', width: 12 }, { key: 'kind', label: 'Type', width: 7 }, { key: 'odometer', label: 'Odometer', width: 9, align: 'right' },
          { key: 'litres', label: 'Litres', width: 7, align: 'right' }, { key: 'kmpl', label: 'km/L', width: 6, align: 'right' }, { key: 'vendor', label: 'Paid to', width: 15 }, { key: 'description', label: 'Details', width: 18 },
          { key: 'amount', label: 'Amount', width: 10, money: true }, { key: 'voucherNo', label: 'Voucher', width: 16 }],
          rows: rows.map((x) => ({ ...x, kind: x.kind === 'fuel' ? 'Fuel' : 'Service' })), totals: { description: 'Total', amount: Math.round((r.totals.fuel + r.totals.service) * 100) / 100 } };
      }
      case 'stock': {
        await this.need(u, 'inventory', 'inventory.view');
        const p = z.object({ category: z.string().max(60).optional(), low: z.enum(['1', 'true']).optional() }).parse(q);
        const r = await this.inventory.items({ category: p.category, low: !!p.low });
        return { title: p.low ? 'Low stock' : 'Stock', subtitle: `${r.items.length} items${p.category ? ` · ${p.category}` : ''}`, fileName: p.low ? 'low-stock' : 'stock', columns: [
          { key: 'category', label: 'Category', width: 14 }, { key: 'name', label: 'Item', width: 24 }, { key: 'unit', label: 'Unit', width: 6 }, { key: 'stockShown', label: 'In stock', width: 8, align: 'right' },
          { key: 'lowStockAt', label: 'Alert at', width: 8, align: 'right' }, { key: 'salePrice', label: 'Sale price', width: 10, money: true }],
          rows: r.items.map((x) => ({ ...x, stockShown: x.trackStock ? x.stock : 'Not counted' })) };
      }
      case 'sales': {
        await this.need(u, 'inventory', 'inventory.sell');
        const p = z.object({ from: date.optional(), to: date.optional(), search: z.string().max(100).optional() }).parse(q);
        const r = await this.inventory.sales(p);
        return { title: 'Sales', subtitle: `${r.from} to ${r.to} · ${r.count} receipts · ₹${new Intl.NumberFormat('en-IN').format(r.total)}`, fileName: `sales-${r.from}-to-${r.to}`, columns: [
          { key: 'date', label: 'Date', width: 10 }, { key: 'receiptNo', label: 'Receipt', width: 17 }, { key: 'buyer', label: 'Student / buyer', width: 16 }, { key: 'className', label: 'Class', width: 9 },
          { key: 'items', label: 'Items', width: 30 }, { key: 'method', label: 'Method', width: 8 }, { key: 'total', label: 'Amount', width: 10, money: true }, { key: 'status', label: 'Status', width: 9 }],
          rows: r.rows.map((x) => ({ ...x, method: METHOD[x.method] ?? x.method, status: x.status === 'cancelled' ? 'Cancelled' : 'Paid' })), totals: { items: 'Total (excluding cancelled)', total: r.total } };
      }
      case 'activity': {
        if (!u.isSuperAdmin || u.workspace !== 'staff') throw Errors.forbidden();
        const p = z.object({ from: date.optional(), to: date.optional(), type: z.enum(['signin', 'change', 'download']).optional(), userId: z.string().max(40).optional(), proxyOnly: z.string().optional(), module: z.string().max(50).optional() }).parse(q);
        const r = await this.activity.list({ ...p, proxyOnly: !!p.proxyOnly, limit: 500 });
        const ist = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
        const brief = (v: unknown) => (v == null ? '' : JSON.stringify(v).slice(0, 300));
        return { title: 'Activity log', subtitle: `${p.from ?? 'start'} to ${p.to ?? 'today'} · India time · ${r.rows.length} entries${r.next ? ' (first 500)' : ''}`, fileName: `activity-${p.from ?? 'all'}-to-${p.to ?? 'today'}`, columns: [
          { key: 'time', label: 'When (IST)', width: 16 }, { key: 'who', label: 'Who', width: 14 }, { key: 'via', label: 'Via Login as', width: 11 }, { key: 'what', label: 'What', width: 22 },
          { key: 'entity', label: 'About', width: 16 }, { key: 'before', label: 'Before', width: 22 }, { key: 'after', label: 'After', width: 22 }, { key: 'device', label: 'Device', width: 13 }, { key: 'ip', label: 'IP', width: 11 }],
          rows: r.rows.map((x) => ({ time: ist(x.at), who: x.who, via: x.actingName ? `by ${x.actingName}` : '', what: `${x.module ?? ''} · ${x.action}${x.reason ? ` (${x.reason})` : ''}`,
            entity: x.entity ?? (x.entityType ? `${x.entityType} #${x.entityId}` : ''), before: brief(x.before), after: brief(x.after), device: x.device ?? '', ip: x.ip ?? '' })) };
      }
      default: throw Errors.notFound('Export');
    }
  }

  private async sectionName(sectionId: number) {
    const s = await this.db.selectFrom('sections as s').innerJoin('classes as c', 'c.id', 's.class_id').select(['s.name', 'c.name as class_name']).where('s.id', '=', sectionId).executeTakeFirst();
    if (!s) throw Errors.notFound('Section');
    return `${s.class_name} ${s.name}`;
  }

  @Get(':name')
  async export(@CurrentUser() u: RequestUser, @Param('name') file: string, @Query() q: Record<string, string>, @Req() req: AppRequest, @Res() res: Response) {
    const m = /^([a-z-]+)\.(xlsx|pdf)$/.exec(file);
    if (!m) throw Errors.notFound('Export');
    let t: ExportTable;
    try { t = await this.build(u, m[1], q); } catch (e) { if (e instanceof z.ZodError) throw Errors.validation(e.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))); throw e; }
    const school = await this.db.selectFrom('institution_settings').select(['name', 'address', 'brand_primary']).where('id', '=', 1).executeTakeFirstOrThrow();
    const buf = m[2] === 'xlsx' ? await toXlsx(t) : await toPdf(t, school);
    await this.audit.log(u, { module: 'reports', action: 'export', after: { list: m[1], format: m[2], rows: t.rows.length, filters: q }, ...clientMeta(req) });
    const fname = `${t.fileName.replace(/[^\w.-]+/g, '-')}.${m[2]}`;
    res.setHeader('Content-Type', m[2] === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(buf);
  }
}
