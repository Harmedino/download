/**
 * End-to-end wiring of upload -> tool job -> processor -> history with MongoDB replaced by
 * in-memory fakes (no database in CI), but real multer, ffprobe and ffmpeg.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeClip } from './helpers/media.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const db = vi.hoisted(() => ({ jobs: new Map<string, Doc>(), files: new Map<string, Doc>(), enqueued: [] as Array<[string, string]> }));

vi.mock('../src/db/mongoose.js', () => ({ mongoState: () => 'connected', connectMongo: vi.fn(), disconnectMongo: vi.fn() }));
vi.mock('../src/jobs/agenda.js', () => ({
  enqueue: vi.fn(async (name: string, id: unknown) => void db.enqueued.push([name, String(id)])),
  queueFor: (t: string) => (['download', 'remove-bg-image'].includes(t) ? t : 'media'),
}));
// Rate limits use MongoDB too; let everything through.
vi.mock('../src/middleware/rateLimit.js', async (orig) => {
  const real = await orig<typeof import('../src/middleware/rateLimit.js')>();
  const pass = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return { ...real, limits: Object.fromEntries(Object.keys(real.limits).map((k) => [k, pass])) };
});

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, v]) => {
    const val = k === '_id' ? String(doc._id) : doc[k];
    if (v && typeof v === 'object' && '$in' in v) return (v.$in as unknown[]).map(String).includes(String(val));
    if (v && typeof v === 'object' && '$ne' in v) return val !== v.$ne;
    return String(val) === String(v);
  });
}

function fakeModel(store: Map<string, Doc>, Real: { new (d: Doc): { toObject(): Doc; _id: unknown } }) {
  const lean = <T>(v: T) => ({ lean: async () => v, then: (r: (x: T) => unknown) => Promise.resolve(v).then(r) });
  const wrap = (d: Doc | undefined) => (d ? Object.assign({ ...d }, { toObject: () => ({ ...d }) }) : null);
  return {
    create: async (d: Doc) => {
      const doc = new Real(d).toObject();
      store.set(String(doc._id), doc);
      return wrap(doc);
    },
    findById: (id: unknown) => lean(wrap(store.get(String(id)))),
    find: (filter: Doc = {}) => {
      const list = [...store.values()].filter((d) => matches(d, filter)).map((d) => wrap(d)!);
      const q = { sort: () => q, limit: () => q, lean: async () => list, then: (r: (x: Doc[]) => unknown) => Promise.resolve(list).then(r) };
      return q;
    },
    countDocuments: async () => 0,
    updateOne: async (filter: Doc, update: Doc) => {
      const d = [...store.values()].find((x) => matches(x, filter));
      if (d) Object.assign(d, update.$set ?? {});
    },
    deleteOne: async (filter: Doc) => void store.delete(String(filter._id)),
    deleteMany: async () => undefined,
  };
}

vi.mock('../src/models/Job.js', async (orig) => {
  const real = await orig<typeof import('../src/models/Job.js')>();
  const Job = fakeModel(db.jobs, real.Job as never);
  return { ...real, Job, updateJob: async (id: unknown, patch: Doc) => Job.updateOne({ _id: id }, { $set: patch }) };
});
vi.mock('../src/models/File.js', async (orig) => {
  const real = await orig<typeof import('../src/models/File.js')>();
  return { ...real, FileModel: fakeModel(db.files, real.FileModel as never) };
});

const { createApp } = await import('../src/app.js');
const { checkBinaries } = await import('../src/services/binaries.js');
const { processMedia } = await import('../src/jobs/processors/media.js');
const { ensureStorageDirs } = await import('../src/services/storage.js');

const CLIENT = 'test-client-id-0123456789';
const OTHER = 'someone-else-0123456789ab';

async function runQueued(): Promise<void> {
  while (db.enqueued.length) {
    const [, jobId] = db.enqueued.shift()!;
    await processMedia({ attrs: { data: { jobId } }, touch: async () => undefined } as never);
  }
}

describe('upload -> convert -> history', () => {
  let clip: string;
  beforeAll(async () => {
    await checkBinaries();
    await ensureStorageDirs();
    clip = makeClip('pipeline.mp4', { width: 640, height: 360, seconds: 2 });
  });
  beforeEach(() => {
    db.jobs.clear();
    db.files.clear();
    db.enqueued.length = 0;
  });

  it('uploads, validates, converts, lists in history, and deletes', async () => {
    const app = createApp();
    const up = await request(app).post('/api/media/upload').set('X-Client-Id', CLIENT).attach('file', clip, 'My clip.mp4');
    expect(up.status).toBe(201);
    expect(up.body.info).toMatchObject({ kind: 'video', width: 640, height: 360, hasAudio: true });

    // Another browser can't use or see the file.
    const stolen = await request(app).post('/api/tools/convert').set('X-Client-Id', OTHER).send({ fileId: up.body.id, format: 'webm' });
    expect(stolen.status).toBe(404);
    expect(stolen.body.error.code).toBe('FILE_EXPIRED');

    const start = await request(app).post('/api/tools/convert').set('X-Client-Id', CLIENT).send({ fileId: up.body.id, format: 'webm', resolution: 360 });
    expect(start.status).toBe(202);
    await runQueued();

    const job = await request(app).get(`/api/jobs/${start.body.jobId}`);
    expect(job.body).toMatchObject({ status: 'done', progress: 100, type: 'convert', sourceType: 'upload', summary: { format: 'WEBM', resolution: '640x360' } });
    expect(job.body.files[0]).toMatchObject({ name: 'My clip.webm', mimeType: 'video/webm' });

    const file = await request(app).get(job.body.files[0].url).buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toContain('attachment');

    const hist = await request(app).get('/api/history').set('X-Client-Id', CLIENT);
    expect(hist.body.jobs.map((j: Doc) => j.id)).toContain(start.body.jobId);
    expect((await request(app).get('/api/history').set('X-Client-Id', OTHER)).body.jobs).toEqual([]);

    expect((await request(app).delete(`/api/jobs/${start.body.jobId}`).set('X-Client-Id', OTHER)).status).toBe(404);
    expect((await request(app).delete(`/api/jobs/${start.body.jobId}`).set('X-Client-Id', CLIENT)).status).toBe(204);
    const outPath = [...db.files.values()].find((f) => String(f.jobId) === start.body.jobId)?.path;
    expect(outPath).toBeUndefined();
  });

  it('rejects uploads that are not media, and removes them from disk', async () => {
    const app = createApp();
    const bad = path.resolve('tmp/test/fixtures/fake.mp4');
    await fsp.writeFile(bad, 'definitely not a video');
    const before = fs.readdirSync(path.resolve('tmp/test/uploads')).length;
    const res = await request(app).post('/api/media/upload').set('X-Client-Id', CLIENT).attach('file', bad, 'fake.mp4');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('INVALID_VIDEO');
    expect(fs.readdirSync(path.resolve('tmp/test/uploads')).length).toBe(before);
  });

  it('marks a failed job retryable, and retries it once the input exists', async () => {
    const app = createApp();
    const up = await request(app).post('/api/media/upload').set('X-Client-Id', CLIENT).attach('file', clip, 'clip.mp4');
    // Damage the stored upload so ffmpeg fails inside the processor, then repair it and retry.
    const stored = db.files.get(up.body.id)!.path as string;
    const good = await fsp.readFile(stored);
    const start = await request(app).post('/api/tools/compress').set('X-Client-Id', CLIENT).send({ fileId: up.body.id, level: 'small' });
    await fsp.writeFile(stored, good.subarray(0, 2000));
    await runQueued();
    const failed = await request(app).get(`/api/jobs/${start.body.jobId}`);
    expect(failed.body).toMatchObject({ status: 'failed', retryable: true, error: { code: 'PROCESSING_FAILED' } });

    await fsp.writeFile(stored, good);
    const retry = await request(app).post(`/api/jobs/${start.body.jobId}/retry`).set('X-Client-Id', CLIENT);
    expect(retry.status).toBe(202);
    await runQueued();
    expect((await request(app).get(`/api/jobs/${start.body.jobId}`)).body.status).toBe('done');
  });

  it('refuses a retry once the original upload is gone', async () => {
    const app = createApp();
    const up = await request(app).post('/api/media/upload').set('X-Client-Id', CLIENT).attach('file', clip, 'clip.mp4');
    const start = await request(app).post('/api/tools/convert').set('X-Client-Id', CLIENT).send({ fileId: up.body.id, format: 'mp3' });
    await fsp.rm(db.files.get(up.body.id)!.path);
    await runQueued();
    expect((await request(app).get(`/api/jobs/${start.body.jobId}`)).body.error.code).toBe('FILE_EXPIRED');
    const retry = await request(app).post(`/api/jobs/${start.body.jobId}/retry`).set('X-Client-Id', CLIENT);
    expect(retry.status).toBe(410);
  });

  it('validates tool parameters before queueing', async () => {
    const app = createApp();
    const up = await request(app).post('/api/media/upload').set('X-Client-Id', CLIENT).attach('file', clip, 'clip.mp4');
    const res = await request(app).post('/api/tools/convert').set('X-Client-Id', CLIENT).send({ fileId: up.body.id, format: 'exe' });
    expect(res.status).toBe(400);
    expect((await request(app).post('/api/tools/nope').send({})).status).toBe(404);
    expect(db.enqueued).toHaveLength(0);
  });
});
