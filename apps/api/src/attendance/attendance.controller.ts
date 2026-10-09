import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseIntPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { FilesService } from '../common/files.service';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { AttendanceService } from './attendance.service';
import { LeaveStaffService } from './leave-staff.service';
import { attendanceTemplate, commitAttendanceImport, planAttendanceImport } from './attendance-import';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM.');
const Status = z.enum(['present', 'absent', 'late', 'half_day', 'leave']);
const MarkBody = z.object({ date, entries: z.array(z.object({ studentId: z.string().length(26), status: Status })).min(1).max(200) });
const LeaveBody = z.object({ startDate: date, endDate: date, reason: z.string().trim().min(3, 'Give a short reason.').max(500), leaveTypeId: z.number().int().positive().nullish() });
const DateQ = z.object({ date: date.optional() });
const MonthQ = z.object({ month: month.optional() });

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller()
export class AttendanceController {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly att: AttendanceService, private readonly ls: LeaveStaffService, private readonly files: FilesService) {}

  // ---------------- Students ----------------
  @Get('attendance/overview') @RequirePermission('attendance', 'view')
  overview(@CurrentUser() u: RequestUser, @Query(new ZodPipe(DateQ)) q: { date?: string }) { return this.att.overview(u, q.date); }

  @Get('attendance/sections/:id') @RequirePermission('attendance', 'mark')
  section(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Query(new ZodPipe(DateQ)) q: { date?: string }) { return this.att.sectionDay(u, id, q.date); }

  @Put('attendance/sections/:id') @RequirePermission('attendance', 'mark')
  mark(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(MarkBody)) b: z.infer<typeof MarkBody>, @Req() req: AppRequest) {
    return this.att.markSection(u, id, b.date, b.entries, clientMeta(req));
  }

  @Get('attendance/sections/:id/month') @RequirePermission('attendance', 'view')
  sectionMonth(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Query(new ZodPipe(z.object({ month }))) q: { month: string }) { return this.att.sectionMonth(u, id, q.month); }

  @Get('attendance/absentees') @RequirePermission('attendance', 'view')
  absentees(@CurrentUser() u: RequestUser, @Query(new ZodPipe(DateQ)) q: { date?: string }) {
    if (u.permissions.get('attendance.view') !== 'all') throw Errors.forbidden();
    return this.att.absentees(q.date);
  }

  @Get('students/:id/attendance') @RequirePermission('attendance', 'view')
  student(@CurrentUser() u: RequestUser, @Param('id') id: string, @Query(new ZodPipe(MonthQ)) q: { month?: string }) { return this.att.studentAttendance(u, id, q.month); }

  // ---------------- Holidays ----------------
  @Get('attendance/holidays') @RequirePermission('attendance', 'view')
  holidays() { return this.att.holidays(); }

  @Post('attendance/holidays') @RequirePermission('academics', 'manage')
  addHoliday(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ name: z.string().trim().min(2).max(120), startDate: date, endDate: date.nullish() }))) b: any, @Req() req: AppRequest) {
    return this.att.addHoliday(u, b, clientMeta(req));
  }

  @Delete('attendance/holidays/:id') @RequirePermission('academics', 'manage')
  deleteHoliday(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Req() req: AppRequest) { return this.att.deleteHoliday(u, id, clientMeta(req)); }

  // ---------------- Leave ----------------
  @Post('students/:id/leave-requests') @RequirePermission('attendance', 'view')
  applyStudent(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(LeaveBody)) b: z.infer<typeof LeaveBody>, @Req() req: AppRequest) {
    return this.ls.applyForStudent(u, id, b, clientMeta(req));
  }

  @Post('leave-requests/mine')
  applySelf(@CurrentUser() u: RequestUser, @Body(new ZodPipe(LeaveBody)) b: z.infer<typeof LeaveBody>, @Req() req: AppRequest) { return this.ls.applyForSelf(u, b, clientMeta(req)); }

  @Get('leave-requests')
  leaves(@CurrentUser() u: RequestUser, @Query('status') status?: string) { return this.ls.list(u, status); }

  @Post('leave-requests/:id/decide') @HttpCode(200)
  decide(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(z.object({ approve: z.boolean(), note: z.string().trim().max(255).nullish() }))) b: { approve: boolean; note?: string | null }, @Req() req: AppRequest) {
    return this.ls.decide(u, id, b.approve, b.note ?? null, clientMeta(req));
  }

  @Post('leave-requests/:id/cancel') @HttpCode(200)
  cancel(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number) { return this.ls.cancel(u, id); }

  // ---------------- Staff ----------------
  @Post('staff-attendance/check-in') @HttpCode(200)
  checkIn(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000) }))) b: { lat: number; lng: number; accuracy: number }, @Req() req: AppRequest) {
    if (u.workspace !== 'staff') throw Errors.forbidden();
    return this.ls.checkIn(u, b, clientMeta(req));
  }

  @Get('staff-attendance/mine')
  mine(@CurrentUser() u: RequestUser, @Query(new ZodPipe(MonthQ)) q: { month?: string }) { return this.ls.mine(u, q.month); }

  @Get('staff-attendance') @RequirePermission('staff', 'view')
  staffDay(@Query(new ZodPipe(DateQ)) q: { date?: string }) { return this.ls.day(q.date); }

  @Put('staff-attendance') @RequirePermission('staff', 'edit')
  correct(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ date, entries: z.array(z.object({ staffId: z.string().length(26), status: z.enum(['present', 'absent', 'half_day', 'leave']).nullable() })).min(1) }))) b: any, @Req() req: AppRequest) {
    return this.ls.correct(u, b.date, b.entries, clientMeta(req));
  }

  @Get('attendance/location') @RequirePermission('settings', 'view')
  location() { return this.ls.location(); }

  @Put('attendance/location') @RequirePermission('settings', 'configure')
  setLocation(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusM: z.number().int().min(50).max(2000) }))) b: any, @Req() req: AppRequest) {
    return this.ls.setLocation(u, b, clientMeta(req));
  }

  // ---------------- Excel import ----------------
  @Get('attendance/import-template') @RequirePermission('attendance', 'mark')
  async template(@Query(new ZodPipe(z.object({ sectionId: z.coerce.number().int().positive(), month }))) q: { sectionId: number; month: string }, @Res() res: Response) {
    const t = await attendanceTemplate(this.db, q.sectionId, q.month);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${t.name}"`);
    res.send(t.buffer);
  }

  @Post('attendance/import/validate') @HttpCode(200) @RequirePermission('imports', 'run')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async validate(@CurrentUser() u: RequestUser, @UploadedFile() file?: Express.Multer.File) {
    if (u.permissions.get('attendance.mark') !== 'all') throw Errors.forbidden();
    if (!file) throw Errors.badRequest('NO_FILE', 'Choose an Excel file to upload.');
    if (!/\.xlsx$/i.test(file.originalname)) throw Errors.badRequest('WRONG_FILE_TYPE', 'Upload an Excel .xlsx file.');
    const plan = await planAttendanceImport(this.db, file.buffer);
    const fileId = await this.files.save(file.buffer, file.originalname, file.mimetype, 'imports', u.id);
    const errorRows = new Set(plan.errors.map((e) => e.row)).size;
    const r = await this.db.insertInto('import_jobs').values({ import_type: 'attendance', file_id: fileId, status: plan.errors.length ? 'invalid' : 'ready', total_rows: plan.totalRows,
      valid_rows: plan.totalRows - errorRows, error_rows: errorRows, errors: JSON.stringify(plan.errors.slice(0, 1000)), created_by: u.id }).executeTakeFirstOrThrow();
    return { jobId: Number(r.insertId), status: plan.errors.length ? 'invalid' : 'ready', totalRows: plan.totalRows, errorRows, errors: plan.errors.slice(0, 500), summary: plan.summary };
  }

  @Post('attendance/import/:jobId/commit') @HttpCode(200) @RequirePermission('imports', 'run')
  async commit(@CurrentUser() u: RequestUser, @Param('jobId', ParseIntPipe) jobId: number) {
    const job = await this.db.selectFrom('import_jobs').selectAll().where('id', '=', jobId).where('import_type', '=', 'attendance').executeTakeFirst();
    if (!job || job.created_by !== u.id) throw Errors.notFound('Import');
    if (job.status === 'completed') throw Errors.badRequest('ALREADY_IMPORTED', 'This file has already been imported.');
    if (job.status !== 'ready') throw Errors.badRequest('IMPORT_HAS_ERRORS', 'Fix the errors and upload the file again.');
    const plan = await planAttendanceImport(this.db, await this.files.read(job.file_id));
    if (plan.errors.length) return { status: 'invalid', errors: plan.errors.slice(0, 500) };
    await commitAttendanceImport(this.db, u.id, plan);
    await this.db.updateTable('import_jobs').set({ status: 'completed', completed_at: new Date() }).where('id', '=', jobId).execute();
    return { status: 'completed', summary: plan.summary };
  }
}
