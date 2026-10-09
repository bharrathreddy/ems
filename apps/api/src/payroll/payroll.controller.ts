import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { Errors } from '../common/app-error';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { PermissionsService } from '../permissions/permissions.service';
import { PayrollService, type ComponentBody, type PayrollRules } from './payroll.service';
import { ExpensesService, type ExpenseBody, type ExpenseRules } from './expenses.service';
import { renderPayslipPdf } from './payslip-pdf';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month.');
const money = z.number().min(0).max(99_99_99_999).multipleOf(0.01);
const method = z.enum(['cash', 'upi', 'cheque', 'bank_transfer', 'card']);
const Component = z.object({
  code: z.string().trim().min(1).max(12).regex(/^[A-Za-z0-9_]+$/, 'Letters, numbers and _ only.'), name: z.string().trim().min(2).max(60),
  kind: z.enum(['earning', 'deduction', 'employer']), calc: z.enum(['fixed', 'pct_basic', 'pct_gross']), defaultValue: money, maxAmount: money.nullish(),
  prorate: z.boolean(), isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).max(999).optional(),
});
const Lines = z.array(z.object({ componentId: z.number().int().positive(), value: money })).min(1).max(40);
const Template = z.object({ name: z.string().trim().min(2).max(80), isActive: z.boolean().optional(), lines: Lines });
const Salary = z.object({ effectiveFrom: date, templateId: z.number().int().positive().nullish(), lines: Lines, note: z.string().trim().max(255).nullish() });
const Slip = z.object({
  lopDays: z.number().min(0).max(31).multipleOf(0.5),
  adjustments: z.array(z.object({ label: z.string().trim().min(2).max(60), kind: z.enum(['earning', 'deduction']), amount: money.refine((v) => v > 0, 'Enter an amount.') })).max(10),
  note: z.string().trim().max(255).nullish(),
});
const Expense = z.object({
  date, categoryId: z.number().int().positive(), amount: money.refine((v) => v > 0, 'Enter the amount.'), paidTo: z.string().trim().min(2, 'Who was paid?').max(150),
  method, reference: z.string().trim().max(100).nullish(), description: z.string().trim().max(500).nullish(),
});
const Paid = z.object({ paidOn: date, method, reference: z.string().trim().max(100).nullish() });
const ExpenseList = z.object({ from: date.optional(), to: date.optional(), status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(), categoryId: z.coerce.number().int().positive().optional(), search: z.string().trim().max(100).optional() });

@ApiTags('Payroll')
@ApiBearerAuth()
@Controller()
export class PayrollController {
  constructor(private readonly pay: PayrollService, private readonly exp: ExpensesService, private readonly perms: PermissionsService) {}

