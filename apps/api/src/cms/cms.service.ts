import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { readJson } from '../common/json';
import { PermissionsService } from '../permissions/permissions.service';

export const BUILTIN: Record<string, string> = { home: '/', events: '/events', gallery: '/gallery', videos: '/videos', contact: '/contact' };
export const pageHref = (slug: string) => (slug === 'home' ? '/' : ['about', 'contact', 'privacy'].includes(slug) ? `/${slug}` : `/p/${slug}`);

export function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 70) || 'item';
}

/** Accepts any common YouTube link (watch, youtu.be, shorts, embed, live) or a bare 11-character id. */
export function youtubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return /^[\w-]{11}$/.test(u.pathname.slice(1, 12)) ? u.pathname.slice(1, 12) : null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = /^\/(?:shorts|embed|live)\/([\w-]{11})/.exec(u.pathname);
      return m ? m[1] : null;
    }
  } catch { /* not a URL */ }
  return null;
}

/** Accepts a Google Maps "embed" link or the whole <iframe> code copied from Google Maps (Share > Embed a map). */
export function mapEmbedUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return '';
  const src = /src=["']([^"']+)["']/.exec(s)?.[1] ?? s;
  try {
    const u = new URL(src.replace(/&amp;/g, '&'));
    if (u.protocol === 'https:' && (u.hostname === 'www.google.com' || u.hostname === 'maps.google.com') && u.pathname.startsWith('/maps/embed')) return u.toString();
  } catch { /* invalid */ }
  return null;
}

