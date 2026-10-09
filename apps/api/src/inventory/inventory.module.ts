import { Module } from '@nestjs/common';
import { PayrollModule } from '../payroll/payroll.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({ imports: [PayrollModule], controllers: [InventoryController], providers: [InventoryService], exports: [InventoryService] })
export class InventoryModule {}
