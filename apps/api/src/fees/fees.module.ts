import { FeeRemindersService } from './fee-reminders.service';
import { Module } from '@nestjs/common';
import { FeesController } from './fees.controller';
import { FeeAccountsService } from './fee-accounts.service';
import { FeeSetupService } from './fee-setup.service';
import { FeeReportsService } from './fee-reports.service';
import { PaymentsService } from './payments.service';

@Module({ controllers: [FeesController], providers: [FeeAccountsService, FeeSetupService, FeeReportsService, PaymentsService, FeeRemindersService], exports: [FeeAccountsService, FeeReportsService] })
export class FeesModule {}