@Injectable()
export class CmsService {
  private cache: { at: number; site: any } | null = null;
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly perms: PermissionsService) {}

  invalidate() { this.cache = null; }

  async enabled() { return this.perms.isModuleEnabled('cms'); }

  async uniqueSlug(table: 'cms_events' | 'cms_albums' | 'cms_pages', base: string, exceptId?: number) {
    let slug = slugify(base), n = 1;
    for (;;) {
      let q = this.db.selectFrom(table).select('id').where('slug', '=', slug);
      if (exceptId) q = q.where('id', '!=', exceptId);
      if (!(await q.executeTakeFirst())) return slug;
      slug = `${slugify(base)}-${++n}`;
    }
  }

  async setting<T>(key: string): Promise<T> {
    const r = await this.db.selectFrom('settings').select('value').where('setting_group', '=', 'website').where('setting_key', '=', key).executeTakeFirst();
    return (readJson<T>(r?.value) ?? {}) as T;
  }

  // ---------------- Public ----------------

  async site() {
    // The on/off switch is checked on every request (it has its own cache, cleared when toggled).
    const enabled = await this.enabled();
    if (this.cache && Date.now() - this.cache.at < 30_000) return { ...this.cache.site, enabled };
    const inst = await this.db.selectFrom('institution_settings as i').leftJoin('files as f', 'f.id', 'i.logo_file_id')
      .select(['i.name', 'i.short_name', 'i.institution_type', 'i.brand_primary', 'i.address', 'i.phone', 'i.contact_email', 'i.contact_whatsapp', 'f.public_id as logo'])
      .where('i.id', '=', 1).executeTakeFirstOrThrow();
    const [menus, pages, contact, social] = await Promise.all([
      this.db.selectFrom('cms_menu_items').selectAll().where('is_visible', '=', 1).orderBy('location').orderBy('position').execute(),
      this.db.selectFrom('cms_pages').select(['slug', 'is_published']).execute(),
      this.setting<{ mapEmbedUrl: string; officeHours: string }>('contact'),
      this.setting<Record<string, string>>('social'),
    ]);
    const published = new Set(pages.filter((p) => p.is_published).map((p) => p.slug));
    const link = (m: (typeof menus)[number]) => ({
      label: m.label, newTab: m.new_tab === 1,
      href: m.link_type === 'builtin' ? BUILTIN[m.target] ?? '/' : m.link_type === 'page' ? pageHref(m.target) : m.target,
      external: m.link_type === 'url',
    });
    const visible = (m: (typeof menus)[number]) => m.link_type !== 'page' || published.has(m.target);
    const site = {
      enabled,
      school: { name: inst.name, shortName: inst.short_name, type: inst.institution_type, brandPrimary: inst.brand_primary, logo: inst.logo,
        address: inst.address, phone: inst.phone, email: inst.contact_email, whatsapp: inst.contact_whatsapp },
      menus: { header: menus.filter((m) => m.location === 'header' && visible(m)).map(link), footer: menus.filter((m) => m.location === 'footer' && visible(m)).map(link) },
      contact, social: Object.fromEntries(Object.entries(social).filter(([, v]) => v)),
    };
    this.cache = { at: Date.now(), site };
    return site;
  }

  private assertEnabled = async () => { if (!(await this.enabled())) throw Errors.notFound('Page'); };

  async home() {
    await this.assertEnabled();
    const sections = await this.db.selectFrom('cms_home_sections').selectAll().where('is_visible', '=', 1).orderBy('position').execute();
    const out = [];
    for (const s of sections) {
      const content = readJson<any>(s.content) ?? {};
      let data: unknown = null;
      const n = Math.min(Number(content.count) || 3, 12);
      if (s.section_key === 'notices') data = await this.publicNotices(n);
      if (s.section_key === 'events') data = (await this.events('upcoming', n)).concat(await this.events('past', n)).slice(0, n);
      if (s.section_key === 'gallery') data = await this.db.selectFrom('cms_photos as p').innerJoin('cms_albums as a', 'a.id', 'p.album_id').innerJoin('files as f', 'f.id', 'p.file_id')
        .select(['f.public_id as image', 'p.caption', 'a.slug as album', 'a.title as albumTitle']).where('a.is_published', '=', 1).orderBy('p.id', 'desc').limit(n).execute();
      if (s.section_key === 'videos') data = await this.videos(n);
      if (s.section_key === 'principal') delete content.fullMessage;
      out.push({ key: s.section_key, content, data });
    }
    return out;
  }

  publicNotices(limit: number) {
    return this.db.selectFrom('announcements').select(['id', 'title', 'body_html as body', 'publish_at'])
      .where('is_public', '=', 1).where('status', '=', 'published')
      .where((eb) => eb.or([eb('expire_at', 'is', null), eb('expire_at', '>', new Date())]))
      .orderBy('publish_at', 'desc').limit(limit).execute();
  }

  async page(slug: string) {
    await this.assertEnabled();
    const p = await this.db.selectFrom('cms_pages').select(['slug', 'kind', 'title', 'body', 'seo_title', 'seo_description', 'is_published']).where('slug', '=', slug).executeTakeFirst();
    if (!p || !p.is_published) throw Errors.notFound('Page');
    let principal = null;
    if (p.kind === 'about') {
      const s = await this.db.selectFrom('cms_home_sections').select('content').where('section_key', '=', 'principal').executeTakeFirst();
      const c = readJson<any>(s?.content);
      if (c) principal = { name: c.name, designation: c.designation, photoId: c.photoId, heading: c.heading, message: c.fullMessage || c.message };
    }
    const { is_published, ...rest } = p;
    return { ...rest, principal };
  }

  async events(scope: 'upcoming' | 'past' | 'all', limit = 50) {
    let q = this.db.selectFrom('cms_events as e').leftJoin('files as f', 'f.id', 'e.cover_file_id')
      .select(['e.slug', 'e.title', 'e.event_date', 'e.end_date', 'e.location', 'f.public_id as cover',
        sql<string>`SUBSTRING(COALESCE(e.description, ''), 1, 220)`.as('summary')])
      .where('e.is_published', '=', 1);
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    if (scope === 'upcoming') q = q.where((eb) => eb.or([eb('e.event_date', '>=', today), eb('e.end_date', '>=', today)])).orderBy('e.event_date', 'asc');
    else if (scope === 'past') q = q.where('e.event_date', '<', today).where((eb) => eb.or([eb('e.end_date', 'is', null), eb('e.end_date', '<', today)])).orderBy('e.event_date', 'desc');
    else q = q.orderBy('e.event_date', 'desc');
    return q.limit(limit).execute();
  }

  async event(slug: string) {
    await this.assertEnabled();
    const e = await this.db.selectFrom('cms_events as e').leftJoin('files as f', 'f.id', 'e.cover_file_id')
      .select(['e.id', 'e.slug', 'e.title', 'e.event_date', 'e.end_date', 'e.location', 'e.description', 'f.public_id as cover'])
      .where('e.slug', '=', slug).where('e.is_published', '=', 1).executeTakeFirst();
    if (!e) throw Errors.notFound('Event');
    const [photos, videos] = await Promise.all([
      this.db.selectFrom('cms_photos as p').innerJoin('cms_albums as a', 'a.id', 'p.album_id').innerJoin('files as f', 'f.id', 'p.file_id')
        .select(['f.public_id as image', 'p.caption']).where('a.event_id', '=', e.id).where('a.is_published', '=', 1).orderBy('a.id').orderBy('p.position').orderBy('p.id').execute(),
      this.db.selectFrom('cms_videos').select(['youtube_id', 'title']).where('event_id', '=', e.id).where('is_published', '=', 1).execute(),
    ]);
    const { id, ...rest } = e;
    return { ...rest, photos, videos };
  }

  async albums() {
    await this.assertEnabled();
    return this.db.selectFrom('cms_albums as a').leftJoin('files as f', 'f.id', 'a.cover_file_id').leftJoin('cms_events as e', 'e.id', 'a.event_id')
      .select(['a.slug', 'a.title', 'a.created_at', 'e.event_date', 'e.title as event',
        sql<string | null>`COALESCE(f.public_id, (SELECT f2.public_id FROM cms_photos p2 JOIN files f2 ON f2.id = p2.file_id WHERE p2.album_id = a.id ORDER BY p2.position, p2.id LIMIT 1))`.as('cover'),
        sql<number>`(SELECT COUNT(*) FROM cms_photos p3 WHERE p3.album_id = a.id)`.as('photos')])
      .where('a.is_published', '=', 1).orderBy(sql`COALESCE(e.event_date, a.created_at)`, 'desc').execute();
  }

  async album(slug: string) {
    await this.assertEnabled();
    const a = await this.db.selectFrom('cms_albums as a').leftJoin('cms_events as e', 'e.id', 'a.event_id')
      .select(['a.id', 'a.title', 'a.slug', 'e.title as event', 'e.slug as eventSlug', 'e.event_date']).where('a.slug', '=', slug).where('a.is_published', '=', 1).executeTakeFirst();
    if (!a) throw Errors.notFound('Album');
    const photos = await this.db.selectFrom('cms_photos as p').innerJoin('files as f', 'f.id', 'p.file_id')
      .select(['f.public_id as image', 'p.caption']).where('p.album_id', '=', a.id).orderBy('p.position').orderBy('p.id').execute();
    const { id, ...rest } = a;
    return { ...rest, photos };
  }

  async videos(limit = 100) {
    return this.db.selectFrom('cms_videos as v').leftJoin('cms_events as e', 'e.id', 'v.event_id')
      .select(['v.youtube_id', 'v.title', 'v.description', 'v.created_at', 'e.title as event', 'e.slug as eventSlug'])
      .where('v.is_published', '=', 1).orderBy('v.id', 'desc').limit(limit).execute();
  }
}
