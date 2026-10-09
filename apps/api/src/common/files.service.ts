import { Inject, Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { KYSELY, type Database } from '../database/database.module';
import { newPublicId } from './ids';

/**
 * Private file storage on local disk. STORAGE_DIR should point to a folder that survives
 * redeploys (on Hostinger: a folder outside the app build, e.g. ~/ems-storage).
 */
export const STORAGE_DIR = resolve(process.env.STORAGE_DIR || resolve(__dirname, '../../../../storage'));

@Injectable()
export class FilesService {
  constructor(@Inject(KYSELY) private readonly db: Database) {}

  async save(buf: Buffer, originalName: string, mime: string, module: string, uploadedBy: number, visibility: 'public' | 'private' = 'private') {
    const publicId = newPublicId();
    const now = new Date();
    const rel = join(module, `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`, `${publicId}`);
    const abs = join(STORAGE_DIR, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, buf);
    const res = await this.db.insertInto('files').values({
      public_id: publicId, disk: 'local', storage_path: rel, original_name: originalName.slice(0, 255),
      mime_type: mime.slice(0, 100), size_bytes: buf.length, visibility, module_key: module, uploaded_by: uploadedBy,
    }).executeTakeFirstOrThrow();
    return Number(res.insertId);
  }

  async read(fileId: number) {
    const f = await this.db.selectFrom('files').select(['storage_path', 'original_name']).where('id', '=', fileId).executeTakeFirstOrThrow();
    return readFile(join(STORAGE_DIR, f.storage_path));
  }
}
