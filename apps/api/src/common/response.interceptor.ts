import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs';

/** Wraps every successful response as { success: true, data, meta? }. */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      map((result) => {
        if (result && typeof result === 'object' && 'data' in result && 'meta' in result) {
          return { success: true, data: result.data, meta: result.meta };
        }
        return { success: true, data: result ?? null };
      }),
    );
  }
}
