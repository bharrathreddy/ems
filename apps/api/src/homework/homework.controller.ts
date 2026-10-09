import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Errors } from '../common/app-error';
import { STORAGE_DIR } from '../common/files.service';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { HomeworkService } from './homework.service';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-06-15.');
const blankNull = (v: unknown) => (v === '' || v === 'null' ? null : v);
const Fields = {
  subjectId: z.preprocess(blankNull, z.coerce.number().int().positive().nullish()),
  type: z.enum(['homework', 'diary']),
  title: z.string().trim().min(2, 'Write a short title, e.g. "Maths: page 42, sums 1–10".').max(200),
  details: z.preprocess(blankNull, z.string().trim().max(5000).nullish()),
  forDate: z.preprocess(blankNull, date.nullish()),
  dueDate: z.preprocess(blankNull, date.nullish()),
};
const Create = z.object({ sectionId: z.coerce.number().int().positive({ message: 'Choose a class and section.' }), ...Fields });
const Edit = z.object(Fields).partial();

@ApiTags('Homework')
@ApiBearerAuth()
@Controller()
export class HomeworkController {
  constructor(private readonly hw: HomeworkService) {}

  @Get('homework/options') @RequirePermission('homework', 'post')
  options(@CurrentUser() u: RequestUser) { return this.hw.options(u); }

  @Get('homework') @RequirePermission('homework', 'view')
  list(@CurrentUser() u: RequestUser, @Query('sectionId') sectionId?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('mine') mine?: string) {
    if (u.workspace !== 'staff') throw Errors.forbidden();
    const ok = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
    return this.hw.list(u, { sectionId: sectionId ? Number(sectionId) || undefined : undefined, from: ok(from), to: ok(to), mine: mine === '1' });
  }

  @Get('students/:id/homework') @RequirePermission('homework', 'view')
  forStudent(@CurrentUser() u: RequestUser, @Param('id') id: string) { return this.hw.forStudent(u, id); }

  @Post('homework') @RequirePermission('homework', 'post')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 6 * 1024 * 1024 } }))
  create(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Create)) b: z.infer<typeof Create>, @Req() r: AppRequest, @UploadedFile() file?: Express.Multer.File) {
    return this.hw.create(u, b, file, clientMeta(r));
  }

  @Get('homework/:id') @RequirePermission('homework', 'view')
  one(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number) {
    if (u.workspace !== 'staff') throw Errors.forbidden();
    return this.hw.one(u, id);
  }

  @Patch('homework/:id') @RequirePermission('homework', 'post')
  edit(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(Edit)) b: z.infer<typeof Edit>, @Req() r: AppRequest) { return this.hw.update(u, id, b, clientMeta(r)); }

  @Delete('homework/:id') @HttpCode(200) @RequirePermission('homework', 'post')
  remove(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Req() r: AppRequest) { return this.hw.remove(u, id, clientMeta(r)); }

  @Get('homework/:id/file') @RequirePermission('homework', 'view')
  async file(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const f = await this.hw.file(u, id);
    const p = join(STORAGE_DIR, f.storage_path);
    if (!existsSync(p)) throw Errors.notFound('Attachment');
    res.setHeader('Content-Type', f.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${f.original_name.replace(/[^\w.\- ]+/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    createReadStream(p).pipe(res);
  }
}
