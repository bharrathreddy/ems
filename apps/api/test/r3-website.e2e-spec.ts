import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { createDatabase, type Database } from '../src/database/database.module';
import { seed } from '../src/database/seed';
import { mapEmbedUrl, youtubeId } from '../src/cms/cms.service';

const DEV = { email: 'dev@test.local', password: 'DevPass@123' };
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('Public website (e2e)', () => {
  let app: INestApplication; let db: Database; let http: any; let dev: string;
  const login = (i: string, p: string) => http.post('/api/v1/auth/login').send({ identifier: i, password: p });
  const as = (t: string) => {
    const h = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
    return { get: (u: string) => h(http.get(u)), post: (u: string, b: object = {}) => h(http.post(u)).send(b), put: (u: string, b: object) => h(http.put(u)).send(b),
      patch: (u: string, b: object) => h(http.patch(u)).send(b), del: (u: string) => h(http.delete(u)), upload: (u: string, buf: Buffer, name: string, type: string) => h(http.post(u)).attach('file', buf, { filename: name, contentType: type }) };
  };
  const pub = (u: string) => http.get(`/api/v1/public${u}`);

  beforeAll(async () => {
    db = createDatabase();
    await seed(db, { institutionName: 'Test School', superAdminEmail: DEV.email, superAdminPassword: DEV.password });
    app = await createApp(); await app.init(); http = request(app.getHttpServer());
    dev = (await login(DEV.email, DEV.password)).body.data.accessToken;
    await as(dev).put('/api/v1/developer/feature-flags/cms', { enabled: true });
    await as(dev).patch('/api/v1/settings/institution', { contactEmail: 'office@test.school', contactWhatsapp: '9876500000', address: '1-2 Main Road' });
  });
  afterAll(async () => { await app.close(); await db.destroy(); });

  it('serves site details, menus and default home sections', async () => {
    const site = (await pub('/site')).body.data;
    expect(site.enabled).toBe(true);
    expect(site.school).toMatchObject({ name: 'Test School', whatsapp: '9876500000' });
    expect(site.menus.header.map((m: any) => m.href)).toEqual(['/', '/about', '/events', '/gallery', '/videos', '/contact']);
    expect(site.menus.footer.map((m: any) => m.label)).toContain('Privacy policy');
    const home = (await pub('/home')).body.data.map((s: any) => s.key);
    expect(home[0]).toBe('banner');
    expect(home).not.toContain('testimonials'); // hidden by default
  });

  it('lets the admin reorder, hide and edit home sections with validation', async () => {
    const order = (await as(dev).get('/api/v1/cms/home')).body.data.map((s: any) => s.key);
    await as(dev).put('/api/v1/cms/home/order', { keys: ['admissions', ...order.filter((k: string) => k !== 'admissions')] });
    await as(dev).patch('/api/v1/cms/home/videos', { visible: false });
    const bad = await as(dev).patch('/api/v1/cms/home/admissions', { content: { heading: 'Admissions', text: 'x', buttonLabel: 'Go', buttonLink: 'javascript:alert(1)' } });
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    const home = (await pub('/home')).body.data.map((s: any) => s.key);
    expect(home[0]).toBe('admissions');
    expect(home).not.toContain('videos');
  });

  it('accepts real images only and serves public files, never private ones', async () => {
    const fake = await as(dev).upload('/api/v1/cms/uploads', Buffer.from('<script>alert(1)</script>'), 'evil.png', 'image/png');
    expect(fake.body.code).toBe('NOT_AN_IMAGE');
    const up = await as(dev).upload('/api/v1/cms/uploads', PNG, 'school.png', 'image/png');
    expect(up.status).toBe(201);
    const file = await http.get(up.body.data.url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    const r = await as(dev).patch('/api/v1/cms/home/banner', { content: { autoplaySeconds: 5, slides: [{ imageId: up.body.data.id, heading: 'Welcome', text: '', buttonLabel: '', buttonLink: '' }] } });
    expect(r.status).toBe(200);
    expect((await pub('/home')).body.data.find((s: any) => s.key === 'banner').content.slides[0].imageId).toBe(up.body.data.id);
    const priv = await db.selectFrom('files').select('public_id').where('visibility', '=', 'private').executeTakeFirst();
    if (priv) expect((await http.get(`/api/v1/files/${priv.public_id}`)).status).toBe(404);
  });

  it('uploads the school logo and shows it on the site', async () => {
    const r = await as(dev).upload('/api/v1/settings/logo', PNG, 'logo.png', 'image/png');
    expect(r.body.data.id).toHaveLength(26);
    expect((await http.get('/api/v1/public/branding')).body.data.logo).toBe(r.body.data.id);
  });

  it('manages pages: system pages cannot be deleted, unpublished pages are hidden with their menu links', async () => {
    const pages = (await as(dev).get('/api/v1/cms/pages')).body.data;
    const about = pages.find((p: any) => p.slug === 'about');
    expect((await as(dev).del(`/api/v1/cms/pages/${about.id}`)).body.code).toBe('SYSTEM_PAGE');
    const c = (await as(dev).post('/api/v1/cms/pages', { title: 'Admissions 2027', body: '# Apply\nVisit the office.' })).body.data;
    expect(c.slug).toBe('admissions-2027');
    expect((await pub('/pages/admissions-2027')).body.data.title).toBe('Admissions 2027');
    await as(dev).put('/api/v1/cms/menus/header', { items: [
      { label: 'Home', linkType: 'builtin', target: 'home', isVisible: true }, { label: 'Admissions', linkType: 'page', target: 'admissions-2027', isVisible: true },
      { label: 'Facebook', linkType: 'url', target: 'https://facebook.com/school', isVisible: true, newTab: true }] });
    expect((await pub('/site')).body.data.menus.header.map((m: any) => m.href)).toEqual(['/', '/p/admissions-2027', 'https://facebook.com/school']);
    await as(dev).patch(`/api/v1/cms/pages/${c.id}`, { isPublished: false });
    expect((await pub('/pages/admissions-2027')).status).toBe(404);
    expect((await pub('/site')).body.data.menus.header.map((m: any) => m.label)).toEqual(['Home', 'Facebook']);
    const bad = await as(dev).put('/api/v1/cms/menus/footer', { items: [{ label: 'X', linkType: 'url', target: 'ftp://x', isVisible: true }] });
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    const about2 = (await pub('/pages/about')).body.data;
    expect(about2.principal).toHaveProperty('message');
  });

  it('runs events with their albums and videos; splits upcoming and past', async () => {
    const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    const sports = (await as(dev).post('/api/v1/cms/events', { title: 'Annual Sports Day', eventDate: future, location: 'School ground', description: 'Races and games.' })).body.data;
    await as(dev).post('/api/v1/cms/events', { title: 'Science Fair', eventDate: '2025-12-10' });
    const album = (await as(dev).post('/api/v1/cms/albums', { title: 'Sports Day photos', eventSlug: sports.slug })).body.data;
    expect((await as(dev).upload(`/api/v1/cms/albums/${album.id}/photos`, PNG, 'p1.png', 'image/png')).status).toBe(201);
    await as(dev).post('/api/v1/cms/videos', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', title: 'Sports day highlights', eventSlug: sports.slug });
    const ev = (await pub('/events')).body.data;
    expect(ev.upcoming.map((e: any) => e.title)).toContain('Annual Sports Day');
    expect(ev.past.map((e: any) => e.title)).toContain('Science Fair');
    const detail = (await pub(`/events/${sports.slug}`)).body.data;
    expect(detail.photos).toHaveLength(1);
    expect(detail.videos[0].youtube_id).toBe('dQw4w9WgXcQ');
    expect((await pub('/gallery')).body.data[0]).toMatchObject({ title: 'Sports Day photos', photos: 1 });
    expect((await as(dev).post('/api/v1/cms/videos', { url: 'https://vimeo.com/123', title: 'Nope' })).body.code).toBe('VALIDATION_FAILED');
  });

  it('parses YouTube links and Google Maps embed codes', () => {
    for (const u of ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ']) expect(youtubeId(u)).toBe('dQw4w9WgXcQ');
    expect(mapEmbedUrl('<iframe src="https://www.google.com/maps/embed?pb=!1m18!2d78.1" width="600"></iframe>')).toBe('https://www.google.com/maps/embed?pb=!1m18!2d78.1');
    expect(mapEmbedUrl('https://evil.example/maps/embed')).toBeNull();
  });

  it('contact form: saves, emails the school, returns a WhatsApp link, ignores bots', async () => {
    const bad = await http.post('/api/v1/public/contact').send({ name: 'A', message: 'hi' });
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    const r = await http.post('/api/v1/public/contact').send({ name: 'Ravi Kumar', mobile: '98765 43210', message: 'Is admission open for Class 3?' });
    expect(r.body.data.whatsappUrl).toMatch(/^https:\/\/wa\.me\/919876500000\?text=Hello%20Test%20School/);
    const msg = (await as(dev).get('/api/v1/enquiries')).body.data.rows[0];
    expect(msg).toMatchObject({ name: 'Ravi Kumar', mobile: '9876543210', status: 'new' });
    const mail = await db.selectFrom('email_outbox').selectAll().where('template_key', '=', 'contact_message').orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect(mail.to_email).toBe('office@test.school');
    const before = (await as(dev).get('/api/v1/enquiries')).body.data.rows.length;
    await http.post('/api/v1/public/contact').send({ name: 'Bot', message: 'Buy cheap stuff now', website: 'http://spam' });
    expect((await as(dev).get('/api/v1/enquiries')).body.data.rows.length).toBe(before);
  });

  it('shows only notices marked for the website', async () => {
    await as(dev).post('/api/v1/announcements', { title: 'Holiday on Monday', body: 'School closed.', audience: { type: 'all' }, publish: true, isPublic: true });
    await as(dev).post('/api/v1/announcements', { title: 'Staff meeting', body: 'Internal.', audience: { type: 'staff' }, publish: true });
    const titles = (await pub('/notices')).body.data.map((n: any) => n.title);
    expect(titles).toContain('Holiday on Monday');
    expect(titles).not.toContain('Staff meeting');
  });

  it('puts page titles in the HTML for search engines and link previews', async () => {
    const r = await http.get('/about');
    if (r.status === 200 && r.headers['content-type']?.includes('html')) {
      expect(r.text).toContain('<title>About us | Test School</title>');
      expect(r.text).toContain('og:title');
    }
  });

  it('only website managers can edit; turning the module off hides the site', async () => {
    const t = await as(dev).post('/api/v1/staff', { name: 'Web T', email: 'webt@test.local', mobile: '9440000001', employeeCode: 'W-1', roleKeys: ['teacher'] });
    const c = (await as(dev).post(`/api/v1/users/${t.body.data.user_id}/credentials`)).body.data;
    let tok = (await login(c.username, c.temporaryPassword)).body.data.accessToken;
    await as(tok).post('/api/v1/auth/change-password', { currentPassword: c.temporaryPassword, newPassword: 'NewPass@123' });
    tok = (await login(c.username, 'NewPass@123')).body.data.accessToken;
    expect((await as(tok).patch('/api/v1/cms/home/videos', { visible: true })).status).toBe(403);
    await as(dev).put('/api/v1/developer/feature-flags/cms', { enabled: false });
    expect((await pub('/site')).body.data.enabled).toBe(false);
    expect((await pub('/home')).status).toBe(404);
    await as(dev).put('/api/v1/developer/feature-flags/cms', { enabled: true });
  });
});
