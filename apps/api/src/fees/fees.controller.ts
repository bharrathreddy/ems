import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { currentYear } from '../common/academic-year';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { visibleStudentId } from '../students/student-scope';
import { FeeAccountsService } from './fee-accounts.service';
import { FeeSetupService } from './fee-setup.service';
import { FeeReportsService } from './fee-reports.service';
import { PaymentsService, waiveDues } from './payments.service';
import { FeeRemindersService } from './fee-reminders.service';
import { schoolToday } from '../attendance/calendar';
import { requireInstitutionAdmin } from '../common/admin';
import { renderReceiptPdf } from './receipt-pdf';
import { toDb } from './money';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const rupees = z.coerce.number().min(0).max(10_000_000).refine((v) => Number.isInteger(v * 100), 'At most 2 decimals.');
const PlanKey = z.enum(['yearly', 'half_yearly', 'quarterly']);
const Installments = z.object({ planKey: PlanKey, items: z.array(z.object({ installmentNo: z.number().int().min(1).max(4), label: z.string().trim().min(1).max(30), dueDate: date })).min(1).max(4) });
const ClassFees = z.object({ items: z.array(z.object({ classId: z.number().int().positive(), amount: rupees })).min(1) });
const RouteFees = z.object({ items: z.array(z.object({ routeId: z.number().int().positive(), amount: rupees, dueDate: date.nullish() })).min(1) });
const Named = z.object({ name: z.string().trim().min(2).max(100) });
const OneTime = z.object({ classId: z.number().int().positive(), typeId: z.number().int().positive(), title: z.string().trim().min(2).max(150), amount: rupees.refine((v) => v > 0, 'Enter an amount.'), dueDate: date.nullish() });
const AccountPatch = z.object({
  planKey: PlanKey.optional(),
  busRouteId: z.number().int().positive().nullable().optional(),
  tuitionDiscount: rupees.optional(), tuitionConcessionTypeId: z.number().int().positive().nullable().optional(),
  busDiscount: rupees.optional(), busConcessionTypeId: z.number().int().positive().nullable().optional(),
});
const Collect = z.object({
  studentId: z.string().length(26),
  paymentDate: date,
  method: z.enum(['cash', 'upi', 'cheque', 'bank_transfer', 'card']),
  referenceNo: z.string().trim().max(100).nullish().transform((v) => v || null),
  remarks: z.string().trim().max(255).nullish().transform((v) => v || null),
  lines: z.array(z.discriminatedUnion('category', [
    z.object({ category: z.literal('tuition'), academicYearId: z.number().int().positive(), amount: rupees }),
    z.object({ category: z.literal('bus'), academicYearId: z.number().int().positive(), amount: rupees }),
    z.object({ category: z.literal('one_time'), feeItemId: z.number().int().positive(), amount: rupees }),
  ])).min(1, 'Enter an amount for at least one fee.'),
});
const Range = z.object({ from: date, to: date });
const YearQ = z.object({ yearId: z.coerce.number().int().positive().optional() });
const DuesQuery = z.object({ classId: z.coerce.number().int().positive().optional(), sectionId: z.coerce.number().int().positive().optional(), overdueOnly: z.enum(['1', '0']).optional(), search: z.string().trim().max(100).optional() });

@ApiTags('Fees')
@ApiBearerAuth()
@Controller()
export class FeesController {
  constructor(
    @Inject(KYSELY) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly accounts: FeeAccountsService,
    private readonly setup: FeeSetupService,
    private readonly reports: FeeReportsService,
    private readonly payments: PaymentsService,
    private readonly reminders: FeeRemindersService,
  ) {}

  private requireAll(u: RequestUser, perm: string) {
    if (u.permissions.get(perm) !== 'all') throw Errors.forbidden();
  }

