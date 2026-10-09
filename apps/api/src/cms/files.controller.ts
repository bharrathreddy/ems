import { Controller, Get, Inject, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { FilesService, STORAGE_DIR } from '../common/files.service';
import { CurrentUser, Public, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE = 3 * 1024 * 1024;

/** Validates the file's real content, not just its name, so only genuine images are accepted. */
export function assertImage(file?: Express.Multer.File) {
  if (!file) throw Errors.badRequest('NO_FILE', 'Choose an image to upload.');
  const b = file.buffer;
  const isJpeg = b[0] === 0xff && b[1] === 0xd8;
  const isPng = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
  if (!IMAGE_TYPES.has(file.mimetype) || !(isJpeg || isPng || isWebp)) throw Errors.badRequest('NOT_AN_IMAGE', 'Upload a JPG, PNG or WebP image.');
  if (file.size > MAX_IMAGE) throw Errors.badRequest('IMAGE_TOO_LARGE', 'Images must be under 3 MB.');
}

@ApiTags('Website')
@Controller()
export class FilesController {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly files: FilesService) {}

  /** Public images for the website. Private files (imports, documents) are never served here. */
  @Public()
  @Get('files/:id')
  async serve(@Param('id') id: string, @Res() res: Response) {
    const f = await this.db.selectFrom('files').select(['storage_path', 'mime_type', 'visibility', 'deleted_at']).where('public_id', '=', id).executeTakeFirst();
    if (!f || f.visibility !== 'public' || f.deleted_at) throw Errors.notFound('File');
    const abs = join(STORAGE_DIR, f.storage_path);
    if (!existsSync(abs)) throw Errors.notFound('File');
    res.setHeader('Content-Type', f.mime_type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    createReadStream(abs).pipe(res);
  }

  @ApiBearerAuth()
  @Post('cms/uploads')
  @RequirePermission('cms', 'manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE } }))
  async upload(@CurrentUser() u: RequestUser, @UploadedFile() file?: Express.Multer.File) {
    assertImage(file);
    const id = await this.files.save(file!.buffer, file!.originalname, file!.mimetype, 'website', u.id, 'public');
    const row = await this.db.selectFrom('files').select('public_id').where('id', '=', id).executeTakeFirstOrThrow();
    return { id: row.public_id, url: `/api/v1/files/${row.public_id}` };
  }
}
