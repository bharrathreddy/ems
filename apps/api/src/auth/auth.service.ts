import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { config } from '../config';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import type { RequestUser, Workspace } from '../common/request-user';
import { PermissionsService } from '../permissions/permissions.service';
import { MailService } from '../mail/mail.service';
import { dummyVerify, hashPassword, newToken, normalizeMobile, sha256, verifyPassword } from './passwords';

interface Meta { ip: string | null; userAgent: string | null }

@Injectable()
export class AuthService {
  constructor(
    @Inject(KYSELY) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly perms: PermissionsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private findByIdentifier(identifier: string) {
    const q = this.db.selectFrom('users').selectAll();
    if (identifier.includes('@')) return q.where('email', '=', identifier.trim().toLowerCase()).executeTakeFirst();
    const mobile = normalizeMobile(identifier);
    return mobile ? q.where('mobile', '=', mobile).executeTakeFirst() : Promise.resolve(undefined);
  }

  private logLogin(userId: number | null, identifier: string, success: boolean, reason: string | null, meta: Meta) {
    return this.db.insertInto('login_logs')
      .values({ user_id: userId, identifier: identifier.slice(0, 190), success: success ? 1 : 0, reason, ip_address: meta.ip, user_agent: meta.userAgent })
      .execute();
  }

  async login(identifier: string, password: string, meta: Meta) {
    const user = await this.findByIdentifier(identifier);
    if (!user || !user.password_hash) {
      await dummyVerify(password);
      await this.logLogin(user?.id ?? null, identifier, false, user ? 'no_password' : 'unknown_user', meta);
      throw Errors.invalidCredentials();
    }
    if (user.locked_until && user.locked_until > new Date()) {
      await this.logLogin(user.id, identifier, false, 'locked', meta);
      throw Errors.accountLocked(user.locked_until);
    }
    const ok = await verifyPassword(user.password_hash, password);
    if (!ok) {
      const failed = user.failed_login_count + 1;
      const lock = failed >= config.maxFailedLogins;
      await this.db.updateTable('users')
        .set({ failed_login_count: lock ? 0 : failed, locked_until: lock ? new Date(Date.now() + config.lockMinutes * 60_000) : null })
        .where('id', '=', user.id).execute();
      await this.logLogin(user.id, identifier, false, lock ? 'bad_password_locked' : 'bad_password', meta);
      throw Errors.invalidCredentials();
    }
    if (user.status !== 'active') {
      await this.logLogin(user.id, identifier, false, 'disabled', meta);
      throw Errors.accountDisabled();
    }
    const workspaces = await this.perms.availableWorkspaces(user.id, user.is_super_admin === 1);
    if (workspaces.length === 0) {
      await this.logLogin(user.id, identifier, false, 'no_workspace', meta);
      throw Errors.accountDisabled();
    }
    await this.db.updateTable('users')
      .set({ failed_login_count: 0, locked_until: null, last_login_at: new Date() })
      .where('id', '=', user.id).execute();
    await this.logLogin(user.id, identifier, true, null, meta);
    const tokens = await this.createSession(user.id, meta);
    return { ...tokens, mustChangePassword: user.must_change_password === 1, workspaces };
  }

  private async createSession(userId: number, meta: Meta) {
    const refreshToken = newToken();
    const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 86_400_000);
    const res = await this.db.insertInto('sessions')
      .values({ user_id: userId, refresh_token_hash: sha256(refreshToken), ip_address: meta.ip, user_agent: meta.userAgent, expires_at: expiresAt, last_used_at: new Date() })
      .executeTakeFirstOrThrow();
    const sessionId = Number(res.insertId);
    const accessToken = await this.jwt.signAsync({ sub: userId, sid: sessionId }, { expiresIn: `${config.accessTokenTtlMin}m` });
    return { accessToken, refreshToken, refreshExpiresAt: expiresAt, expiresIn: config.accessTokenTtlMin * 60 };
  }

  /** Rotating refresh tokens. Reuse of a rotated token revokes every session of that user. */
  async refresh(refreshToken: string, meta: Meta) {
    const session = await this.db.selectFrom('sessions').selectAll()
      .where('refresh_token_hash', '=', sha256(refreshToken)).executeTakeFirst();
    if (!session) throw Errors.unauthenticated();
    if (session.revoked_at) {
      await this.revokeAll(session.user_id);
      await this.audit.log(null, { module: 'auth', action: 'refresh_token_reuse', entityType: 'user', entityId: session.user_id, ip: meta.ip, userAgent: meta.userAgent });
      throw Errors.unauthenticated();
    }
    if (session.expires_at < new Date()) throw Errors.unauthenticated();
    const user = await this.db.selectFrom('users').select(['id', 'status']).where('id', '=', session.user_id).executeTakeFirst();
    if (!user || user.status !== 'active') throw Errors.accountDisabled();
    await this.db.updateTable('sessions').set({ revoked_at: new Date() }).where('id', '=', session.id).execute();
    return this.createSession(session.user_id, meta);
  }

