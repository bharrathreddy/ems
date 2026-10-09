import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, Public, type AppRequest } from '../common/request-user';
import { MailService } from '../mail/mail.service';
import { normalizeMobile } from '../auth/passwords';
import { CmsService } from './cms.service';
import { staffWith } from '../common/holders';

const Contact = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(100),
  mobile: z.string().trim().max(20).optional().transform((v, ctx) => {
    if (!v) return null;
    const m = normalizeMobile(v);
    if (!m) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit mobile number.' });
    return m;
  }),
  message: z.string().trim().min(5, 'Write a short message.').max(2000),
  website: z.string().max(0).optional(), // honeypot: real people never fill this hidden field (rule W11)
});

/** Read-only endpoints for the public website. No login. */
@ApiTags('Website (public)')
@Public()
@Controller('public')
export class PublicController {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly cms: CmsService, private readonly mail: MailService) {}

  @Get('site') site() { return this.cms.site(); }
  @Get('home') home() { return this.cms.home(); }
  @Get('pages/:slug') page(@Param('slug') slug: string) { return this.cms.page(slug); }
  @Get('events') async events(@Query('scope') scope?: string) {
    if (!(await this.cms.enabled())) throw Errors.notFound('Page');
    return { upcoming: await this.cms.events('upcoming'), past: await this.cms.events(scope === 'all' ? 'all' : 'past') };
  }
  @Get('events/:slug') event(@Param('slug') slug: string) { return this.cms.event(slug); }
  @Get('gallery') gallery() { return this.cms.albums(); }
  @Get('gallery/:slug') album(@Param('slug') slug: string) { return this.cms.album(slug); }
  @Get('videos') async videos() {
    if (!(await this.cms.enabled())) throw Errors.notFound('Page');
    return this.cms.videos();
  }
  @Get('notices') async notices() {
    if (!(await this.cms.enabled())) throw Errors.notFound('Page');
    return this.cms.publicNotices(30);
  }

  /** Rules W8 to W11: save the message, email the school, and give the visitor a pre-filled WhatsApp link. */
  @Post('contact')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async contact(@Body(new ZodPipe(Contact)) b: z.infer<typeof Contact>, @Req() req: AppRequest) {
    if (!(await this.cms.enabled())) throw Errors.notFound('Page');
    if (b.website) return { received: true, whatsappUrl: null }; // silently ignore bots
    const meta = clientMeta(req);
    const site = await this.cms.site();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('contact_messages').values({ name: b.name, mobile: b.mobile, message: b.message, ip_address: meta.ip, user_agent: meta.userAgent }).execute();
      // Every website message is an admission enquiry: alert the people who follow enquiries up.
      const to = await staffWith(trx, 'enquiries', 'view');
      if (to.length) await trx.insertInto('notifications').values(to.map((id) => ({ user_id: id, workspace: 'staff' as const, category: 'communication' as const, push_group: 'approvals' as const,
        title: `New enquiry: ${b.name}`, body: b.message.replace(/\s+/g, ' ').slice(0, 200), link_path: '/enquiries' }))).execute();
      if (site.school.email) await this.mail.queueTemplate(site.school.email, 'contact_message', { name: b.name, mobile: b.mobile ?? 'not given', message: b.message }, trx);
    });
    const text = `Hello ${site.school.name}, I am ${b.name}${b.mobile ? ` (${b.mobile})` : ''}.\n${b.message}`;
    return { received: true, whatsappUrl: site.school.whatsapp ? `https://wa.me/91${site.school.whatsapp}?text=${encodeURIComponent(text)}` : null };
  }
}
