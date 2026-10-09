import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { config } from './config';
import { CmsService } from './cms/cms.service';
import { KYSELY, type Database } from './database/database.module';
import { AuditService } from './common/audit.service';
import { clientMeta, type AppRequest } from './common/request-user';

/** Built admin app (apps/admin/dist). Served by this same Node process so one Hostinger Web App runs everything. */
export const ADMIN_DIST = resolve(__dirname, '../../admin/dist');

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: process.env.NODE_ENV === 'test' ? false : undefined });
  app.setGlobalPrefix('api/v1');
  app.set('trust proxy', 1);

  const strict = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://i.ytimg.com'],
        connectSrc: ["'self'"],
        frameSrc: ['https://www.google.com', 'https://maps.google.com', 'https://www.youtube-nocookie.com'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
  });
  const docsCsp = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) => (req.path.startsWith('/api/docs') ? docsCsp : strict)(req, res, next));
  // Location is used by staff check-in; nothing on the site may use the microphone, payment or USB APIs.
  app.use((_req: Request, res: Response, next: NextFunction) => { res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=(), payment=(), usb=(), interest-cohort=()'); next(); });
  app.disable('x-powered-by');
  app.use(cookieParser());
  // Activity log: every PDF the app hands out (receipts, payslips, report cards, sale receipts). Lists are logged by the exports screen itself.
  {
    const audit = app.get(AuditService);
    const KIND: Array<[RegExp, string]> = [[/\/payments\/[^/]+\/pdf$/, 'Fee receipt'], [/\/payslips\/[^/]+\/pdf$/, 'Payslip'], [/\/report-cards?\.pdf$/, 'Report card'], [/\/sales\/[^/]+\/pdf$/, 'Sale receipt'], [/\/expenses\/[^/]+\/bill$/, 'Expense bill']];
    app.use((req: AppRequest, res: Response, next: NextFunction) => {
      if (req.method === 'GET' && req.path.startsWith('/api/v1/') && !req.path.startsWith('/api/v1/exports/')) {
        res.on('finish', () => {
          const kind = KIND.find(([re]) => re.test(req.path))?.[1];
          if (kind && res.statusCode === 200 && req.user) void audit.log(req.user, { module: 'reports', action: 'download', after: { file: kind, path: req.path.replace('/api/v1', '') }, ...clientMeta(req) }).catch(() => undefined);
        });
      }
      next();
    });
  }
  if (config.appUrl) app.enableCors({ origin: config.appUrl.split(','), credentials: true });

  if (config.apiDocs) {
    const doc = new DocumentBuilder()
      .setTitle('Education Management System API').setVersion('1.0').addBearerAuth()
      .addGlobalParameters({ name: 'X-Workspace', in: 'header', required: false, description: 'staff | parent | student' })
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  }

  // Search engines: robots.txt and sitemap.xml list only the public website (never /app or /api).
  {
    const cms = app.get(CmsService);
    const db = app.get<Database>(KYSELY);
    const base = (req: Request) => (config.appUrl && !/localhost|127\.0\.0\.1/.test(config.appUrl) ? config.appUrl.split(',')[0] : `${req.protocol}://${req.get('host')}`);
    app.use('/robots.txt', async (req: Request, res: Response) => {
      const on = await cms.enabled().catch(() => false);
      res.type('text/plain').setHeader('Cache-Control', 'public, max-age=3600');
      res.send(on ? `User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /api\n\nSitemap: ${base(req)}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
    });
    app.use('/sitemap.xml', async (req: Request, res: Response) => {
      const b = base(req);
      const urls: Array<{ loc: string; lastmod?: string }> = [];
      if (await cms.enabled().catch(() => false)) {
        const day = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : undefined);
        const [pages, events, albums] = await Promise.all([
          db.selectFrom('cms_pages').select(['slug', 'kind', 'updated_at']).where('is_published', '=', 1).execute(),
          db.selectFrom('cms_events').select(['slug', 'updated_at']).where('is_published', '=', 1).execute(),
          db.selectFrom('cms_albums').select(['slug', 'created_at']).where('is_published', '=', 1).execute(),
        ]);
        for (const p of pages) urls.push({ loc: p.kind === 'home' ? '/' : p.kind === 'custom' ? `/p/${p.slug}` : `/${p.slug}`, lastmod: day(p.updated_at) });
        for (const path of ['/events', '/gallery', '/videos', '/notices']) urls.push({ loc: path });
        for (const e of events) urls.push({ loc: `/events/${e.slug}`, lastmod: day(e.updated_at) });
        for (const a of albums) urls.push({ loc: `/gallery/${a.slug}`, lastmod: day(a.created_at) });
      }
      const xml = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
      res.type('application/xml').setHeader('Cache-Control', 'public, max-age=3600');
      res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${xml(b + u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`);
    });
  }

  // Serve the app screens and fall back to index.html for client-side routes.
  if (existsSync(join(ADMIN_DIST, 'index.html'))) {
    app.useStaticAssets(ADMIN_DIST, { index: false, maxAge: '1h', setHeaders: (res, path) => {
      if (path.endsWith('index.html') || path.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
      else if (path.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } });
    const indexHtml = readFileSync(join(ADMIN_DIST, 'index.html'), 'utf8');
    const cms = app.get(CmsService);
    app.use(async (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(await withMeta(indexHtml, req.path, cms).catch(() => indexHtml));
    });
  }
  return app;
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Puts the right <title>, description and link-preview tags into the page the server sends,
 * so search engines and WhatsApp/Facebook previews show the school's details for each public page.
 */
async function withMeta(html: string, path: string, cms: CmsService) {
  if (path.startsWith('/app')) return html;
  const site = await cms.site();
  const school = site.school.name as string;
  let title = school, description = `${school}${site.school.address ? `, ${site.school.address}` : ''}.`, image: string | null = site.school.logo ? `/api/v1/files/${site.school.logo}` : null;
  const seg = path.split('/').filter(Boolean);
  try {
    if (seg[0] === 'events' && seg[1]) { const e = await cms.event(seg[1]); title = `${e.title} | ${school}`; description = (e.description ?? '').slice(0, 160) || description; if (e.cover) image = `/api/v1/files/${e.cover}`; }
    else if (seg[0] === 'gallery' && seg[1]) { const a = await cms.album(seg[1]); title = `${a.title} | Gallery | ${school}`; if (a.photos[0]) image = `/api/v1/files/${a.photos[0].image}`; }
    else if (['events', 'gallery', 'videos'].includes(seg[0])) title = `${seg[0][0].toUpperCase()}${seg[0].slice(1)} | ${school}`;
    else if (seg.length) {
      const slug = seg[0] === 'p' ? seg[1] : seg[0];
      const p = await cms.page(slug);
      title = `${p.seo_title || p.title} | ${school}`;
      if (p.seo_description) description = p.seo_description;
    } else {
      const home = await cms.page('home').catch(() => null);
      if (home?.seo_title) title = home.seo_title;
      if (home?.seo_description) description = home.seo_description;
    }
  } catch { /* unknown page: keep school defaults */ }
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:type" content="website" />`,
    image ? `<meta property="og:image" content="${esc((config.appUrl || '') + image)}" />` : '',
  ].join('\n    ');
  return html.replace(/<title>[^<]*<\/title>/, () => tags); // function form: a $ in a title is never read as a pattern
}
