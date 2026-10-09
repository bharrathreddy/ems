import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { readJson } from '../common/json';
import type { RequestUser } from '../common/request-user';
import { MailService } from '../mail/mail.service';
import { sha256 } from './passwords';

type Meta = { ip: string | null; userAgent: string | null };
interface TwoStepSetting { enabled: boolean; changedAt?: string; changedBy?: number }
interface TestCode { hash: string; expires: number; userId: number; verifiedAt?: string }

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
/** Roles whose logins get the emailed code (with the developer). */
export const TWO_STEP_ROLES = ['institution_admin'];

export const maskEmail = (e: string) => e.replace(/^(.)([^@]*)(@.*)$/, (_m, a, b, c) => `${a}${'•'.repeat(Math.min(6, Math.max(2, b.length)))}${c}`);
const codeHash = (id: string, code: string) => sha256(`${id}:${code}`);
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Two-step login for the developer and Institution Admin logins: after the password, a 6-digit code
 * is emailed and must be entered within 10 minutes (5 tries). It can be switched on only after a test
 * code has reached the developer's inbox, so nobody is locked out by a mail setup that does not work.
 */
@Injectable()
export class TwoStepService {
  constructor(@Inject(KYSELY) private readonly db: Database, private readonly mail: MailService, private readonly audit: AuditService) {}

  private async get<T>(key: string) {
    const r = await this.db.selectFrom('settings').select('value').where('setting_group', '=', 'auth').where('setting_key', '=', key).executeTakeFirst();
    return readJson<T>(r?.value);
  }
  private async put(key: string, value: unknown, by: number | null) {
    await this.db.insertInto('settings').values({ setting_group: 'auth', setting_key: key, value: JSON.stringify(value), is_developer_only: 1, updated_by: by })
      .onDuplicateKeyUpdate({ value: JSON.stringify(value), updated_by: by }).execute();
  }
  async enabled() { return (await this.get<TwoStepSetting>('two_step'))?.enabled === true; }

  private async emailConfigured() {
    const s = await this.db.selectFrom('institution_settings').select('smtp_config').where('id', '=', 1).executeTakeFirst();
    return !!readJson<{ host?: string }>(s?.smtp_config)?.host;
  }

  /** Logins covered by two-step: the developer(s) and every active Institution Admin. */
  private async coveredUsers() {
    const admins = await this.db.selectFrom('users as u').innerJoin('user_roles as ur', 'ur.user_id', 'u.id').innerJoin('roles as r', 'r.id', 'ur.role_id')
      .select(['u.id', 'u.name', 'u.email', 'u.is_super_admin']).distinct().where('r.role_key', 'in', TWO_STEP_ROLES).where('u.status', '=', 'active').execute();
    const devs = await this.db.selectFrom('users').select(['id', 'name', 'email', 'is_super_admin']).where('is_super_admin', '=', 1).where('status', '=', 'active').execute();
    const map = new Map([...devs, ...admins].map((u) => [u.id, u]));
    return [...map.values()];
  }

  async isRequiredFor(user: { id: number; is_super_admin: number; email: string | null }) {
    if (!(await this.enabled()) || !user.email) return false;
    if (user.is_super_admin) return true;
    const r = await this.db.selectFrom('user_roles as ur').innerJoin('roles as r', 'r.id', 'ur.role_id').select('r.id')
      .where('ur.user_id', '=', user.id).where('r.role_key', 'in', TWO_STEP_ROLES).executeTakeFirst();
    return !!r;
  }

  private async sendCode(to: string, name: string, code: string, purpose: string) {
    const school = await this.db.selectFrom('institution_settings').select('name').where('id', '=', 1).executeTakeFirst();
    await this.mail.queueTemplate(to, 'login_code', { name, code, minutes: String(CODE_MINUTES), purpose, school: school?.name ?? 'School' });
    void this.mail.deliverPending().catch(() => undefined); // send now rather than on the next 15-second tick
  }

