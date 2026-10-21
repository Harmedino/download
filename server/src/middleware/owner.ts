import crypto from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { AppError } from './errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** sha256 of the X-Client-Id header, or null when the browser sent none. */
    ownerHash?: string | null;
  }
}

const CLIENT_ID = /^[A-Za-z0-9_-]{16,128}$/;

export function hashClientId(id: string): string {
  return crypto.createHash('sha256').update(id).digest('hex');
}

/**
 * The client keeps a random id in localStorage and sends it as X-Client-Id. It is not a login:
 * it only scopes history, retries and deletes to the browser that created the job. We store a
 * hash so the raw id (which works like a bearer token) never sits in the database.
 */
export const identifyOwner: RequestHandler = (req, _res, next) => {
  const raw = req.get('x-client-id');
  req.ownerHash = raw && CLIENT_ID.test(raw) ? hashClientId(raw) : null;
  next();
};

export function requireOwner(req: Request): string {
  if (!req.ownerHash) throw new AppError(400, 'CLIENT_ID_REQUIRED', 'Your browser did not send its history id. Refresh the page and try again.');
  return req.ownerHash;
}

/** Records owned by someone else look exactly like records that don't exist. */
export function assertOwns(req: Request, ownerHash: string | null | undefined, notFound: () => AppError): void {
  if (ownerHash && ownerHash !== req.ownerHash) throw notFound();
}
