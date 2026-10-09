import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import webpush from 'web-push';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { readJson } from '../common/json';
import type { RequestUser, Workspace } from '../common/request-user';
import { sha256 } from '../auth/passwords';
import { config } from '../config';

export const GROUPS = ['absence', 'notices', 'results', 'approvals'] as const;
export type Group = (typeof GROUPS)[number];
/** Which groups make sense on each kind of login. */
export const GROUPS_FOR: Record<Workspace, Group[]> = { parent: ['absence', 'notices', 'results'], student: ['absence', 'notices', 'results'], staff: ['absence', 'notices', 'approvals'] };
const COL = { absence: 'want_absence', notices: 'want_notices', results: 'want_results', approvals: 'want_approvals' } as const;

interface Vapid { publicKey: string; privateKey: string }
export interface PushTarget { endpoint: string; keys: { p256dh: string; auth: string } }
export interface Subscription { endpoint: string; keys: { p256dh: string; auth: string }; device?: string | null }
type Sender = (sub: PushTarget, payload: string, vapid: Vapid & { subject: string }) => Promise<unknown>;

/**
 * Phone notifications (Web Push). Any in-app notification tagged with a push group is also
 * sent to the person's phones that allowed notifications, unless they switched that group off
 * on that phone. Keys are created on first use and kept in settings (never in the code or .env).
 */
