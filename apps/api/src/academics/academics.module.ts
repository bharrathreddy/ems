import { Module } from '@nestjs/common';
import { AcademicsController } from './academics.controller';
import { TeachingController } from './teaching.controller';

@Module({ controllers: [AcademicsController, TeachingController] })
export class AcademicsModule {}
