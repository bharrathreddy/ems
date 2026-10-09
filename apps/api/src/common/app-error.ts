import { HttpException, HttpStatus } from '@nestjs/common';

/** Every error the API returns has a stable machine-readable code. */
export class AppError extends HttpException {
  constructor(status: HttpStatus, public readonly code: string, message: string, public readonly details?: unknown) {
    super({ code, message, details }, status);
  }
}

export const Errors = {
  unauthenticated: () => new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Log in to continue.'),
  invalidCredentials: () =>
    new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'The email/mobile or password is incorrect.'),
  accountLocked: (until: Date) =>
    new AppError(HttpStatus.LOCKED, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', { lockedUntil: until }),
  accountDisabled: () =>
    new AppError(HttpStatus.FORBIDDEN, 'ACCOUNT_DISABLED', 'This account is disabled. Contact the school office.'),
  passwordChangeRequired: () =>
    new AppError(HttpStatus.FORBIDDEN, 'PASSWORD_CHANGE_REQUIRED', 'Set a new password before continuing.'),
  forbidden: () => new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You do not have permission to perform this action.'),
  featureDisabled: (module: string) =>
    new AppError(HttpStatus.FORBIDDEN, 'FEATURE_DISABLED', `The ${module} module is not enabled.`),
  workspaceUnavailable: () =>
    new AppError(HttpStatus.FORBIDDEN, 'WORKSPACE_UNAVAILABLE', 'This workspace is not available for your account.'),
  notFound: (what = 'Record') => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found.`),
  conflict: (message: string, details?: unknown) => new AppError(HttpStatus.CONFLICT, 'CONFLICT', message, details),
  validation: (details: unknown) =>
    new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', 'Some fields need attention.', details),
  badRequest: (code: string, message: string) => new AppError(HttpStatus.BAD_REQUEST, code, message),
};