  // ---------------- Setup ----------------
  @Get('fees/setup') @RequirePermission('fees', 'view')
  getSetup(@CurrentUser() u: RequestUser, @Query(new ZodPipe(YearQ)) q: z.infer<typeof YearQ>) { this.requireAll(u, 'fees.view'); return this.setup.get(q.yearId); }

  @Put('fees/setup/default-plan') @RequirePermission('fees', 'configure')
  defaultPlan(@CurrentUser() u: RequestUser, @Query(new ZodPipe(YearQ)) q: z.infer<typeof YearQ>, @Body(new ZodPipe(z.object({ planKey: PlanKey }))) b: { planKey: any }, @Req() r: AppRequest) { return this.setup.setDefaultPlan(u, b.planKey, clientMeta(r), q.yearId); }

  @Put('fees/setup/installments') @RequirePermission('fees', 'configure')
  installments(@CurrentUser() u: RequestUser, @Query(new ZodPipe(YearQ)) q: z.infer<typeof YearQ>, @Body(new ZodPipe(Installments)) b: z.infer<typeof Installments>, @Req() r: AppRequest) { return this.setup.setInstallments(u, b.planKey, b.items, clientMeta(r), q.yearId); }

  @Put('fees/setup/class-fees') @RequirePermission('fees', 'configure')
  classFees(@CurrentUser() u: RequestUser, @Query(new ZodPipe(YearQ)) q: z.infer<typeof YearQ>, @Body(new ZodPipe(ClassFees)) b: z.infer<typeof ClassFees>, @Req() r: AppRequest) { return this.setup.setClassFees(u, b.items, clientMeta(r), q.yearId); }

