import { Module } from '@nestjs/common';
import { EnquiriesController } from './enquiries.controller';

@Module({ controllers: [EnquiriesController] })
export class EnquiriesModule {}
