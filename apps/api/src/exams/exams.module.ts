import { Module } from '@nestjs/common';
import { StudentsModule } from '../students/students.module';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';
import { HallTicketsController } from './hall-tickets.controller';

@Module({ imports: [StudentsModule], controllers: [ExamsController, HallTicketsController], providers: [ExamsService], exports: [ExamsService] })
export class ExamsModule {}