  async logout(sessionId: number) {
    await this.db.updateTable('sessions').set({ revoked_at: new Date() }).where('id', '=', sessionId).where('revoked_at', 'is', null).execute();
  }

  async revokeAll(userId: number, exceptSessionId?: number) {
    let q = this.db.updateTable('sessions').set({ revoked_at: new Date() }).where('user_id', '=', userId).where('revoked_at', 'is', null);
    if (exceptSessionId) q = q.where('id', '!=', exceptSessionId);
    await q.execute();
  }

  async changePassword(user: RequestUser, currentPassword: string, newPassword: string, meta: Meta) {
    const row = await this.db.selectFrom('users').select(['password_hash']).where('id', '=', user.id).executeTakeFirstOrThrow();
    if (!row.password_hash || !(await verifyPassword(row.password_hash, currentPassword))) {
      throw Errors.badRequest('CURRENT_PASSWORD_WRONG', 'Your current password is incorrect.');
    }
    if (currentPassword === newPassword) throw Errors.badRequest('PASSWORD_UNCHANGED', 'Choose a password different from the current one.');
    await this.db.updateTable('users')
      .set({ password_hash: await hashPassword(newPassword), must_change_password: 0, password_changed_at: new Date() })
      .where('id', '=', user.id).execute();
    await this.revokeAll(user.id, user.sessionId);
    await this.audit.log(user, { module: 'auth', action: 'password_changed', entityType: 'user', entityId: user.id, ...meta });
  }

  /** Always succeeds from the caller's view, so the endpoint does not reveal which emails exist. */
  async forgotPassword(email: string) {
    const user = await this.db.selectFrom('users').select(['id', 'name', 'status'])
      .where('email', '=', email.trim().toLowerCase()).executeTakeFirst();
    if (!user || user.status !== 'active') return;
    const token = newToken();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('password_reset_tokens')
        .values({ user_id: user.id, token_hash: sha256(token), expires_at: new Date(Date.now() + config.passwordResetTtlMin * 60_000) })
        .execute();
      const inst = await trx.selectFrom('institution_settings').select('name').where('id', '=', 1).executeTakeFirst();
      await this.mail.queueTemplate(email, 'password_reset', {
        name: user.name, institution_name: inst?.name ?? '', reset_url: `${config.appUrl}/app/reset-password?token=${token}`,
        expires_minutes: String(config.passwordResetTtlMin),
      }, trx);
    });
  }

  async resetPassword(token: string, newPassword: string, meta: Meta) {
    const row = await this.db.selectFrom('password_reset_tokens').selectAll()
      .where('token_hash', '=', sha256(token)).executeTakeFirst();
    if (!row || row.used_at || row.expires_at < new Date()) {
      throw Errors.badRequest('RESET_LINK_INVALID', 'This reset link is invalid or has expired. Request a new one.');
    }
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('password_reset_tokens').set({ used_at: new Date() }).where('id', '=', row.id).execute();
      await trx.updateTable('users')
        .set({ password_hash: await hashPassword(newPassword), must_change_password: 0, password_changed_at: new Date(), failed_login_count: 0, locked_until: null })
        .where('id', '=', row.user_id).execute();
    });
    await this.revokeAll(row.user_id);
    await this.audit.log(null, { module: 'auth', action: 'password_reset', entityType: 'user', entityId: row.user_id, ...meta });
  }

  /** Builds the request user for a verified access token. */
  async resolveRequestUser(userId: number, sessionId: number, requested?: string): Promise<RequestUser> {
    const [user, session] = await Promise.all([
      this.db.selectFrom('users').select(['id', 'public_id', 'name', 'status', 'is_super_admin', 'must_change_password'])
        .where('id', '=', userId).executeTakeFirst(),
      this.db.selectFrom('sessions').select(['id', 'revoked_at', 'expires_at']).where('id', '=', sessionId).where('user_id', '=', userId).executeTakeFirst(),
    ]);
    if (!user || !session || session.revoked_at || session.expires_at < new Date()) throw Errors.unauthenticated();
    if (user.status !== 'active') throw Errors.accountDisabled();
    const isSuperAdmin = user.is_super_admin === 1;
    const workspaces = await this.perms.availableWorkspaces(user.id, isSuperAdmin);
    let workspace: Workspace;
    if (requested) {
      if (!workspaces.includes(requested as Workspace)) throw Errors.workspaceUnavailable();
      workspace = requested as Workspace;
    } else {
      if (!workspaces.length) throw Errors.accountDisabled();
      workspace = workspaces[0];
    }
    return {
      id: user.id, publicId: user.public_id, name: user.name, isSuperAdmin, sessionId,
      mustChangePassword: user.must_change_password === 1, workspace, workspaces,
      permissions: await this.perms.permissionsFor(user.id, isSuperAdmin, workspace),
    };
  }
}
