import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { LeaveStaffService } from './leave-staff.service';

@Module({ controllers: [AttendanceController], providers: [AttendanceService, LeaveStaffService], exports: [AttendanceService, LeaveStaffService] })
export class AttendanceModule {}
