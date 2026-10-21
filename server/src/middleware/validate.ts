import { isValidObjectId } from 'mongoose';
import type { z } from 'zod';
import { AppError } from './errors.js';

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    throw new AppError(400, 'INVALID_REQUEST', first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request', r.error.issues);
  }
  return r.data;
}

export function assertObjectId(id: unknown, what = 'id'): string {
  if (typeof id !== 'string' || !isValidObjectId(id) || !/^[a-f0-9]{24}$/i.test(id)) {
    throw new AppError(400, 'INVALID_ID', `Invalid ${what}.`);
  }
  return id;
}
