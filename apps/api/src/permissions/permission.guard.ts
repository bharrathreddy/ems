import { CanActivate, ExecutionContext, Injectable, SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Errors } from '../common/app-error';
import type { AppRequest } from '../common/request-user';
import { PermissionsService } from './permissions.service';

const PERMISSION_KEY = 'requiredPermission';
const DEVELOPER_KEY = 'developerOnly';

/** Require module.action in the active workspace. Also enforces the module's feature flag. */
export const RequirePermission = (module: string, action: string) =>
  applyDecorators(SetMetadata(PERMISSION_KEY, { module, action }), UseGuards(PermissionGuard));

/** Super Admin (developer) only. */
export const DeveloperOnly = () => applyDecorators(SetMetadata(DEVELOPER_KEY, true), UseGuards(PermissionGuard));

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly perms: PermissionsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const user = req.user;
    if (!user) throw Errors.unauthenticated();

    const developerOnly = this.reflector.getAllAndOverride<boolean>(DEVELOPER_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (developerOnly) {
      if (!user.isSuperAdmin || user.workspace !== 'staff') throw Errors.forbidden();
      return true;
    }

    const required = this.reflector.getAllAndOverride<{ module: string; action: string }>(PERMISSION_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true;
    if (!(await this.perms.isModuleEnabled(required.module))) throw Errors.featureDisabled(required.module);
    if (!user.permissions.has(`${required.module}.${required.action}`)) throw Errors.forbidden();
    return true;
  }
}
