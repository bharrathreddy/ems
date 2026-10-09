import type { RequestUser } from './request-user';
import { Errors } from './app-error';

/** Year-end work, closed-year receipts and waivers are for the Institution Admin or the developer only. */
export const isInstitutionAdmin = (u: RequestUser) => u.workspace === 'staff' && (u.isSuperAdmin || u.permissions.get('roles.configure') === 'all');
export function requireInstitutionAdmin(u: RequestUser) {
  if (!isInstitutionAdmin(u)) throw Errors.forbidden();
}
