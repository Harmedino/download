import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../logger.js';
import { Job } from '../models/Job.js';
import { parseBody } from '../middleware/validate.js';
import { getMetadata } from '../services/media.js';
import { resolveSource } from '../services/sources.js';

export const fetchRouter = Router();

const bodySchema = z.object({ url: z.string().max(4096) });

fetchRouter.post('/', async (req, res) => {
  const { url: input } = parseBody(bodySchema, req.body);
  const { url, platform } = resolveSource(input);
  const record = (status: 'done' | 'failed', error?: { code: string; message: string }) =>
    Job.create({ type: 'fetch', status, progress: 100, sourceUrl: url, platform, ownerHash: req.ownerHash ?? null, error: error ?? null }).catch((err) =>
      logger.warn({ err }, 'Failed to record fetch job'),
    );

  try {
    const { metadata, cached } = await getMetadata(url, platform);
    void record('done');
    res.json({ platform, sourceUrl: url, cached, metadata });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    void record('failed', { code: e.code ?? 'FETCH_FAILED', message: e.message ?? 'Fetch failed' });
    throw err;
  }
});
