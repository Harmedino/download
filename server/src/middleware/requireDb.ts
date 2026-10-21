import type { RequestHandler } from 'express';
import { mongoState } from '../db/mongoose.js';
import { AppError } from './errors.js';

/** Fails fast with a clear 503 instead of hanging when MongoDB is unreachable. */
export const requireDb: RequestHandler = (_req, _res, next) => {
  if (mongoState() !== 'connected') {
    return next(new AppError(503, 'DB_UNAVAILABLE', 'The service is temporarily unavailable. Please try again in a moment.'));
  }
  next();
};