  /** After a correct password: email a code and return the challenge the login screen answers. */
  async challenge(user: { id: number; name: string; email: string | null }, workspace: 'staff' | 'parent' | 'student', meta: Meta) {
    const id = randomBytes(16).toString('hex');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.updateTable('login_challenges').set({ used_at: new Date() }).where('user_id', '=', user.id).where('used_at', 'is', null).execute();
    await this.db.insertInto('login_challenges').values({ id, user_id: user.id, workspace, code_hash: codeHash(id, code), expires_at: new Date(Date.now() + CODE_MINUTES * 60_000), ip_address: meta.ip }).execute();
    await this.sendCode(user.email!, user.name, code, 'sign in');
    return { twoStep: true as const, challengeId: id, sentTo: maskEmail(user.email!), expiresInMinutes: CODE_MINUTES };
  }

  /** Checks the code; returns the user id on success. Wrong codes count; after 5 the code stops working. */
  async verify(challengeId: string, code: string) {
    const c = await this.db.selectFrom('login_challenges').selectAll().where('id', '=', challengeId).executeTakeFirst();
    if (!c || c.used_at || c.expires_at < new Date() || c.attempts >= MAX_ATTEMPTS) {
      throw Errors.badRequest('CODE_EXPIRED', 'This code has expired or was used too many times. Sign in again to get a new code.');
    }
    if (!same(c.code_hash, codeHash(c.id, code.trim()))) {
      await this.db.updateTable('login_challenges').set({ attempts: c.attempts + 1 }).where('id', '=', c.id).execute();
      const left = MAX_ATTEMPTS - c.attempts - 1;
      return { ok: false as const, userId: c.user_id, left };
    }
    await this.db.updateTable('login_challenges').set({ used_at: new Date() }).where('id', '=', c.id).execute();
    return { ok: true as const, userId: c.user_id };
  }

  // ---------------- Developer console ----------------
  async status() {
    const s = await this.get<TwoStepSetting>('two_step');
    const test = await this.get<TestCode>('two_step_test');
    const people = await this.coveredUsers();
    return {
      enabled: s?.enabled === true, changedAt: s?.changedAt ?? null, emailConfigured: await this.emailConfigured(), testedAt: test?.verifiedAt ?? null,
      covered: people.map((p) => ({ name: p.name, email: p.email ? maskEmail(p.email) : null, developer: !!p.is_super_admin })),
    };
  }

  /** Step 1 of switching on: email a test code to the developer. */
  async sendTest(dev: RequestUser) {
    if (!(await this.emailConfigured())) throw Errors.badRequest('EMAIL_NOT_SET_UP', 'Set up email first (Settings → Email). Two-step login sends its codes by email.');
    const me = await this.db.selectFrom('users').select(['email', 'name']).where('id', '=', dev.id).executeTakeFirstOrThrow();
    if (!me.email) throw Errors.badRequest('NO_EMAIL', 'Your login has no email address.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.put('two_step_test', { hash: codeHash(`test-${dev.id}`, code), expires: Date.now() + CODE_MINUTES * 60_000, userId: dev.id } satisfies TestCode, dev.id);
    await this.sendCode(me.email, me.name, code, 'switch on two-step login');
    return { sentTo: maskEmail(me.email) };
  }

  /** Step 2: the code from the test email switches it on. */
  async enable(dev: RequestUser, code: string, meta: Meta) {
    const t = await this.get<TestCode>('two_step_test');
    if (!t || t.userId !== dev.id || t.expires < Date.now()) throw Errors.badRequest('TEST_FIRST', 'Send yourself a test code first, then enter it here within 10 minutes.');
    if (!same(t.hash, codeHash(`test-${dev.id}`, code.trim()))) throw Errors.validation([{ field: 'code', message: 'That code is not right. Check the latest email.' }]);
    await this.put('two_step_test', { ...t, expires: 0, verifiedAt: new Date().toISOString() }, dev.id);
    await this.put('two_step', { enabled: true, changedAt: new Date().toISOString(), changedBy: dev.id } satisfies TwoStepSetting, dev.id);
    await this.audit.log(dev, { module: 'auth', action: 'two_step_on', entityType: 'setting', after: { enabled: true }, ...meta });
    return this.status();
  }

  async disable(dev: RequestUser, meta: Meta) {
    await this.put('two_step', { enabled: false, changedAt: new Date().toISOString(), changedBy: dev.id } satisfies TwoStepSetting, dev.id);
    await this.audit.log(dev, { module: 'auth', action: 'two_step_off', entityType: 'setting', after: { enabled: false }, ...meta });
    return this.status();
  }
}
