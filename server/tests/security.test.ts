import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from 'express-rate-limit';
import { createApp } from '../src/app.js';
import { errorHandler } from '../src/middleware/errors.js';
import { limiter, MongoRateLimitStore, type RateCollection } from '../src/middleware/rateLimit.js';
import { randomObjectId } from '../src/models/ids.js';
import { Job } from '../src/models/Job.js';
import { FileModel } from '../src/models/File.js';
import { normalizeGalleryDlJson } from '../src/services/gallerydl.js';
import { mapExtractorError } from '../src/services/ytdlp.js';

/** In-memory stand-in for the MongoDB collection, with the same upsert semantics. */
function fakeCollection() {
  const docs = new Map<string, { _id: string; hits: number; expireAt: Date }>();
  const col: RateCollection = {
    async findOneAndUpdate(filter, update) {
      const d = docs.get(filter._id) ?? { _id: filter._id, hits: 0, expireAt: update.$setOnInsert.expireAt };
      d.hits += update.$inc.hits;
      docs.set(d._id, d);
      return { ...d };
    },
    async findOne(filter) {
      return docs.get(filter._id) ?? null;
    },
    async updateOne(filter, update) {
      const d = docs.get(filter._id);
      if (d) d.hits += update.$inc.hits;
    },
    async deleteMany(filter) {
      const re = new RegExp(filter._id.$regex);
      for (const k of [...docs.keys()]) if (re.test(k)) docs.delete(k);
    },
  };
  return { col, docs };
}

describe('MongoRateLimitStore', () => {
  it('counts hits per key within a fixed window and resets', async () => {
    const { col, docs } = fakeCollection();
    const store = new MongoRateLimitStore('t', () => col);
    store.init({ windowMs: 60_000 } as never);
    expect((await store.increment('1.2.3.4')).totalHits).toBe(1);
    const second = await store.increment('1.2.3.4');
    expect(second.totalHits).toBe(2);
    expect(second.resetTime!.getTime() % 60_000).toBe(0);
    expect((await store.increment('5.6.7.8')).totalHits).toBe(1);
    await store.decrement('1.2.3.4');
    expect((await store.get('1.2.3.4'))?.totalHits).toBe(1);
    await store.resetKey('1.2.3.4');
    expect(await store.get('1.2.3.4')).toBeUndefined();
    expect([...docs.keys()].every((k) => k.startsWith('t:'))).toBe(true);
    // Each doc carries its expiry for the TTL index.
    expect([...docs.values()][0]!.expireAt).toBeInstanceOf(Date);
  });

  it('retries once when concurrent first hits race on the upsert', async () => {
    const { col } = fakeCollection();
    let calls = 0;
    const racy: RateCollection = {
      ...col,
      findOneAndUpdate: async (...args) => {
        if (calls++ === 0) throw Object.assign(new Error('dup'), { code: 11000 });
        return col.findOneAndUpdate(...args);
      },
    };
    const store = new MongoRateLimitStore('t', () => racy);
    expect((await store.increment('k')).totalHits).toBe(1);
  });

  it('escapes regex characters in keys when resetting', async () => {
    const { col, docs } = fakeCollection();
    const store = new MongoRateLimitStore('t', () => col);
    await store.increment('::ffff:1.2.3.4');
    await store.increment('::ffff:1x2x3x4');
    await store.resetKey('::ffff:1.2.3.4');
    expect([...docs.keys()].some((k) => k.includes('1x2x3x4'))).toBe(true);
  });
});

describe('limiter', () => {
  it('returns 429 RATE_LIMITED with Retry-After and standard headers', async () => {
    const app = express();
    app.use(limiter({ name: 't', windowMs: 60_000, limit: 2, message: 'Slow down', store: new MemoryStore() }));
    app.get('/', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    const agent = request(app);
    expect((await agent.get('/')).status).toBe(200);
    expect((await agent.get('/')).status).toBe(200);
    const res = await agent.get('/');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBe('60');
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  it('lets requests through when the store is down', async () => {
    const app = express();
    const broken = new MongoRateLimitStore('t', () => {
      throw new Error('db down');
    });
    app.use(limiter({ name: 't', windowMs: 60_000, limit: 1, message: 'x', store: broken }));
    app.get('/', (_req, res) => res.json({ ok: true }));
    for (let i = 0; i < 3; i++) expect((await request(app).get('/')).status).toBe(200);
  });
});

describe('hardening', () => {
  it('job and file ids are random, not sequential ObjectIds', () => {
    const a = new Job({ type: 'download' })._id.toHexString();
    const b = new Job({ type: 'download' })._id.toHexString();
    const f = new FileModel({ path: 'x', name: 'x', size: 1, mimeType: 'x' })._id.toHexString();
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    // Sequential ObjectIds share the 4-byte timestamp and 5-byte process prefix.
    expect(a.slice(0, 18)).not.toBe(b.slice(0, 18));
    expect(f).not.toBe(a);
    expect(new Set(Array.from({ length: 1000 }, () => randomObjectId().toHexString())).size).toBe(1000);
  });

  it('sets a locked-down CSP and no framework fingerprint', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('health exposes availability only, not tool versions', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.body.binaries['yt-dlp']).toEqual({ available: expect.any(Boolean) });
  });

  it('rejects oversized JSON bodies', async () => {
    const res = await request(createApp())
      .post('/api/fetch')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ url: 'x'.repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('BODY_TOO_LARGE');
  });

  it('rejects malformed JSON with INVALID_JSON', async () => {
    const res = await request(createApp()).post('/api/fetch').set('content-type', 'application/json').send('{"url":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('gallery-dl results never include direct-link or generic extractor files', () => {
    const meta = normalizeGalleryDlJson([
      [3, 'https://i.redd.it/a.jpg', { category: 'reddit', extension: 'jpg' }],
      [3, 'http://169.254.169.254/latest/x.jpg', { category: 'directlink', extension: 'jpg' }],
    ]);
    expect(meta.items).toHaveLength(1);
  });

  it('maps yt-dlp "no suitable extractor" (generic disabled) to UNSUPPORTED_URL', () => {
    expect(mapExtractorError('ERROR: No suitable extractor found for URL https://example.com/x').code).toBe('UNSUPPORTED_URL');
  });
});
