import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export type Workspace = 'staff' | 'parent' | 'student';
export type Scope =
  | 'all' | 'class' | 'section' | 'subject' | 'assigned_students' | 'own_records' | 'own_children' | 'assigned_route';

export interface RequestUser {
  id: number;
  publicId: string;
  name: string;
  isSuperAdmin: boolean;
  sessionId: number;
  mustChangePassword: boolean;
  workspace: Workspace;
  workspaces: Workspace[];
  /** "module.action" -> scope, for the active workspace only */
  permissions: Map<string, Scope>;
}

export interface AppRequest extends Request {
  user?: RequestUser;
}

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AppRequest>().user as RequestUser;
});

export const IS_PUBLIC = 'isPublic';
/** Endpoint needs no login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ALLOW_PENDING_PASSWORD = 'allowPendingPassword';
/** Endpoint usable while a forced password change is pending. */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

export function clientMeta(req: Request) {
  return {
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null,
    userAgent: (req.headers['user-agent'] ?? '').slice(0, 255) || null,
  };
}