  @Post('fees/routes') @RequirePermission('fees', 'configure')
  createRoute(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Named)) b: { name: string }, @Req() r: AppRequest) { return this.setup.createRoute(u, b.name, clientMeta(r)); }

  @Patch('fees/routes/:id') @RequirePermission('fees', 'configure')
  updateRoute(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(z.object({ name: z.string().trim().min(2).max(100).optional(), isActive: z.boolean().optional() }))) b: any, @Req() r: AppRequest) { return this.setup.updateRoute(u, id, b, clientMeta(r)); }

  @Put('fees/setup/route-fees') @RequirePermission('fees', 'configure')
  routeFees(@CurrentUser() u: RequestUser, @Query(new ZodPipe(YearQ)) q: z.infer<typeof YearQ>, @Body(new ZodPipe(RouteFees)) b: z.infer<typeof RouteFees>, @Req() r: AppRequest) { return this.setup.setRouteFees(u, b.items, clientMeta(r), q.yearId); }

  @Post('fees/setup/copy') @RequirePermission('fees', 'configure')
  copySetup(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ fromYearId: z.number().int().positive(), toYearId: z.number().int().positive() }))) b: { fromYearId: number; toYearId: number }, @Req() r: AppRequest) {
    return this.setup.copy(u, b.fromYearId, b.toYearId, clientMeta(r));
  }

  @Post('fees/concession-types') @RequirePermission('fees', 'configure')
  concession(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Named)) b: { name: string }, @Req() r: AppRequest) { return this.setup.createNamed(u, 'concession_types', b.name, clientMeta(r)); }

  @Post('fees/one-time-types') @RequirePermission('fees', 'configure')
  oneTimeType(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Named)) b: { name: string }, @Req() r: AppRequest) { return this.setup.createNamed(u, 'one_time_fee_types', b.name, clientMeta(r)); }

  @Post('fees/one-time') @RequirePermission('fees', 'configure')
  oneTime(@CurrentUser() u: RequestUser, @Query(new ZodPipe(YearQ)) q: z.infer<typeof YearQ>, @Body(new ZodPipe(OneTime)) b: z.infer<typeof OneTime>, @Req() r: AppRequest) { return this.setup.createOneTime(u, b, clientMeta(r), q.yearId); }

  @Delete('fees/one-time/:id') @RequirePermission('fees', 'configure')
  deleteOneTime(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Req() r: AppRequest) { return this.setup.deleteOneTime(u, id, clientMeta(r)); }

  // ---------------- Student account ----------------
  @Get('students/:id/fees') @RequirePermission('fees', 'view')
  async studentFees(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    const year = await currentYear(this.db);
    const sid = await visibleStudentId(this.db, u, id, 'fees.view', year.id);
    return { academicYearId: year.id, ...(await this.accounts.view(sid, year.id)) };
  }

  @Patch('students/:id/fee-account') @RequirePermission('fees', 'view')
  async patchAccount(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(AccountPatch)) b: z.infer<typeof AccountPatch>, @Req() req: AppRequest) {
    const year = await currentYear(this.db);
    const sid = await visibleStudentId(this.db, u, id, 'fees.view', year.id);
    const discountChange = b.tuitionDiscount !== undefined || b.busDiscount !== undefined || b.tuitionConcessionTypeId !== undefined || b.busConcessionTypeId !== undefined;
    if (discountChange && !u.permissions.has('fees.discount')) throw Errors.forbidden();
    if ((b.planKey || b.busRouteId !== undefined) && !u.permissions.has('fees.configure')) throw Errors.forbidden();
    await this.db.transaction().execute(async (trx) => {
      const accId = await this.accounts.ensureAccount(trx, sid, year.id);
      if (!accId) throw Errors.badRequest('FEES_NOT_CONFIGURED', 'Set the default plan and this class\'s tuition fee in Fee setup first.');
      const a = await trx.selectFrom('student_fee_accounts').selectAll().where('id', '=', accId).forUpdate().executeTakeFirstOrThrow();
      if (a.has_payments) throw Errors.badRequest('FEES_LOCKED', 'Fee details are locked after the first payment this year.');
      const patch: Record<string, unknown> = {};
      if (b.planKey) {
        if (!this.accounts.planChangeAllowed(a, year)) throw Errors.badRequest('PLAN_LOCKED', 'The plan cannot be changed after the academic year has started.');
        patch.fee_plan_id = (await trx.selectFrom('fee_plans').select('id').where('plan_key', '=', b.planKey).executeTakeFirstOrThrow()).id;
      }
      // Bus: route, fee and discount are set together so the "discount <= fee" rule always holds (F15 to F17).
      if (b.busRouteId !== undefined || b.busDiscount !== undefined) {
        const routeId = b.busRouteId !== undefined ? b.busRouteId : a.bus_route_id;
        const rf = routeId ? await trx.selectFrom('route_fees').select('amount').where('academic_year_id', '=', year.id).where('bus_route_id', '=', routeId).executeTakeFirst() : null;
        if (routeId && !rf) throw Errors.validation([{ field: 'busRouteId', message: 'Set this route\'s fee in Fee setup first.' }]);
        const gross = rf ? Math.round(Number(rf.amount) * 100) : 0;
        const disc = b.busDiscount !== undefined ? Math.round(b.busDiscount * 100) : routeId === a.bus_route_id ? Math.round(Number(a.bus_discount) * 100) : 0;
        if (disc > gross) throw Errors.validation([{ field: 'busDiscount', message: routeId ? 'Discount cannot be more than the bus fee.' : 'Choose a bus route first.' }]);
        patch.bus_route_id = routeId; patch.bus_gross = toDb(gross); patch.bus_discount = toDb(disc);
      }
      if (b.tuitionDiscount !== undefined) {
        if (Math.round(b.tuitionDiscount * 100) > Math.round(Number(a.tuition_gross) * 100)) throw Errors.validation([{ field: 'tuitionDiscount', message: 'Discount cannot be more than the tuition fee.' }]);
        patch.tuition_discount = toDb(Math.round(b.tuitionDiscount * 100));
      }
      if (b.tuitionConcessionTypeId !== undefined) patch.tuition_concession_type_id = b.tuitionConcessionTypeId;
      if (b.busConcessionTypeId !== undefined) patch.bus_concession_type_id = b.busConcessionTypeId;
      if (Object.keys(patch).length) {
        await trx.updateTable('student_fee_accounts').set(patch).where('id', '=', accId).execute();
        await this.accounts.rebuild(trx, accId);
      }
      await this.audit.log(u, { module: 'fees', action: 'update_account', entityType: 'student_fee_account', entityId: accId, before: a, after: b, ...clientMeta(req) }, trx);
    });
    return { academicYearId: year.id, ...(await this.accounts.view(sid, year.id)) };
  }

  /** Requirements 22.1: after all receipts were voided, an admin can unlock fee details again (audited). */
  @Post('students/:id/fee-account/unlock') @HttpCode(200) @RequirePermission('fees', 'configure')
  async unlock(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: AppRequest) {
    const year = await currentYear(this.db);
    const sid = await visibleStudentId(this.db, u, id, 'fees.view', year.id);
    const acc = await this.db.selectFrom('student_fee_accounts').select('id').where('student_id', '=', sid).where('academic_year_id', '=', year.id).executeTakeFirst();
    if (!acc) throw Errors.notFound('Fee account');
    const paid = await this.db.selectFrom('payment_allocations as pa').innerJoin('fee_items as i', 'i.id', 'pa.fee_item_id').select('pa.id')
      .where('i.student_fee_account_id', '=', acc.id).executeTakeFirst();
    if (paid) throw Errors.badRequest('HAS_VALID_RECEIPTS', 'Void the valid receipts for this year first.');
    await this.db.updateTable('student_fee_accounts').set({ has_payments: 0 }).where('id', '=', acc.id).execute();
    await this.audit.log(u, { module: 'fees', action: 'unlock_account', entityType: 'student_fee_account', entityId: acc.id, ...clientMeta(req) });
    return { academicYearId: year.id, ...(await this.accounts.view(sid, year.id)) };
  }

  @Post('students/:id/waivers') @RequirePermission('fees', 'view')
  async waive(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ academicYearId: z.number().int().positive(), amount: rupees, reason: z.string().trim().min(5, 'Give the reason (who approved it and why).').max(255) }))) b: { academicYearId: number; amount: number; reason: string }, @Req() req: AppRequest) {
    requireInstitutionAdmin(u);
    const year = await currentYear(this.db);
    const sid = await visibleStudentId(this.db, u, id, 'fees.view', year.id);
    const r = await waiveDues(this.db, u, sid, b.academicYearId, b.amount, b.reason);
    await this.audit.log(u, { module: 'fees', action: 'waiver', entityType: 'fee_waiver', entityId: r.waiverId, after: b, ...clientMeta(req) });
    return { academicYearId: year.id, ...(await this.accounts.view(sid, year.id)) };
  }

  // ---------------- Payments ----------------
  @Post('payments') @RequirePermission('payments', 'collect')
  async collect(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Collect)) b: z.infer<typeof Collect>, @Req() req: AppRequest) {
    const year = await currentYear(this.db);
    const sid = await visibleStudentId(this.db, u, b.studentId, 'payments.collect', year.id);
    return this.payments.collect(u, { ...b, studentId: sid }, clientMeta(req));
  }

  private async assertReceiptVisible(u: RequestUser, publicId: string) {
    const year = await currentYear(this.db);
    const studentId = await this.payments.findStudentId(publicId);
    const s = await this.db.selectFrom('students').select('public_id').where('id', '=', studentId).executeTakeFirstOrThrow();
    await visibleStudentId(this.db, u, s.public_id, 'payments.view', year.id);
  }

  @Get('payments/:id') @RequirePermission('payments', 'view')
  async receipt(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    await this.assertReceiptVisible(u, id);
    return this.payments.receipt(id);
  }

  @Get('payments/:id/pdf') @RequirePermission('payments', 'view')
  async pdf(@CurrentUser() u: RequestUser, @Param('id') id: string, @Res() res: Response) {
    await this.assertReceiptVisible(u, id);
    const r = await this.payments.receipt(id);
    const buf = await renderReceiptPdf(r);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${r.receipt_no.replace(/\//g, '-')}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }

  @Post('payments/:id/void') @HttpCode(200) @RequirePermission('payments', 'void')
  voidReceipt(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(3, 'Give a reason.').max(255) }))) b: { reason: string }, @Req() req: AppRequest) {
    return this.payments.void(u, id, b.reason, clientMeta(req));
  }

  // ---------------- Reports ----------------
  // ---------------- Reminder emails ----------------
  @Get('fees/reminders') @RequirePermission('fees', 'view')
  reminderSettings(@CurrentUser() u: RequestUser) { this.requireAll(u, 'fees.view'); return this.reminders.settings(); }

  @Put('fees/reminders') @RequirePermission('fees', 'configure')
  saveReminders(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ enabled: z.boolean(), daysBefore: z.number().int().min(0).max(30), overdueEveryDays: z.number().int().min(1).max(60) }))) b: any) {
    return this.reminders.saveSettings(u, b);
  }

  @Post('fees/reminders/run') @HttpCode(200) @RequirePermission('fees', 'configure')
  async runReminders(@CurrentUser() u: RequestUser, @Req() r: AppRequest) {
    const res = await this.reminders.run(await schoolToday(this.db));
    await this.audit.log(u, { module: 'fees', action: 'run_reminders', after: res, ...clientMeta(r) });
    return res;
  }

  @Post('students/:id/fee-reminder') @HttpCode(200) @RequirePermission('fees', 'view')
  async remindOne(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() r: AppRequest) {
    this.requireAll(u, 'fees.view');
    const res = await this.reminders.sendOne(u, id);
    await this.audit.log(u, { module: 'fees', action: 'email_reminder', after: { student: id, ...res }, ...clientMeta(r) });
    return res;
  }

  @Get('fees/summary') @RequirePermission('fees', 'view')
  summary(@CurrentUser() u: RequestUser) { this.requireAll(u, 'fees.view'); return this.reports.summary(); }

  @Get('fees/reports/collection') @RequirePermission('payments', 'view')
  collection(@CurrentUser() u: RequestUser, @Query(new ZodPipe(Range)) q: z.infer<typeof Range>) { this.requireAll(u, 'payments.view'); return this.reports.collection(q.from, q.to); }

  @Get('fees/reports/collection.xlsx') @RequirePermission('payments', 'view')
  async collectionXlsx(@CurrentUser() u: RequestUser, @Query(new ZodPipe(Range)) q: z.infer<typeof Range>, @Res() res: Response) {
    this.requireAll(u, 'payments.view');
    this.sendXlsx(res, `collection-${q.from}-to-${q.to}.xlsx`, await this.reports.collectionXlsx(q.from, q.to));
  }

  @Get('fees/reports/outstanding') @RequirePermission('fees', 'view')
  outstanding(@CurrentUser() u: RequestUser, @Query(new ZodPipe(DuesQuery)) q: z.infer<typeof DuesQuery>) {
    this.requireAll(u, 'fees.view');
    return this.reports.outstanding({ ...q, overdueOnly: q.overdueOnly === '1' });
  }

  @Get('fees/reports/outstanding.xlsx') @RequirePermission('fees', 'view')
  async outstandingXlsx(@CurrentUser() u: RequestUser, @Query(new ZodPipe(DuesQuery)) q: z.infer<typeof DuesQuery>, @Res() res: Response) {
    this.requireAll(u, 'fees.view');
    this.sendXlsx(res, 'fee-dues.xlsx', await this.reports.outstandingXlsx({ ...q, overdueOnly: q.overdueOnly === '1' }));
  }

  private sendXlsx(res: Response, name: string, buf: Buffer) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(buf);
  }
}
