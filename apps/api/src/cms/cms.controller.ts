import { Body, Controller, Delete, Get, Inject, Param, ParseIntPipe, Patch, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { FilesService } from '../common/files.service';
import { readJson } from '../common/json';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { assertImage } from './files.controller';
import { BUILTIN, CmsService, mapEmbedUrl, youtubeId } from './cms.service';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const fileId = z.string().length(26).nullable().optional();
const opt = (n: number) => z.string().trim().max(n).nullish().transform((v) => v || null);
const link = z.string().trim().max(300).refine((v) => v === '' || /^\/(?![/\\])/.test(v) || /^https?:\/\/[^\s]+$/.test(v), 'Use a page path like /contact or a full https:// link.');

/** Content rules per home section (requirements 13, W4). Unknown keys are dropped. */
const SECTION_SCHEMAS: Record<string, z.ZodTypeAny> = {
  banner: z.object({ autoplaySeconds: z.number().int().min(3).max(20).default(6), slides: z.array(z.object({
    imageId: fileId, heading: z.string().trim().max(120).default(''), text: z.string().trim().max(240).default(''),
    buttonLabel: z.string().trim().max(30).default(''), buttonLink: link.default('') })).max(8) }),
  welcome: z.object({ heading: z.string().trim().max(120), text: z.string().trim().max(1200), imageId: fileId, linkLabel: z.string().trim().max(30).default(''), link: link.default('') }),
  principal: z.object({ heading: z.string().trim().max(120), name: z.string().trim().max(100), designation: z.string().trim().max(100), photoId: fileId,
    message: z.string().trim().max(800), fullMessage: z.string().trim().max(8000) }),
  highlights: z.object({ items: z.array(z.object({ value: z.string().trim().min(1).max(20), label: z.string().trim().min(1).max(40) })).max(6) }),
  facilities: z.object({ heading: z.string().trim().max(120), items: z.array(z.object({ title: z.string().trim().min(1).max(60), text: z.string().trim().max(240), imageId: fileId })).max(12) }),
  notices: z.object({ heading: z.string().trim().max(120), count: z.number().int().min(1).max(10) }),
  events: z.object({ heading: z.string().trim().max(120), count: z.number().int().min(1).max(9) }),
  gallery: z.object({ heading: z.string().trim().max(120), count: z.number().int().min(4).max(12) }),
  videos: z.object({ heading: z.string().trim().max(120), count: z.number().int().min(1).max(6) }),
  testimonials: z.object({ heading: z.string().trim().max(120), items: z.array(z.object({ name: z.string().trim().min(1).max(80), relation: z.string().trim().max(100).default(''), text: z.string().trim().min(1).max(500) })).max(12) }),
  admissions: z.object({ heading: z.string().trim().max(120), text: z.string().trim().max(400), buttonLabel: z.string().trim().max(30), buttonLink: link }),
};
const PageBody = z.object({ title: z.string().trim().min(2).max(150), body: z.string().max(60000).nullish(), seoTitle: opt(150), seoDescription: opt(300), isPublished: z.boolean().optional(), slug: z.string().trim().max(70).optional() });
const MenuBody = z.object({ items: z.array(z.object({ label: z.string().trim().min(1).max(60), linkType: z.enum(['page', 'builtin', 'url']), target: z.string().trim().min(1).max(300), isVisible: z.boolean(), newTab: z.boolean().default(false) })).max(20) });
const EventBody = z.object({ title: z.string().trim().min(2).max(150), eventDate: date, endDate: date.nullish(), location: opt(150), description: z.string().max(20000).nullish(), coverId: fileId, isPublished: z.boolean().default(true) });
const AlbumBody = z.object({ title: z.string().trim().min(2).max(150), eventSlug: z.string().nullish(), isPublished: z.boolean().default(true), coverId: fileId });
const VideoBody = z.object({ url: z.string().trim().min(5).max(300), title: z.string().trim().min(2).max(150), description: opt(500), eventSlug: z.string().nullish(), isPublished: z.boolean().default(true) });
const SettingsBody = z.object({
  contact: z.object({ mapEmbedUrl: z.string().max(3000), officeHours: z.string().trim().max(200) }).optional(),
  social: z.object({ facebook: z.string().trim().max(300).default(''), instagram: z.string().trim().max(300).default(''), youtube: z.string().trim().max(300).default(''), x: z.string().trim().max(300).default('') }).optional(),
});

@ApiTags('Website (admin)')
@ApiBearerAuth()
@Controller('cms')
export class CmsController {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly cms: CmsService, private readonly audit: AuditService, private readonly files: FilesService) {}

  private async fileIdOf(publicId?: string | null) {
    if (!publicId) return null;
    const f = await this.db.selectFrom('files').select(['id', 'visibility']).where('public_id', '=', publicId).executeTakeFirst();
    if (!f || f.visibility !== 'public') throw Errors.validation([{ field: 'imageId', message: 'Upload the image again.' }]);
    return f.id;
  }
  private async eventIdOf(slug?: string | null) {
    if (!slug) return null;
    const e = await this.db.selectFrom('cms_events').select('id').where('slug', '=', slug).executeTakeFirst();
    if (!e) throw Errors.validation([{ field: 'eventSlug', message: 'Choose an existing event.' }]);
    return e.id;
  }
  private log(u: RequestUser, action: string, after: unknown, req: AppRequest) {
    this.cms.invalidate();
    return this.audit.log(u, { module: 'cms', action, after, ...clientMeta(req) });
  }

  // ---------------- Home page ----------------
  @Get('home') @RequirePermission('cms', 'view')
  async home() {
    const rows = await this.db.selectFrom('cms_home_sections').selectAll().orderBy('position').execute();
    return rows.map((r) => ({ key: r.section_key, position: r.position, visible: r.is_visible === 1, content: readJson(r.content) }));
  }

  @Put('home/order') @RequirePermission('cms', 'manage')
  async order(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ keys: z.array(z.string()).min(1) }))) b: { keys: string[] }, @Req() req: AppRequest) {
    await this.db.transaction().execute(async (trx) => {
      for (const [i, key] of b.keys.entries()) await trx.updateTable('cms_home_sections').set({ position: i + 1 }).where('section_key', '=', key).execute();
    });
    await this.log(u, 'home_order', b.keys, req);
    return this.home();
  }

  @Patch('home/:key') @RequirePermission('cms', 'manage')
  async section(@CurrentUser() u: RequestUser, @Param('key') key: string, @Body() raw: { visible?: boolean; content?: unknown }, @Req() req: AppRequest) {
    const schema = SECTION_SCHEMAS[key];
    if (!schema) throw Errors.notFound('Section');
    const patch: Record<string, unknown> = { updated_by: u.id };
    if (typeof raw.visible === 'boolean') patch.is_visible = raw.visible ? 1 : 0;
    if (raw.content !== undefined) {
      const parsed = schema.safeParse(raw.content);
      if (!parsed.success) throw Errors.validation(parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
      for (const id of JSON.stringify(parsed.data).match(/"(?:imageId|photoId)":"([0-9A-Z]{26})"/g) ?? []) await this.fileIdOf(id.slice(-27, -1));
      patch.content = JSON.stringify(parsed.data);
    }
    await this.db.updateTable('cms_home_sections').set(patch).where('section_key', '=', key).execute();
    await this.log(u, 'home_section', { key, ...raw }, req);
    return this.home();
  }

  // ---------------- Pages ----------------
  @Get('pages') @RequirePermission('cms', 'view')
  pages() { return this.db.selectFrom('cms_pages').selectAll().orderBy('id').execute(); }

  @Post('pages') @RequirePermission('cms', 'manage')
  async createPage(@CurrentUser() u: RequestUser, @Body(new ZodPipe(PageBody)) b: z.infer<typeof PageBody>, @Req() req: AppRequest) {
    const slug = await this.cms.uniqueSlug('cms_pages', b.slug || b.title);
    if (['home', 'about', 'contact', 'privacy', 'events', 'gallery', 'videos', 'app', 'api'].includes(slug)) throw Errors.validation([{ field: 'slug', message: 'This address is reserved.' }]);
    const r = await this.db.insertInto('cms_pages').values({ slug, kind: 'custom', title: b.title, body: b.body ?? '', seo_title: b.seoTitle, seo_description: b.seoDescription, is_published: b.isPublished === false ? 0 : 1, updated_by: u.id }).executeTakeFirstOrThrow();
    await this.log(u, 'create_page', { slug }, req);
    return { id: Number(r.insertId), slug };
  }

  @Patch('pages/:id') @RequirePermission('cms', 'manage')
  async updatePage(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(PageBody.partial())) b: Partial<z.infer<typeof PageBody>>, @Req() req: AppRequest) {
    const p = await this.db.selectFrom('cms_pages').select(['kind']).where('id', '=', id).executeTakeFirst();
    if (!p) throw Errors.notFound('Page');
    const patch: Record<string, unknown> = { updated_by: u.id };
    if (b.title !== undefined) patch.title = b.title;
    if (b.body !== undefined) patch.body = b.body;
    if (b.seoTitle !== undefined) patch.seo_title = b.seoTitle;
    if (b.seoDescription !== undefined) patch.seo_description = b.seoDescription;
    if (b.isPublished !== undefined) {
      if (p.kind === 'home' && !b.isPublished) throw Errors.badRequest('HOME_REQUIRED', 'The home page cannot be hidden.');
      patch.is_published = b.isPublished ? 1 : 0;
    }
    if (b.slug && p.kind === 'custom') patch.slug = await this.cms.uniqueSlug('cms_pages', b.slug, id);
    await this.db.updateTable('cms_pages').set(patch).where('id', '=', id).execute();
    await this.log(u, 'update_page', { id, ...b, body: undefined }, req);
    return this.db.selectFrom('cms_pages').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  }

  @Delete('pages/:id') @RequirePermission('cms', 'manage')
  async deletePage(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Req() req: AppRequest) {
    const p = await this.db.selectFrom('cms_pages').select(['kind', 'slug']).where('id', '=', id).executeTakeFirst();
    if (!p) throw Errors.notFound('Page');
    if (p.kind !== 'custom') throw Errors.badRequest('SYSTEM_PAGE', 'This page is part of the website and can only be hidden, not deleted.');
    await this.db.deleteFrom('cms_menu_items').where('link_type', '=', 'page').where('target', '=', p.slug).execute();
    await this.db.deleteFrom('cms_pages').where('id', '=', id).execute();
    await this.log(u, 'delete_page', { slug: p.slug }, req);
    return { id };
  }

  // ---------------- Menus ----------------
  @Get('menus') @RequirePermission('cms', 'view')
  async menus() {
    const rows = await this.db.selectFrom('cms_menu_items').selectAll().orderBy('location').orderBy('position').execute();
    return { header: rows.filter((r) => r.location === 'header'), footer: rows.filter((r) => r.location === 'footer'), builtin: Object.keys(BUILTIN) };
  }

  @Put('menus/:location') @RequirePermission('cms', 'manage')
  async setMenu(@CurrentUser() u: RequestUser, @Param('location') location: string, @Body(new ZodPipe(MenuBody)) b: z.infer<typeof MenuBody>, @Req() req: AppRequest) {
    if (location !== 'header' && location !== 'footer') throw Errors.notFound('Menu');
    const slugs = new Set((await this.db.selectFrom('cms_pages').select('slug').execute()).map((p) => p.slug));
    const errors = b.items.flatMap((it, i) =>
      it.linkType === 'page' && !slugs.has(it.target) ? [{ field: `items.${i}.target`, message: 'Unknown page.' }]
      : it.linkType === 'builtin' && !(it.target in BUILTIN) ? [{ field: `items.${i}.target`, message: 'Unknown section.' }]
      : it.linkType === 'url' && !/^https?:\/\//.test(it.target) ? [{ field: `items.${i}.target`, message: 'Use a full https:// link.' }] : []);
    if (errors.length) throw Errors.validation(errors);
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('cms_menu_items').where('location', '=', location).execute();
      if (b.items.length) await trx.insertInto('cms_menu_items').values(b.items.map((it, i) => ({
        location: location as 'header' | 'footer', label: it.label, link_type: it.linkType, target: it.target, position: i + 1, is_visible: it.isVisible ? 1 : 0, new_tab: it.newTab ? 1 : 0,
      }))).execute();
    });
    await this.log(u, 'set_menu', { location, items: b.items }, req);
    return this.menus();
  }

  // ---------------- Events ----------------
  @Get('events') @RequirePermission('cms', 'view')
  events() {
    return this.db.selectFrom('cms_events as e').leftJoin('files as f', 'f.id', 'e.cover_file_id')
      .select(['e.id', 'e.slug', 'e.title', 'e.event_date', 'e.end_date', 'e.location', 'e.description', 'e.is_published', 'f.public_id as cover']).orderBy('e.event_date', 'desc').execute();
  }

  @Post('events') @RequirePermission('cms', 'manage')
  async createEvent(@CurrentUser() u: RequestUser, @Body(new ZodPipe(EventBody)) b: z.infer<typeof EventBody>, @Req() req: AppRequest) {
    if (b.endDate && b.endDate < b.eventDate) throw Errors.validation([{ field: 'endDate', message: 'End date is before the start date.' }]);
    const slug = await this.cms.uniqueSlug('cms_events', `${b.title}-${b.eventDate.slice(0, 4)}`);
    const r = await this.db.insertInto('cms_events').values({ slug, title: b.title, event_date: new Date(`${b.eventDate}T00:00:00Z`), end_date: b.endDate ? new Date(`${b.endDate}T00:00:00Z`) : null,
      location: b.location, description: b.description ?? null, cover_file_id: await this.fileIdOf(b.coverId), is_published: b.isPublished ? 1 : 0, created_by: u.id }).executeTakeFirstOrThrow();
    await this.log(u, 'create_event', { slug }, req);
    return { id: Number(r.insertId), slug };
  }

  @Patch('events/:id') @RequirePermission('cms', 'manage')
  async updateEvent(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(EventBody.partial())) b: Partial<z.infer<typeof EventBody>>, @Req() req: AppRequest) {
    const patch: Record<string, unknown> = {};
    if (b.title !== undefined) patch.title = b.title;
    if (b.eventDate !== undefined) patch.event_date = new Date(`${b.eventDate}T00:00:00Z`);
    if (b.endDate !== undefined) patch.end_date = b.endDate ? new Date(`${b.endDate}T00:00:00Z`) : null;
    if (b.location !== undefined) patch.location = b.location;
    if (b.description !== undefined) patch.description = b.description;
    if (b.coverId !== undefined) patch.cover_file_id = await this.fileIdOf(b.coverId);
    if (b.isPublished !== undefined) patch.is_published = b.isPublished ? 1 : 0;
    await this.db.updateTable('cms_events').set(patch).where('id', '=', id).execute();
    await this.log(u, 'update_event', { id, ...b, description: undefined }, req);
    return { id };
  }

  @Delete('events/:id') @RequirePermission('cms', 'manage')
  async deleteEvent(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Req() req: AppRequest) {
    await this.db.deleteFrom('cms_events').where('id', '=', id).execute(); // albums and videos stay, unlinked
    await this.log(u, 'delete_event', { id }, req);
    return { id };
  }

  // ---------------- Gallery ----------------
  @Get('albums') @RequirePermission('cms', 'view')
  albums() {
    return this.db.selectFrom('cms_albums as a').leftJoin('cms_events as e', 'e.id', 'a.event_id').leftJoin('files as f', 'f.id', 'a.cover_file_id')
      .select(['a.id', 'a.slug', 'a.title', 'a.is_published', 'e.slug as eventSlug', 'e.title as event', 'f.public_id as cover',
        (eb) => eb.selectFrom('cms_photos as p').select((e2) => e2.fn.countAll<number>().as('n')).whereRef('p.album_id', '=', 'a.id').as('photos')])
      .orderBy('a.id', 'desc').execute();
  }

  @Post('albums') @RequirePermission('cms', 'manage')
  async createAlbum(@CurrentUser() u: RequestUser, @Body(new ZodPipe(AlbumBody)) b: z.infer<typeof AlbumBody>, @Req() req: AppRequest) {
    const slug = await this.cms.uniqueSlug('cms_albums', b.title);
    const r = await this.db.insertInto('cms_albums').values({ slug, title: b.title, event_id: await this.eventIdOf(b.eventSlug), is_published: b.isPublished ? 1 : 0 }).executeTakeFirstOrThrow();
    await this.log(u, 'create_album', { slug }, req);
    return { id: Number(r.insertId), slug };
  }

  @Get('albums/:id') @RequirePermission('cms', 'view')
  async album(@Param('id', ParseIntPipe) id: number) {
    const a = await this.db.selectFrom('cms_albums as a').leftJoin('cms_events as e', 'e.id', 'a.event_id').leftJoin('files as f', 'f.id', 'a.cover_file_id')
      .select(['a.id', 'a.slug', 'a.title', 'a.is_published', 'e.slug as eventSlug', 'f.public_id as cover']).where('a.id', '=', id).executeTakeFirst();
    if (!a) throw Errors.notFound('Album');
    const photos = await this.db.selectFrom('cms_photos as p').innerJoin('files as f', 'f.id', 'p.file_id').select(['p.id', 'f.public_id as image', 'p.caption', 'p.position'])
      .where('p.album_id', '=', id).orderBy('p.position').orderBy('p.id').execute();
    return { ...a, photos };
  }

  @Patch('albums/:id') @RequirePermission('cms', 'manage')
  async updateAlbum(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(AlbumBody.partial())) b: Partial<z.infer<typeof AlbumBody>>, @Req() req: AppRequest) {
    const patch: Record<string, unknown> = {};
    if (b.title !== undefined) patch.title = b.title;
    if (b.eventSlug !== undefined) patch.event_id = await this.eventIdOf(b.eventSlug);
    if (b.isPublished !== undefined) patch.is_published = b.isPublished ? 1 : 0;
    if (b.coverId !== undefined) patch.cover_file_id = await this.fileIdOf(b.coverId);
    await this.db.updateTable('cms_albums').set(patch).where('id', '=', id).execute();
    await this.log(u, 'update_album', { id, ...b }, req);
    return this.album(id);
  }

  @Delete('albums/:id') @RequirePermission('cms', 'manage')
  async deleteAlbum(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Req() req: AppRequest) {
    await this.db.deleteFrom('cms_albums').where('id', '=', id).execute();
    await this.log(u, 'delete_album', { id }, req);
    return { id };
  }

  @Post('albums/:id/photos') @RequirePermission('cms', 'manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024 } }))
  async addPhoto(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @UploadedFile() file?: Express.Multer.File) {
    assertImage(file);
    const a = await this.db.selectFrom('cms_albums').select('id').where('id', '=', id).executeTakeFirst();
    if (!a) throw Errors.notFound('Album');
    const fid = await this.files.save(file!.buffer, file!.originalname, file!.mimetype, 'website', u.id, 'public');
    const max = await this.db.selectFrom('cms_photos').select((eb) => eb.fn.max('position').as('m')).where('album_id', '=', id).executeTakeFirst();
    const r = await this.db.insertInto('cms_photos').values({ album_id: id, file_id: fid, position: Number(max?.m ?? 0) + 1 }).executeTakeFirstOrThrow();
    this.cms.invalidate();
    return { id: Number(r.insertId) };
  }

  @Patch('photos/:id') @RequirePermission('cms', 'manage')
  async photo(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(z.object({ caption: opt(200) }))) b: { caption: string | null }) {
    await this.db.updateTable('cms_photos').set({ caption: b.caption }).where('id', '=', id).execute();
    return { id };
  }

  @Delete('photos/:id') @RequirePermission('cms', 'manage')
  async deletePhoto(@Param('id', ParseIntPipe) id: number) {
    const p = await this.db.selectFrom('cms_photos').select('file_id').where('id', '=', id).executeTakeFirst();
    await this.db.deleteFrom('cms_photos').where('id', '=', id).execute();
    if (p) await this.db.updateTable('files').set({ deleted_at: new Date() }).where('id', '=', p.file_id).execute();
    return { id };
  }

  // ---------------- Videos ----------------
  @Get('videos') @RequirePermission('cms', 'view')
  videos() {
    return this.db.selectFrom('cms_videos as v').leftJoin('cms_events as e', 'e.id', 'v.event_id')
      .select(['v.id', 'v.youtube_id', 'v.title', 'v.description', 'v.is_published', 'e.slug as eventSlug', 'e.title as event']).orderBy('v.id', 'desc').execute();
  }

  @Post('videos') @RequirePermission('cms', 'manage')
  async addVideo(@CurrentUser() u: RequestUser, @Body(new ZodPipe(VideoBody)) b: z.infer<typeof VideoBody>, @Req() req: AppRequest) {
    const yt = youtubeId(b.url);
    if (!yt) throw Errors.validation([{ field: 'url', message: 'Paste a YouTube link, for example https://youtu.be/…' }]);
    const r = await this.db.insertInto('cms_videos').values({ youtube_id: yt, title: b.title, description: b.description, event_id: await this.eventIdOf(b.eventSlug), is_published: b.isPublished ? 1 : 0 }).executeTakeFirstOrThrow();
    await this.log(u, 'add_video', { yt }, req);
    return { id: Number(r.insertId), youtubeId: yt };
  }

  @Patch('videos/:id') @RequirePermission('cms', 'manage')
  async updateVideo(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(VideoBody.partial())) b: Partial<z.infer<typeof VideoBody>>, @Req() req: AppRequest) {
    const patch: Record<string, unknown> = {};
    if (b.url !== undefined) { const yt = youtubeId(b.url); if (!yt) throw Errors.validation([{ field: 'url', message: 'Not a YouTube link.' }]); patch.youtube_id = yt; }
    if (b.title !== undefined) patch.title = b.title;
    if (b.description !== undefined) patch.description = b.description;
    if (b.eventSlug !== undefined) patch.event_id = await this.eventIdOf(b.eventSlug);
    if (b.isPublished !== undefined) patch.is_published = b.isPublished ? 1 : 0;
    await this.db.updateTable('cms_videos').set(patch).where('id', '=', id).execute();
    await this.log(u, 'update_video', { id, ...b }, req);
    return { id };
  }

  @Delete('videos/:id') @RequirePermission('cms', 'manage')
  async deleteVideo(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Req() req: AppRequest) {
    await this.db.deleteFrom('cms_videos').where('id', '=', id).execute();
    await this.log(u, 'delete_video', { id }, req);
    return { id };
  }

  // ---------------- Settings ----------------
  // Website contact messages are admission enquiries now: see EnquiriesController.

  @Get('settings') @RequirePermission('cms', 'view')
  async settings() { return { contact: await this.cms.setting('contact'), social: await this.cms.setting('social') }; }

  @Put('settings') @RequirePermission('cms', 'manage')
  async saveSettings(@CurrentUser() u: RequestUser, @Body(new ZodPipe(SettingsBody)) b: z.infer<typeof SettingsBody>, @Req() req: AppRequest) {
    if (b.contact) {
      const map = mapEmbedUrl(b.contact.mapEmbedUrl);
      if (map === null) throw Errors.validation([{ field: 'contact.mapEmbedUrl', message: 'In Google Maps, choose Share > Embed a map, then copy and paste the code here.' }]);
      await this.db.updateTable('settings').set({ value: JSON.stringify({ mapEmbedUrl: map, officeHours: b.contact.officeHours }), updated_by: u.id }).where('setting_group', '=', 'website').where('setting_key', '=', 'contact').execute();
    }
    if (b.social) {
      const bad = Object.entries(b.social).find(([, v]) => v && !/^https:\/\//.test(v));
      if (bad) throw Errors.validation([{ field: `social.${bad[0]}`, message: 'Use the full https:// link to your page.' }]);
      await this.db.updateTable('settings').set({ value: JSON.stringify(b.social), updated_by: u.id }).where('setting_group', '=', 'website').where('setting_key', '=', 'social').execute();
    }
    await this.log(u, 'website_settings', b, req);
    return this.settings();
  }
}
