import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { KYSELY, type Database } from '../database/database.module';
import { readJson } from '../common/json';

interface SmtpConfig { host: string; port: number; secure: boolean; user?: string; pass?: string; fromName: string; fromEmail: string }

/**
 * Outbox pattern: emails are written to email_outbox inside the business
 * transaction, then delivered by a small background loop with retries.
 * (BullMQ + Redis replaces this loop when heavier jobs arrive in R2.)
 */
@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Mail');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(@Inject(KYSELY) private readonly db: Database) {}

  onModuleInit() {
    if (process.env.MAIL_WORKER !== 'off') this.timer = setInterval(() => void this.deliverPending(), 15_000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Render a stored template with {{variables}} and queue it. */
  async queueTemplate(to: string, templateKey: string, vars: Record<string, string>, trx: Database = this.db) {
    const t = await trx.selectFrom('email_templates').selectAll().where('template_key', '=', templateKey).executeTakeFirst();
    if (!t || !t.is_active) {
      this.logger.warn(`Email template ${templateKey} missing or inactive; email to ${to} not queued.`);
      return;
    }
    const render = (s: string) => s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => escapeHtml(vars[k] ?? ''));
    // The subject is plain text: no HTML escaping, and no line breaks (they could add extra mail headers).
    const subject = t.subject.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => vars[k] ?? '').replace(/[\r\n]+/g, ' ').slice(0, 250);
    await trx
      .insertInto('email_outbox')
      .values({ to_email: to, template_key: templateKey, subject, body_html: render(t.body_html) })
      .execute();
  }

  async deliverPending(limit = 20) {
    if (this.running) return;
    this.running = true;
    try {
      const settings = await this.db.selectFrom('institution_settings').select('smtp_config').where('id', '=', 1).executeTakeFirst();
      const smtp = readJson<SmtpConfig>(settings?.smtp_config);
      if (!smtp?.host) return; // stays queued until SMTP is configured
      const transport = nodemailer.createTransport({
        host: smtp.host, port: smtp.port, secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      });
      const pending = await this.db
        .selectFrom('email_outbox').selectAll()
        .where('status', '=', 'queued').where('attempts', '<', 5)
        .orderBy('id').limit(limit).execute();
      for (const m of pending) {
        try {
          await transport.sendMail({
            from: `"${smtp.fromName}" <${smtp.fromEmail}>`, to: m.to_email, subject: m.subject, html: m.body_html,
          });
          await this.db.updateTable('email_outbox')
            .set({ status: 'sent', sent_at: new Date(), attempts: m.attempts + 1, last_error: null })
            .where('id', '=', m.id).execute();
        } catch (e: any) {
          const attempts = m.attempts + 1;
          await this.db.updateTable('email_outbox')
            .set({ attempts, status: attempts >= 5 ? 'failed' : 'queued', last_error: String(e?.message ?? e).slice(0, 500) })
            .where('id', '=', m.id).execute();
        }
      }
    } finally {
      this.running = false;
    }
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
