import type { ErrorRequestHandler, RequestHandler } from 'express';
import { logger } from '../logger.js';

/** Error with an HTTP status and a stable machine-readable code the client maps to friendly text. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status: number = typeof err?.status === 'number' ? err.status : 500;
  const code: string = typeof err?.code === 'string' ? err.code : 'INTERNAL_ERROR';
  if (status >= 500) logger.error({ err }, 'Request failed');
  res.status(status).json({
    error: {
      code,
      message: status >= 500 && code === 'INTERNAL_ERROR' ? 'Something went wrong on our side.' : err.message,
      ...(err?.details ? { details: err.details } : {}),
    },
  });
};
