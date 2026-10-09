import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { ExpensesService } from './expenses.service';

@Module({ controllers: [PayrollController], providers: [PayrollService, ExpensesService], exports: [PayrollService, ExpensesService] })
export class PayrollModule {}