@Injectable()
export class PushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Push');
  private timer?: NodeJS.Timeout;
  private running = false;
  /** Replaced in tests; sends through the browser's push service (Google, Apple, Mozilla). */
  sender: Sender = (sub, payload, v) => webpush.sendNotification(sub, payload, { vapidDetails: v, TTL: 24 * 3600, urgency: 'normal' });

  constructor(@Inject(KYSELY) private readonly db: Database) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.PUSH_WORKER === 'off') return;
    this.timer = setInterval(() => void this.deliver().catch((e) => this.logger.error(e?.message ?? e)), 20_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async vapid(): Promise<Vapid & { subject: string }> {
    const r = await this.db.selectFrom('settings').select('value').where('setting_group', '=', 'push').where('setting_key', '=', 'vapid').executeTakeFirst();
    let v = readJson<Vapid>(r?.value);
    if (!v?.publicKey) {
      v = webpush.generateVAPIDKeys();
      await this.db.insertInto('settings').values({ setting_group: 'push', setting_key: 'vapid', value: JSON.stringify(v), is_developer_only: 1 }).ignore().execute();
      // Another process may have won the race: use whatever is stored.
      v = readJson<Vapid>((await this.db.selectFrom('settings').select('value').where('setting_group', '=', 'push').where('setting_key', '=', 'vapid').executeTakeFirstOrThrow()).value)!;
    }
    const s = await this.db.selectFrom('institution_settings').select('contact_email').where('id', '=', 1).executeTakeFirst();
    const subject = s?.contact_email ? `mailto:${s.contact_email}` : /^https:\/\//.test(config.appUrl) ? config.appUrl : 'mailto:admin@example.com';
    return { ...v, subject };
  }

  async publicKey(u: RequestUser) {
    return { publicKey: (await this.vapid()).publicKey, groups: GROUPS_FOR[u.workspace] };
  }

  private prefs(row: { want_absence: number; want_notices: number; want_results: number; want_approvals: number } | undefined, ws: Workspace) {
    return Object.fromEntries(GROUPS_FOR[ws].map((g) => [g, row ? !!row[COL[g]] : false])) as Partial<Record<Group, boolean>>;
  }

  private checkEndpoint(endpoint: string) {
    // Only real push services over https; never an address inside the school's network.
    let url: URL;
    try { url = new URL(endpoint); } catch { throw Errors.validation([{ field: 'endpoint', message: 'Not a push address.' }]); }
    if (url.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(url.hostname)) throw Errors.validation([{ field: 'endpoint', message: 'Not a push address.' }]);
  }

  async subscribe(u: RequestUser, s: Subscription) {
    if (u.actingUserId) throw Errors.badRequest('PROXY', 'Phone notifications cannot be turned on while using someone else\'s login.');
    this.checkEndpoint(s.endpoint);
    const hash = sha256(s.endpoint);
    await this.db.insertInto('push_subscriptions').values({ user_id: u.id, workspace: u.workspace, endpoint_hash: hash, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth_key: s.keys.auth, device: s.device?.slice(0, 120) ?? null })
      .onDuplicateKeyUpdate({ user_id: u.id, workspace: u.workspace, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth_key: s.keys.auth, failures: 0 }).execute();
    return this.device(u, s.endpoint);
  }

  async device(u: RequestUser, endpoint: string) {
    const row = await this.db.selectFrom('push_subscriptions').selectAll().where('endpoint_hash', '=', sha256(endpoint)).where('user_id', '=', u.id).where('workspace', '=', u.workspace).executeTakeFirst();
    return { subscribed: !!row, prefs: this.prefs(row, u.workspace), devices: await this.count(u) };
  }

  private async count(u: RequestUser) {
    const r = await this.db.selectFrom('push_subscriptions').select((eb) => eb.fn.countAll<number>().as('n')).where('user_id', '=', u.id).where('workspace', '=', u.workspace).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  async setPrefs(u: RequestUser, endpoint: string, prefs: Partial<Record<Group, boolean>>) {
    const allowed = GROUPS_FOR[u.workspace];
    const set: Record<string, number> = {};
    for (const [g, on] of Object.entries(prefs)) if (allowed.includes(g as Group) && typeof on === 'boolean') set[COL[g as Group]] = on ? 1 : 0;
    const r = await this.db.updateTable('push_subscriptions').set(set).where('endpoint_hash', '=', sha256(endpoint)).where('user_id', '=', u.id).where('workspace', '=', u.workspace).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw Errors.notFound('This phone');
    return this.device(u, endpoint);
  }

  async unsubscribe(u: RequestUser, endpoint: string) {
    await this.db.deleteFrom('push_subscriptions').where('endpoint_hash', '=', sha256(endpoint)).where('user_id', '=', u.id).execute();
    return { subscribed: false };
  }

  /** A test message to this phone, so people can see it works. */
  async test(u: RequestUser, endpoint: string) {
    const row = await this.db.selectFrom('push_subscriptions').selectAll().where('endpoint_hash', '=', sha256(endpoint)).where('user_id', '=', u.id).executeTakeFirst();
    if (!row) throw Errors.notFound('This phone');
    const school = await this.db.selectFrom('institution_settings').select('name').where('id', '=', 1).executeTakeFirst();
    const ok = await this.sendTo(row, { title: school?.name ?? 'School', body: 'Notifications are working on this phone.', url: '/app/', tag: 'test' }, await this.vapid());
    if (!ok) throw Errors.badRequest('PUSH_FAILED', 'The phone could not be reached. Turn notifications off and on again.');
    return { sent: true };
  }

  private async sendTo(row: { id: number; endpoint: string; p256dh: string; auth_key: string; failures: number }, msg: object, v: Vapid & { subject: string }) {
    try {
      await this.sender({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth_key } }, JSON.stringify(msg), v);
      await this.db.updateTable('push_subscriptions').set({ last_sent_at: new Date(), failures: 0 }).where('id', '=', row.id).execute();
      return true;
    } catch (e: any) {
      const gone = e?.statusCode === 404 || e?.statusCode === 410;
      if (gone || row.failures + 1 >= 10) await this.db.deleteFrom('push_subscriptions').where('id', '=', row.id).execute();
      else await this.db.updateTable('push_subscriptions').set({ failures: row.failures + 1 }).where('id', '=', row.id).execute();
      if (!gone) this.logger.warn(`Push failed (${e?.statusCode ?? ''}): ${String(e?.body ?? e?.message ?? e).slice(0, 200)}`);
      return false;
    }
  }

  /** Sends new tagged notifications (from the last 2 days) to the phones that want them. */
  async deliver(limit = 300) {
    if (this.running) return { sent: 0 };
    this.running = true;
    try {
      const rows = await this.db.selectFrom('notifications').select(['id', 'user_id', 'workspace', 'push_group', 'title', 'body', 'link_path', 'created_at'])
        .where('pushed_at', 'is', null).where('push_group', 'is not', null).where('created_at', '>', new Date(Date.now() - 2 * 86_400_000))
        .orderBy('id').limit(limit).execute();
      if (!rows.length) return { sent: 0 };
      await this.db.updateTable('notifications').set({ pushed_at: new Date() }).where('id', 'in', rows.map((r) => r.id)).execute();
      const subs = await this.db.selectFrom('push_subscriptions as p').innerJoin('users as u', 'u.id', 'p.user_id').selectAll('p')
        .where('p.user_id', 'in', [...new Set(rows.map((r) => r.user_id))]).where('u.status', '=', 'active').execute();
      if (!subs.length) return { sent: 0 };
      const v = await this.vapid();
      let sent = 0;
      for (const n of rows) {
        const g = n.push_group as Group;
        for (const s of subs.filter((x) => x.user_id === n.user_id && x.workspace === n.workspace && x[COL[g]] === 1 && x.created_at <= n.created_at)) {
          const url = n.link_path ? `/app${n.link_path.startsWith('/') ? '' : '/'}${n.link_path}` : '/app/';
          if (await this.sendTo(s, { title: n.title, body: n.body ?? '', url, tag: `n${n.id}`, workspace: n.workspace }, v)) sent++;
        }
      }
      return { sent };
    } finally {
      this.running = false;
    }
  }
}
