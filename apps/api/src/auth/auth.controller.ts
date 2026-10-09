import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { KYSELY, type Database } from '../database/database.module';
import { Errors } from '../common/app-error';
import { ZodPipe } from '../common/zod.pipe';
import { AllowPendingPassword, clientMeta, CurrentUser, Public, type AppRequest, type RequestUser } from '../common/request-user';
import { PermissionsService } from '../permissions/permissions.service';
import { AuthService } from './auth.service';
import { DeveloperOnly } from '../permissions/permission.guard';
import { passwordPolicy } from './passwords';

const REFRESH_COOKIE = 'ems_rt';
/** While the developer uses "Login as", that session's refresh token lives in its own cookie, so the developer's own login is untouched. */
const PROXY_COOKIE = 'ems_proxy_rt';
const COOKIE_PATH = '/api/v1/auth';

const LoginBody = z.object({ identifier: z.string().trim().min(3).max(190), password: z.string().min(1).max(128) });
const VerifyBody = z.object({ challengeId: z.string().regex(/^[a-f0-9]{32}$/), code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.') });
const RefreshBody = z.object({ refreshToken: z.string().optional() }).default({});
const ChangePasswordBody = z.object({ currentPassword: z.string().min(1), newPassword: passwordPolicy });
const ForgotBody = z.object({ email: z.string().trim().email() });
const ResetBody = z.object({ token: z.string().min(10), newPassword: passwordPolicy });

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly perms: PermissionsService,
    @Inject(KYSELY) private readonly db: Database,
  ) {}

  /** Web: refresh token goes in an httpOnly cookie. Mobile apps send `X-Client: mobile` and get it in the body. */
  private deliverTokens(req: AppRequest, res: Response, t: { accessToken: string; refreshToken: string; refreshExpiresAt: Date; expiresIn: number }, cookie = REFRESH_COOKIE) {
    const isMobile = req.headers['x-client'] === 'mobile';
    if (!isMobile) {
      res.cookie(cookie, t.refreshToken, {
        httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: COOKIE_PATH, expires: t.refreshExpiresAt,
      });
    }
    return { accessToken: t.accessToken, expiresIn: t.expiresIn, ...(isMobile ? { refreshToken: t.refreshToken } : {}) };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(LoginBody)) body: z.infer<typeof LoginBody>, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(body.identifier, body.password, clientMeta(req));
    if ('twoStep' in r) return r; // a code was emailed; the app asks for it next
    return { ...this.deliverTokens(req, res, r), mustChangePassword: r.mustChangePassword, workspaces: r.workspaces };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login/verify')
  @HttpCode(200)
  async verify(@Body(new ZodPipe(VerifyBody)) body: z.infer<typeof VerifyBody>, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.verifyLoginCode(body.challengeId, body.code, clientMeta(req));
    return { ...this.deliverTokens(req, res, r), mustChangePassword: r.mustChangePassword, workspaces: r.workspaces };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body(new ZodPipe(RefreshBody)) body: z.infer<typeof RefreshBody>, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const proxy = req.headers['x-proxy'] === '1';
    const token = body.refreshToken ?? req.cookies?.[proxy ? PROXY_COOKIE : REFRESH_COOKIE];
    if (!token) throw Errors.unauthenticated();
    const t = await this.auth.refresh(token, clientMeta(req));
    if (proxy !== t.proxy && !body.refreshToken) throw Errors.unauthenticated(); // each cookie only refreshes its own kind of session
    return this.deliverTokens(req, res, t, t.proxy ? PROXY_COOKIE : REFRESH_COOKIE);
  }

  /** Developer only: open the app as another person (staff, parent, student, driver). */
  @ApiBearerAuth()
  @DeveloperOnly()
  @Post('proxy')
  @HttpCode(200)
  async proxy(@CurrentUser() u: RequestUser, @Body(new ZodPipe(z.object({ userId: z.string().min(10).max(40) }))) b: { userId: string }, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.startProxy(u, b.userId, clientMeta(req));
    return { ...this.deliverTokens(req, res, t, PROXY_COOKIE), name: t.name, workspaces: t.workspaces };
  }

  /** Back to the developer's own login. */
  @ApiBearerAuth()
  @AllowPendingPassword()
  @Post('proxy/end')
  @HttpCode(200)
  async endProxy(@CurrentUser() u: RequestUser, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.endProxy(u, clientMeta(req));
    res.clearCookie(PROXY_COOKIE, { path: COOKIE_PATH });
    return { ended: true };
  }

  @ApiBearerAuth()
  @AllowPendingPassword()
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: RequestUser, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user.sessionId, user, clientMeta(req));
    res.clearCookie(user.actingUserId ? PROXY_COOKIE : REFRESH_COOKIE, { path: COOKIE_PATH });
    return { loggedOut: true };
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@CurrentUser() user: RequestUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.revokeAll(user.id);
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
    return { loggedOut: true };
  }

  @ApiBearerAuth()
  @AllowPendingPassword()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentUser() user: RequestUser, @Body(new ZodPipe(ChangePasswordBody)) body: z.infer<typeof ChangePasswordBody>, @Req() req: AppRequest) {
    await this.auth.changePassword(user, body.currentPassword, body.newPassword, clientMeta(req));
    return { changed: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(200)
  async forgot(@Body(new ZodPipe(ForgotBody)) body: z.infer<typeof ForgotBody>) {
    await this.auth.forgotPassword(body.email);
    return { message: 'If an account uses this email, a reset link has been sent.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(200)
  async reset(@Body(new ZodPipe(ResetBody)) body: z.infer<typeof ResetBody>, @Req() req: AppRequest) {
    await this.auth.resetPassword(body.token, body.newPassword, clientMeta(req));
    return { reset: true };
  }

  /** Everything the app needs after login: who, which workspace, what they may do, which modules are on. */
  @ApiBearerAuth()
  @AllowPendingPassword()
  @Get('me')
  async me(@CurrentUser() user: RequestUser) {
    const [profile, flags] = await Promise.all([
      this.db.selectFrom('users').select(['public_id', 'name', 'email', 'mobile']).where('id', '=', user.id).executeTakeFirstOrThrow(),
      this.perms.featureFlags(),
    ]);
    return {
      user: { id: profile.public_id, name: profile.name, email: profile.email, mobile: profile.mobile, isSuperAdmin: user.isSuperAdmin },
      mustChangePassword: user.mustChangePassword,
      workspace: user.workspace,
      workspaces: user.workspaces,
      permissions: Object.fromEntries(user.permissions),
      features: Object.fromEntries(flags),
      proxy: user.actingUserId ? { by: user.actingName } : null,
    };
  }
}
