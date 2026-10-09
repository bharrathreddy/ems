import { PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';
import { Errors } from './app-error';

export class ZodPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, any>) {}
  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw Errors.validation(
        parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      );
    }
    return parsed.data;
  }
}
