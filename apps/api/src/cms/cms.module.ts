import { Module } from '@nestjs/common';
import { CmsController } from './cms.controller';
import { PublicController } from './public.controller';
import { FilesController } from './files.controller';
import { CmsService } from './cms.service';

@Module({ controllers: [CmsController, PublicController, FilesController], providers: [CmsService], exports: [CmsService] })
export class CmsModule {}
