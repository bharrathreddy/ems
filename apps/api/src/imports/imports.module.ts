import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { FeesModule } from '../fees/fees.module';

@Module({ imports: [FeesModule], controllers: [ImportsController], providers: [ImportsService] })
export class ImportsModule {}
