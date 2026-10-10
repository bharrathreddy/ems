import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { isDemoFillRequest } from './database/demo-start';
import { CommonModule } from './common/common.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { PermissionsModule } from './permissions/permissions.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { StaffModule } from './staff/staff.module';
import { AcademicsModule } from './academics/academics.module';
import { SettingsModule } from './settings/settings.module';
import { StudentsModule } from './students/students.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ImportsModule } from './imports/imports.module';
import { FeesModule } from './fees/fees.module';
import { TimetableModule } from './timetable/timetable.module';
import { CmsModule } from './cms/cms.module';
import { EnquiriesModule } from './enquiries/enquiries.module';
import { HomeworkModule } from './homework/homework.module';
import { PushModule } from './push/push.module';
import { YearEndModule } from './yearend/yearend.module';
import { AttendanceModule } from './attendance/attendance.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ExamsModule } from './exams/exams.module';
import { ExportsModule } from './exports/exports.module';
import { HrModule } from './hr/hr.module';
import { PayrollModule } from './payroll/payroll.module';
import { TransportModule } from './transport/transport.module';
import { InventoryModule } from './inventory/inventory.module';
import { ActivityModule } from './activity/activity.module';
import { AccessModule } from './access/access.module';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MIN ?? 300) }],
      skipIf: (ctx) => process.env.NODE_ENV === 'test' || isDemoFillRequest(ctx.switchToHttp().getRequest()),
    }),
    DatabaseModule, CommonModule, PermissionsModule, MailModule,
    AuthModule, StaffModule, AcademicsModule, SettingsModule,
    StudentsModule, AnnouncementsModule, NotificationsModule, ImportsModule, FeesModule, TimetableModule, CmsModule, YearEndModule, AttendanceModule, DashboardModule, ExamsModule, ExportsModule, HrModule, PayrollModule, TransportModule, InventoryModule, ActivityModule, AccessModule, EnquiriesModule, HomeworkModule, PushModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
