import { Module } from '@nestjs/common';
import { FeesModule } from '../fees/fees.module';
import { YearEndController } from './yearend.controller';

@Module({ imports: [FeesModule], controllers: [YearEndController] })
export class YearEndModule {}
