import { Module } from '@nestjs/common';
import { PayrollModule } from '../payroll/payroll.module';
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';

@Module({ imports: [PayrollModule], controllers: [TransportController], providers: [TransportService], exports: [TransportService] })
export class TransportModule {}
