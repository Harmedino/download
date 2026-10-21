import type { RequestHandler } from 'express';
import { rateLimit, type ClientRateLimitInfo, type Options, type Store } from 'express-rate-limit';
import mongoose from 'mongoose';
import { logger } from '../logger.js';
import { AppError } from './errors.js';

interface RateDoc {
  _id: string;
  hits: number;
  expireAt: Date;
}

/** The subset of a MongoDB collection the store needs (lets tests pass an in-memory fake). */
export interface RateCollection {
  findOneAndUpdate(
    filter: { _id: string },
    update: { $inc: { hits: number }; $setOnInsert: { expireAt: Date } },
    options: { upsert: true; returnDocument: 'after' },
  ): Promise<RateDoc | null>;
  findOne(filter: { _id: string }): Promise<RateDoc | null>;
  updateOne(filter: { _id: string }, update: { $inc: { hits: number } }): Promise<unknown>;
  deleteMany(filter: { _id: { $regex: string } }): Promise<unknown>;
}

export const RATE_LIMIT_COLLECTION = 'rateLimits';

const defaultCollection = (): RateCollection => {
  // Throwing (instead of letting the driver wait for a connection) makes passOnStoreError kick in immediately.
  if (mongoose.connection.readyState !== 1) throw new Error('MongoDB not connected');
  return mongoose.connection.collection<RateDoc>(RATE_LIMIT_COLLECTION) as unknown as RateCollection;
};

/**
 * Fixed-window express-rate-limit store on MongoDB. One document per client per window,
 * incremented atomically with an upsert; a TTL index on `expireAt` removes old windows.
 * Shared by every API instance, so limits hold across restarts and replicas.
 */
export class MongoRateLimitStore implements Store {
  windowMs = 60_000;
  readonly localKeys = false;

  constructor(
    readonly prefix: string,
    private readonly collection: () => RateCollection = defaultCollection,
  ) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private window(key: string, now = Date.now()) {
    const start = Math.floor(now / this.windowMs) * this.windowMs;
    return { id: `${this.prefix}:${key}:${start}`, resetTime: new Date(start + this.windowMs) };
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const { id, resetTime } = this.window(key);
    const doc = await this.collection().findOne({ _id: id });
    return doc ? { totalHits: doc.hits, resetTime } : undefined;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const { id, resetTime } = this.window(key);
    const upsert = () =>
      this.collection().findOneAndUpdate(
        { _id: id },
        { $inc: { hits: 1 }, $setOnInsert: { expireAt: resetTime } },
        { upsert: true, returnDocument: 'after' },
      );
    let doc: RateDoc | null;
    try {
      doc = await upsert();
    } catch (err) {
      // Two concurrent first hits can race on the upsert; the loser retries as a plain increment.
      if ((err as { code?: number }).code !== 11000) throw err;
      doc = await upsert();
    }
    return { totalHits: doc?.hits ?? 1, resetTime };
  }

  async decrement(key: string): Promise<void> {
    await this.collection().updateOne({ _id: this.window(key).id }, { $inc: { hits: -1 } });
  }

  async resetKey(key: string): Promise<void> {
    const escaped = `${this.prefix}:${key}:`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await this.collection().deleteMany({ _id: { $regex: `^${escaped}` } });
  }
}

/** Creates the TTL index that expires old rate-limit windows. */
export async function ensureRateLimitIndexes(): Promise<void> {
  await mongoose.connection.collection(RATE_LIMIT_COLLECTION).createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
}

interface LimitOptions {
  name: string;
  windowMs: number;
  limit: number;
  message: string;
  /** Inject a different store (tests). Defaults to MongoDB. */
  store?: Store;
  skip?: Options['skip'];
}

export function limiter(o: LimitOptions): RequestHandler {
  return rateLimit({
    windowMs: o.windowMs,
    limit: o.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store: o.store ?? new MongoRateLimitStore(o.name),
    skip: o.skip,
    // If MongoDB hiccups, let requests through rather than locking everyone out.
    passOnStoreError: true,
    handler: (req, _res, next, options) => {
      logger.warn({ ip: req.ip, limiter: o.name }, 'Rate limit hit');
      const retryAfter = Math.ceil(options.windowMs / 1000);
      next(new AppError(429, 'RATE_LIMITED', o.message, { retryAfterSeconds: retryAfter }));
    },
  });
}

const MIN = 60_000;

/** Per-route limits. Tuned for people, not scripts: generous for polling, tight for CPU-heavy work. */
export const limits = {
  /** Catch-all for /api. Job polling and file streaming have their own limits (a long job polls ~1/s). */
  api: () =>
    limiter({
      name: 'api',
      windowMs: 15 * MIN,
      limit: 600,
      message: 'Too many requests. Please slow down and try again in a few minutes.',
      skip: (req) => /^\/(jobs|files|health|history)(\/|$)/.test(req.path),
    }),
  fetch: () => limiter({ name: 'fetch', windowMs: MIN, limit: 20, message: "You're fetching links very quickly. Please wait a minute and try again." }),
  download: () => limiter({ name: 'download', windowMs: 10 * MIN, limit: 40, message: "You've started a lot of downloads. Please wait a few minutes." }),
  removeBgImage: () => limiter({ name: 'rbg-image', windowMs: 10 * MIN, limit: 20, message: "You've removed a lot of backgrounds. Please wait a few minutes." }),
  mediaUpload: () => limiter({ name: 'media-upload', windowMs: 10 * MIN, limit: 30, message: "You've uploaded a lot of files. Please wait a few minutes." }),
  tools: () => limiter({ name: 'tools', windowMs: 10 * MIN, limit: 40, message: "You've started a lot of video jobs. Please wait a few minutes." }),
  /** Job polling runs about once a second per open job. */
  jobs: () => limiter({ name: 'jobs', windowMs: MIN, limit: 300, message: 'Too many status checks. Please slow down.' }),
  /** Video previews make several Range requests per file. */
  files: () => limiter({ name: 'files', windowMs: MIN, limit: 300, message: 'Too many file requests. Please slow down.' }),
};
