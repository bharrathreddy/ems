import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as any;
      const code =
        body?.code ??
        (status === 404 ? 'NOT_FOUND' : status === 429 ? 'RATE_LIMITED' : status === 401 ? 'UNAUTHENTICATED' : 'ERROR');
      const message =
        body?.code ? body.message : status === 429 ? 'Too many requests. Wait a moment and try again.' : exception.message;
      return res.status(status).json({ success: false, code, message, ...(body?.details ? { details: body.details } : {}) });
    }

    // MySQL duplicate key -> 409 with a readable message
    const err = exception as any;
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.status(HttpStatus.CONFLICT).json({
        success: false,
        code: 'CONFLICT',
        message: 'A record with the same unique value already exists.',
      });
    }

    this.logger.error(err?.message ?? err, err?.stack);
    if (process.env.DEBUG_ERRORS) console.error('UNHANDLED', err?.message, err?.sql ?? '');
    return res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ success: false, code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' });
  }
}
