import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { FilesService } from './files.service';

@Global()
@Module({ providers: [AuditService, FilesService], exports: [AuditService, FilesService] })
export class CommonModule {}
