import { Module } from '@nestjs/common';
import { StudentsModule } from '../students/students.module';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';

@Module({ imports: [StudentsModule], controllers: [ExamsController], providers: [ExamsService], exports: [ExamsService] })
export class ExamsModule {}
