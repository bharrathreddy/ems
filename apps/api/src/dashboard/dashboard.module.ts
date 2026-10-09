import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { DashboardController } from './dashboard.controller';

@Module({ imports: [AttendanceModule], controllers: [DashboardController] })
export class DashboardModule {}
