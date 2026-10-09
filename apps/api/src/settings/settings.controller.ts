import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from '../common/files.service';
import { assertImage } from '../cms/files.controller';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { readJson } from '../common/json';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, Public, type AppRequest, type RequestUser } from '../common/request-user';
import { DeveloperOnly, RequirePermission } from '../permissions/permission.guard';
import { PermissionsService } from '../permissions/permissions.service';
import { CORE_MODULES, PERMISSION_CATALOG } from '../permissions/catalog';
import { normalizeMobile } from '../auth/passwords';
import { APP_VERSION } from '../config';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1F5F4A.');
const InstitutionBody = z.object({
  name: z.string().trim().min(2).max(200),
  shortName: z.string().trim().max(50).nullish(),
  address: z.string().trim().max(500).nullish(),
  phone: z.string().trim().max(20).nullish(),
  contactEmail: z.string().trim().email().nullish(),
  contactWhatsapp: z.string().nullish().transform((v) => (v ? normalizeMobile(v) : null)),
  websiteUrl: z.string().trim().url().nullish(),
  brandPrimary: hex.nullish(),
  brandSecondary: hex.nullish(),
}).partial();
const SmtpBody = z.object({
  host: z.string().min(1), port: z.number().int().min(1).max(65535), secure: z.boolean(),
  user: z.string().optional(), pass: z.string().optional(), fromName: z.string().min(1), fromEmail: z.string().email(),
});
const DeveloperBody = z.object({ institutionType: z.enum(['school', 'college']).optional(), collegeLoginHolder: z.enum(['student', 'parent']).optional() });
const FlagBody = z.object({ enabled: z.boolean() });

