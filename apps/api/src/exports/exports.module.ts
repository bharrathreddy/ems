import { Module } from '@nestjs/common';
import { StudentsModule } from '../students/students.module';
import { StaffModule } from '../staff/staff.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { ExamsModule } from '../exams/exams.module';
import { FeesModule } from '../fees/fees.module';
import { PayrollModule } from '../payroll/payroll.module';
import { TransportModule } from '../transport/transport.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ActivityModule } from '../activity/activity.module';
import { ExportsController } from './exports.controller';

@Module({ imports: [StudentsModule, StaffModule, AttendanceModule, ExamsModule, FeesModule, PayrollModule, TransportModule, InventoryModule, ActivityModule], controllers: [ExportsController] })
export class ExportsModule {}
