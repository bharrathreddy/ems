import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { TransportService, type LogBody, type StopBody, type VehicleBody } from './transport.service';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 07:15.');
const mobile = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number.');
const blank = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === '' ? null : v), t.nullish());
const money = z.number().min(0).max(99_99_99_999).multipleOf(0.01);
const Vehicle = z.object({
  regNo: z.string().trim().min(4, 'Enter the registration number.').max(20), name: z.string().trim().max(80).nullish(), seats: z.number().int().min(1).max(100).nullish(),
  driverStaffId: z.string().max(40).nullish(), helperName: z.string().trim().max(100).nullish(), helperMobile: blank(mobile), isActive: z.boolean().optional(), notes: z.string().trim().max(255).nullish(),
});
const Stops = z.object({ stops: z.array(z.object({ id: z.number().int().positive().nullish(), name: z.string().trim().min(2, 'Enter the stop name.').max(100), landmark: z.string().trim().max(150).nullish(), pickupTime: blank(time), dropTime: blank(time) })).max(60) });
const StudentStops = z.object({ items: z.array(z.object({ studentId: z.string().min(10).max(40), stopId: z.number().int().positive().nullable() })).min(1).max(500) });
const Log = z.object({
  vehicleId: z.number().int().positive(), kind: z.enum(['fuel', 'service']), date, odometer: z.number().int().min(0).max(9_999_999).nullish(), litres: z.number().positive().max(1000).multipleOf(0.01).nullish(),
  amount: money.refine((v) => v > 0, 'Enter the amount.'), vendor: z.string().trim().max(150).nullish(), description: z.string().trim().max(255).nullish(),
  method: z.enum(['cash', 'upi', 'cheque', 'bank_transfer', 'card']), reference: z.string().trim().max(100).nullish(),
});
const LogQ = z.object({ vehicleId: z.coerce.number().int().positive().optional(), from: date.optional(), to: date.optional() });

@ApiTags('Transport')
@ApiBearerAuth()
@Controller()
export class TransportController {
  constructor(private readonly t: TransportService) {}

  @Get('transport/vehicles') @RequirePermission('transport', 'view')
  vehicles() { return this.t.vehicles(); }
  @Get('transport/driver-options') @RequirePermission('transport', 'manage')
  driverOptions() { return this.t.driverOptions(); }
  @Post('transport/vehicles') @RequirePermission('transport', 'manage')
  addVehicle(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Vehicle)) b: VehicleBody, @Req() r: AppRequest) { return this.t.saveVehicle(u, null, b, clientMeta(r)); }
  @Patch('transport/vehicles/:id') @RequirePermission('transport', 'manage')
  editVehicle(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(Vehicle)) b: VehicleBody, @Req() r: AppRequest) { return this.t.saveVehicle(u, id, b, clientMeta(r)); }

  @Get('transport/routes') @RequirePermission('transport', 'view')
  routes(@CurrentUser() u: RequestUser) { return this.t.routes(u); }
  @Put('transport/routes/:id/vehicle') @RequirePermission('transport', 'manage')
  routeVehicle(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(z.object({ vehicleId: z.number().int().positive().nullable() }))) b: { vehicleId: number | null }, @Req() r: AppRequest) {
    return this.t.setRouteVehicle(u, id, b.vehicleId, clientMeta(r));
  }
  @Put('transport/routes/:id/stops') @RequirePermission('transport', 'manage')
  stops(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(Stops)) b: { stops: StopBody[] }, @Req() r: AppRequest) { return this.t.saveStops(u, id, b.stops, clientMeta(r)); }
  @Get('transport/routes/:id/students') @RequirePermission('transport', 'view')
  students(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number) { return this.t.routeStudents(u, id); }
  @Put('transport/routes/:id/students') @RequirePermission('transport', 'manage')
  setStudentStops(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(StudentStops)) b: z.infer<typeof StudentStops>, @Req() r: AppRequest) { return this.t.setStops(u, id, b.items, clientMeta(r)); }

  /** The child's bus: families (own_children), drivers on that route, transport staff. */
  @Get('students/:id/transport') @RequirePermission('transport', 'view')
  forStudent(@CurrentUser() u: RequestUser, @Param('id') id: string) { return this.t.forStudent(u, id); }

  @Get('transport/logs') @RequirePermission('transport', 'log')
  logs(@Query(new ZodPipe(LogQ)) q: z.infer<typeof LogQ>) { return this.t.logs(q); }
  @Post('transport/logs') @RequirePermission('transport', 'log')
  addLog(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Log)) b: LogBody, @Req() r: AppRequest) { return this.t.addLog(u, b, clientMeta(r)); }
  @Post('transport/logs/:id/cancel') @HttpCode(200) @RequirePermission('transport', 'log')
  cancelLog(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(3, 'Give a reason.').max(255) }))) b: { reason: string }, @Req() r: AppRequest) {
    return this.t.cancelLog(u, id, b.reason, clientMeta(r));
  }
}