@ApiTags('Settings')
@Controller()
export class SettingsController {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly audit: AuditService, private readonly perms: PermissionsService, private readonly files: FilesService) {}

  /** Lets the screens detect an older copy of the server still running. */
  @Public()
  @Get('public/version')
  version() { return { version: APP_VERSION }; }

  /** Used by the login screen before anyone is logged in. */
  @Public()
  @Get('public/branding')
  async branding() {
    const s = await this.db.selectFrom('institution_settings as i').leftJoin('files as f', 'f.id', 'i.logo_file_id')
      .select(['i.name', 'i.short_name', 'i.institution_type', 'i.brand_primary', 'i.brand_secondary', 'f.public_id as logo'])
      .where('i.id', '=', 1).executeTakeFirst();
    return s ?? null;
  }

  @ApiBearerAuth()
  @Get('settings/institution')
  @RequirePermission('settings', 'view')
  async institution() {
    const s = await this.db.selectFrom('institution_settings').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
    const smtp = readJson<any>(s.smtp_config);
    return { ...s, smtp_config: smtp ? { ...smtp, pass: smtp.pass ? '********' : undefined } : null };
  }

  @ApiBearerAuth()
  @Patch('settings/institution')
  @RequirePermission('settings', 'configure')
  async updateInstitution(@CurrentUser() u: RequestUser, @Body(new ZodPipe(InstitutionBody)) b: z.infer<typeof InstitutionBody>, @Req() req: AppRequest) {
    const map: Record<string, string> = {
      name: 'name', shortName: 'short_name', address: 'address', phone: 'phone', contactEmail: 'contact_email',
      contactWhatsapp: 'contact_whatsapp', websiteUrl: 'website_url', brandPrimary: 'brand_primary', brandSecondary: 'brand_secondary',
    };
    const patch: Record<string, unknown> = { updated_by: u.id };
    for (const [k, v] of Object.entries(b)) if (v !== undefined) patch[map[k]] = v;
    await this.db.updateTable('institution_settings').set(patch).where('id', '=', 1).execute();
    await this.audit.log(u, { module: 'settings', action: 'update_institution', after: b, ...clientMeta(req) });
    return this.institution();
  }

  /** SMTP can be set by the Admin or the developer (requirements 13.1 / W10). */
  @ApiBearerAuth()
  @Put('settings/smtp')
  @RequirePermission('settings', 'configure')
  async smtp(@CurrentUser() u: RequestUser, @Body(new ZodPipe(SmtpBody)) b: z.infer<typeof SmtpBody>, @Req() req: AppRequest) {
    const current = await this.db.selectFrom('institution_settings').select('smtp_config').where('id', '=', 1).executeTakeFirst();
    const keepPass = b.pass === undefined || b.pass === '********' ? readJson<any>(current?.smtp_config)?.pass : b.pass;
    await this.db.updateTable('institution_settings').set({ smtp_config: JSON.stringify({ ...b, pass: keepPass }), updated_by: u.id }).where('id', '=', 1).execute();
    await this.audit.log(u, { module: 'settings', action: 'update_smtp', after: { ...b, pass: undefined }, ...clientMeta(req) });
    return { saved: true };
  }

  /** School logo, shown on the website, the login screen and receipts. */
  @ApiBearerAuth()
  @Post('settings/logo')
  @RequirePermission('settings', 'configure')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024 } }))
  async logo(@CurrentUser() u: RequestUser, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: AppRequest) {
    assertImage(file);
    const id = await this.files.save(file!.buffer, file!.originalname, file!.mimetype, 'branding', u.id, 'public');
    await this.db.updateTable('institution_settings').set({ logo_file_id: id, updated_by: u.id }).where('id', '=', 1).execute();
    await this.audit.log(u, { module: 'settings', action: 'set_logo', ...clientMeta(req) });
    const f = await this.db.selectFrom('files').select('public_id').where('id', '=', id).executeTakeFirstOrThrow();
    return { id: f.public_id, url: `/api/v1/files/${f.public_id}` };
  }

  @ApiBearerAuth()
  @Delete('settings/logo')
  @RequirePermission('settings', 'configure')
  async removeLogo(@CurrentUser() u: RequestUser) {
    await this.db.updateTable('institution_settings').set({ logo_file_id: null, updated_by: u.id }).where('id', '=', 1).execute();
    return this.branding();
  }

  // ---------- Developer console ----------

  @ApiBearerAuth()
  @Get('developer/feature-flags')
  @DeveloperOnly()
  async flags() {
    const rows = await this.db.selectFrom('feature_flags').select(['module_key', 'is_enabled', 'updated_at']).orderBy('module_key').execute();
    return rows.map((r) => ({ module: r.module_key, enabled: r.is_enabled === 1, updatedAt: r.updated_at }));
  }

  @ApiBearerAuth()
  @Put('developer/feature-flags/:module')
  @DeveloperOnly()
  async setFlag(@CurrentUser() u: RequestUser, @Param('module') module: string, @Body(new ZodPipe(FlagBody)) b: z.infer<typeof FlagBody>, @Req() req: AppRequest) {
    if (!(module in PERMISSION_CATALOG) || CORE_MODULES.has(module)) throw Errors.notFound('Module');
    await this.db.insertInto('feature_flags').values({ module_key: module, is_enabled: b.enabled ? 1 : 0, updated_by: u.id })
      .onDuplicateKeyUpdate({ is_enabled: b.enabled ? 1 : 0, updated_by: u.id }).execute();
    this.perms.invalidate();
    await this.audit.log(u, { module: 'features', action: b.enabled ? 'enable' : 'disable', entityType: 'feature', after: { module }, ...clientMeta(req) });
    return { module, enabled: b.enabled };
  }

  @ApiBearerAuth()
  @Patch('developer/institution')
  @DeveloperOnly()
  async developerSettings(@CurrentUser() u: RequestUser, @Body(new ZodPipe(DeveloperBody)) b: z.infer<typeof DeveloperBody>, @Req() req: AppRequest) {
    await this.db.updateTable('institution_settings').set({
      ...(b.institutionType && { institution_type: b.institutionType }),
      ...(b.collegeLoginHolder && { college_login_holder: b.collegeLoginHolder }),
      updated_by: u.id,
    }).where('id', '=', 1).execute();
    await this.audit.log(u, { module: 'settings', action: 'developer_update', after: b, ...clientMeta(req) });
    return { saved: true };
  }

  @ApiBearerAuth()
  @Get('developer/health')
  @DeveloperOnly()
  async health() {
    const [db, outbox] = await Promise.all([
      this.db.selectFrom('schema_migrations' as any).select(['filename' as any, 'applied_at' as any]).orderBy('filename' as any).execute(),
      this.db.selectFrom('email_outbox').select(['status', (eb) => eb.fn.countAll<number>().as('count')]).groupBy('status').execute(),
    ]);
    return { status: 'ok', migrations: db, emailOutbox: outbox, serverTime: new Date() };
  }
}
