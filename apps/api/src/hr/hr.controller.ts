import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { HrService, type HrBody, type LeaveTypeBody } from './hr.service';

const opt = (max: number) => z.string().trim().max(max).nullish();
const HrSchema = z.object({
  employmentType: z.enum(['permanent', 'probation', 'contract', 'part_time']).nullish(),
  bankName: opt(100), bankAccountNo: z.string().trim().regex(/^[0-9]{6,20}$/, 'Account number should be 6 to 20 digits.').or(z.literal('')).nullish(),
  bankIfsc: z.string().trim().regex(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, 'IFSC looks like SBIN0001234.').or(z.literal('')).nullish(),
  panNo: z.string().trim().regex(/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/, 'PAN looks like ABCDE1234F.').or(z.literal('')).nullish(),
  uanNo: opt(20), esiNo: opt(20), emergencyName: opt(100), emergencyMobile: opt(15),
  exitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).nullish(), exitReason: opt(255), notes: opt(1000),
}).strict();
const LeaveTypeSchema = z.object({
  code: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9]+$/, 'Letters and numbers only.'), name: z.string().trim().min(2).max(60),
  daysPerYear: z.number().min(0).max(365).multipleOf(0.5).nullable(), isPaid: z.boolean(), isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).max(999).optional(),
});

@ApiTags('HR')
@ApiBearerAuth()
@Controller()
export class HrController {
  constructor(private readonly hr: HrService) {}

  @Get('hr/staff/:id') @RequirePermission('hr', 'view')
  get(@Param('id') id: string) { return this.hr.get(id); }

  @Put('hr/staff/:id') @RequirePermission('hr', 'manage')
  save(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(HrSchema)) b: HrBody, @Req() r: AppRequest) { return this.hr.save(u, id, b, clientMeta(r)); }

  @Get('hr/leave-types') @RequirePermission('hr', 'view')
  types() { return this.hr.leaveTypes(); }

  @Post('hr/leave-types') @RequirePermission('hr', 'manage')
  addType(@CurrentUser() u: RequestUser, @Body(new ZodPipe(LeaveTypeSchema)) b: LeaveTypeBody, @Req() r: AppRequest) { return this.hr.saveLeaveType(u, null, b, clientMeta(r)); }

  @Patch('hr/leave-types/:id') @RequirePermission('hr', 'manage')
  editType(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(LeaveTypeSchema)) b: LeaveTypeBody, @Req() r: AppRequest) { return this.hr.saveLeaveType(u, id, b, clientMeta(r)); }

  @Get('hr/leave-balances') @RequirePermission('hr', 'view')
  balances() { return this.hr.allBalances(); }

  /** Any signed-in staff member: their own leave balances (for the leave form). */
  @Get('leave-balances/mine')
  mine(@CurrentUser() u: RequestUser) { return this.hr.myBalances(u); }
}