  // ---------- Rules, pay items, templates ----------
  @Get('payroll/settings') @RequirePermission('payroll', 'view')
  rules() { return this.pay.rules(); }
  @Put('payroll/settings') @RequirePermission('payroll', 'finalise')
  setRules(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ lopDivisor: z.enum(['month_days', 'thirty', 'working_days']) }))) b: PayrollRules, @Req() r: AppRequest) { return this.pay.setRules(u, b, clientMeta(r)); }

  @Get('payroll/components') @RequirePermission('payroll', 'view')
  components() { return this.pay.components(); }
  @Post('payroll/components') @RequirePermission('payroll', 'manage')
  addComponent(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Component)) b: ComponentBody, @Req() r: AppRequest) { return this.pay.saveComponent(u, null, b, clientMeta(r)); }
  @Patch('payroll/components/:id') @RequirePermission('payroll', 'manage')
  editComponent(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(Component)) b: ComponentBody, @Req() r: AppRequest) { return this.pay.saveComponent(u, id, b, clientMeta(r)); }

  @Get('payroll/templates') @RequirePermission('payroll', 'view')
  templates() { return this.pay.templates(); }
  @Post('payroll/templates') @RequirePermission('payroll', 'manage')
  addTemplate(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Template)) b: z.infer<typeof Template>, @Req() r: AppRequest) { return this.pay.saveTemplate(u, null, b, clientMeta(r)); }
  @Patch('payroll/templates/:id') @RequirePermission('payroll', 'manage')
  editTemplate(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(Template)) b: z.infer<typeof Template>, @Req() r: AppRequest) { return this.pay.saveTemplate(u, id, b, clientMeta(r)); }
  @Delete('payroll/templates/:id') @RequirePermission('payroll', 'manage')
  deleteTemplate(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Req() r: AppRequest) { return this.pay.deleteTemplate(u, id, clientMeta(r)); }

  // ---------- Staff salaries ----------
  @Get('payroll/salaries') @RequirePermission('payroll', 'view')
  salaries() { return this.pay.salaries(); }
  @Get('payroll/salaries/:staffId') @RequirePermission('payroll', 'view')
  salary(@Param('staffId') id: string) { return this.pay.salary(id); }
  @Put('payroll/salaries/:staffId') @RequirePermission('payroll', 'manage')
  setSalary(@CurrentUser() u: RequestUser, @Param('staffId') id: string, @Body(new ZodPipe(Salary)) b: z.infer<typeof Salary>, @Req() r: AppRequest) { return this.pay.setSalary(u, id, b, clientMeta(r)); }
  @Post('payroll/templates/:id/apply') @HttpCode(200) @RequirePermission('payroll', 'manage')
  apply(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(z.object({ staffIds: z.array(z.string()).min(1).max(500), effectiveFrom: date }))) b: { staffIds: string[]; effectiveFrom: string }, @Req() r: AppRequest) {
    return this.pay.applyTemplate(u, id, b.staffIds, b.effectiveFrom, clientMeta(r));
  }

  // ---------- Monthly payroll ----------
  @Get('payroll/runs') @RequirePermission('payroll', 'view')
  runs() { return this.pay.runs(); }
  @Post('payroll/runs') @RequirePermission('payroll', 'manage')
  create(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ month }))) b: { month: string }, @Req() r: AppRequest) { return this.pay.createRun(u, b.month, clientMeta(r)); }
  @Get('payroll/runs/:month') @RequirePermission('payroll', 'view')
  run(@Param('month', new ZodPipe(month)) m: string) { return this.pay.getRun(m); }
  @Delete('payroll/runs/:month') @RequirePermission('payroll', 'manage')
  remove(@CurrentUser() u: RequestUser, @Param('month', new ZodPipe(month)) m: string, @Req() r: AppRequest) { return this.pay.deleteRun(u, m, clientMeta(r)); }
  @Post('payroll/runs/:month/refresh') @HttpCode(200) @RequirePermission('payroll', 'manage')
  refresh(@CurrentUser() u: RequestUser, @Param('month', new ZodPipe(month)) m: string, @Req() r: AppRequest) { return this.pay.syncSlips(u, m, true, clientMeta(r)); }
  @Post('payroll/runs/:month/fill-lop') @HttpCode(200) @RequirePermission('payroll', 'manage')
  fill(@CurrentUser() u: RequestUser, @Param('month', new ZodPipe(month)) m: string, @Req() r: AppRequest) { return this.pay.fillLop(u, m, clientMeta(r)); }
  @Patch('payroll/runs/:month/slips/:id') @RequirePermission('payroll', 'manage')
  slip(@CurrentUser() u: RequestUser, @Param('month', new ZodPipe(month)) m: string, @Param('id') id: string, @Body(new ZodPipe(Slip)) b: z.infer<typeof Slip>, @Req() r: AppRequest) { return this.pay.updateSlip(u, m, id, b, clientMeta(r)); }
  @Post('payroll/runs/:month/finalise') @HttpCode(200) @RequirePermission('payroll', 'finalise')
  finalise(@CurrentUser() u: RequestUser, @Param('month', new ZodPipe(month)) m: string, @Req() r: AppRequest) { return this.pay.finalise(u, m, clientMeta(r)); }
  @Post('payroll/runs/:month/reopen') @HttpCode(200) @RequirePermission('payroll', 'finalise')
  reopen(@CurrentUser() u: RequestUser, @Param('month', new ZodPipe(month)) m: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(3, 'Give a reason.').max(255) }))) b: { reason: string }, @Req() r: AppRequest) { return this.pay.reopen(u, m, b.reason, clientMeta(r)); }
  @Post('payroll/runs/:month/paid') @HttpCode(200) @RequirePermission('payroll', 'manage')
  paid(@CurrentUser() u: RequestUser, @Param('month', new ZodPipe(month)) m: string, @Body(new ZodPipe(Paid)) b: z.infer<typeof Paid>, @Req() r: AppRequest) {
    return this.pay.markPaid(u, m, b, clientMeta(r));
  }

  // ---------- Payslips ----------
  /** Any staff member: their own payslips once finalised. */
  @Get('payslips/mine')
  async mine(@CurrentUser() u: RequestUser) {
    if (!(await this.perms.isModuleEnabled('payroll'))) throw Errors.featureDisabled('payroll');
    return this.pay.mine(u);
  }
  @Get('payslips/:id/pdf')
  async pdf(@CurrentUser() u: RequestUser, @Param('id') id: string, @Res() res: Response) {
    if (!(await this.perms.isModuleEnabled('payroll'))) throw Errors.featureDisabled('payroll');
    const p = await this.pay.payslip(u, id);
    const buf = await renderPayslipPdf(p);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="payslip-${p.month}-${p.code.replace(/[^\w-]+/g, '')}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }

  // ---------- Expenses ----------
  @Get('expenses/settings') @RequirePermission('expenses', 'view')
  expRules() { return this.exp.rules(); }
  @Put('expenses/settings') @RequirePermission('expenses', 'configure')
  setExpRules(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ mode: z.enum(['none', 'all', 'above']), limit: money }))) b: ExpenseRules, @Req() r: AppRequest) { return this.exp.setRules(u, b, clientMeta(r)); }
  @Get('expenses/categories') @RequirePermission('expenses', 'view')
  categories() { return this.exp.categories(); }
  @Post('expenses/categories') @RequirePermission('expenses', 'configure')
  addCategory(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ name: z.string().trim().min(2).max(80), isActive: z.boolean().optional() }))) b: { name: string; isActive?: boolean }, @Req() r: AppRequest) { return this.exp.saveCategory(u, null, b, clientMeta(r)); }
  @Patch('expenses/categories/:id') @RequirePermission('expenses', 'configure')
  editCategory(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(z.object({ name: z.string().trim().min(2).max(80), isActive: z.boolean().optional() }))) b: { name: string; isActive?: boolean }, @Req() r: AppRequest) { return this.exp.saveCategory(u, id, b, clientMeta(r)); }

  @Get('expenses') @RequirePermission('expenses', 'view')
  list(@CurrentUser() u: RequestUser, @Query(new ZodPipe(ExpenseList)) q: z.infer<typeof ExpenseList>) { return this.exp.list(u, q); }
  @Post('expenses') @RequirePermission('expenses', 'create')
  addExpense(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Expense)) b: ExpenseBody, @Req() r: AppRequest) { return this.exp.create(u, b, clientMeta(r)); }
  @Post('expenses/:id/decide') @HttpCode(200) @RequirePermission('expenses', 'approve')
  decide(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ approve: z.boolean(), note: z.string().trim().max(255).nullish() }))) b: { approve: boolean; note?: string | null }, @Req() r: AppRequest) {
    return this.exp.decide(u, id, b.approve, b.note || null, clientMeta(r));
  }
  @Post('expenses/:id/cancel') @HttpCode(200) @RequirePermission('expenses', 'view')
  cancel(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(3, 'Give a reason.').max(255) }))) b: { reason: string }, @Req() r: AppRequest) { return this.exp.cancel(u, id, b.reason, clientMeta(r)); }
  @Post('expenses/:id/bill') @RequirePermission('expenses', 'view')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  bill(@CurrentUser() u: RequestUser, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw Errors.badRequest('NO_FILE', 'Choose a photo or PDF of the bill.');
    return this.exp.attachBill(u, id, file);
  }
  @Get('expenses/:id/bill') @RequirePermission('expenses', 'view')
  async getBill(@Param('id') id: string, @Res() res: Response) {
    const f = await this.exp.bill(id);
    res.setHeader('Content-Type', f.mime); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    f.stream.pipe(res);
  }
}
