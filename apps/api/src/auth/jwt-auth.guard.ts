import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Errors } from '../common/app-error';
import { ALLOW_PENDING_PASSWORD, IS_PUBLIC, type AppRequest } from '../common/request-user';
import { AuthService } from './auth.service';

/** Global guard: every endpoint requires a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw Errors.unauthenticated();

    let payload: { sub: number; sid: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw Errors.unauthenticated();
    }
    const requested = (req.headers['x-workspace'] as string | undefined)?.trim() || undefined;
    req.user = await this.auth.resolveRequestUser(payload.sub, payload.sid, requested);

    if (req.user.mustChangePassword && !req.user.actingUserId && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, targets)) {
      throw Errors.passwordChangeRequired();
    }
    return true;
  }
}
