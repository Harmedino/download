import { Router } from 'express';
import { z } from 'zod';
import { enqueue } from '../jobs/agenda.js';
import type { DownloadParams } from '../jobs/processors/download.js';
import { AppError } from '../middleware/errors.js';
import { assertQueueCapacity } from '../middleware/queueGuard.js';
import { parseBody } from '../middleware/validate.js';
import { Job } from '../models/Job.js';
import { getMetadata } from '../services/media.js';
import { validateMediaUrl } from '../services/platform.js';

export const downloadRouter = Router();

const downloadSchema = z.object({
  url: z.string().max(4096),
  formatId: z.enum(['360p', '720p', '1080p', 'best']).optional(),
  itemIndex: z.number().int().min(0).max(49).optional(),
  audioOnly: z.boolean().optional(),
});

downloadRouter.post('/', async (req, res) => {
  const body = parseBody(downloadSchema, req.body);
  const { url, platform } = validateMediaUrl(body.url);
  // Resolve metadata up front (usually from cache) so private/unsupported posts fail immediately.
  const { metadata } = await getMetadata(url, platform);

  if (body.itemIndex !== undefined && body.itemIndex >= metadata.items.length) {
    throw new AppError(400, 'INVALID_ITEM', 'That item does not exist in this post.');
  }
  const item = metadata.items[body.itemIndex ?? 0];
  if (body.audioOnly && (item?.type !== 'video' || metadata.extractor !== 'yt-dlp')) {
    throw new AppError(400, 'AUDIO_UNAVAILABLE', 'Audio-only download is only available for videos.');
  }
  if (body.formatId && body.formatId !== 'best' && !metadata.formats.some((f) => f.id === body.formatId)) {
    throw new AppError(400, 'FORMAT_UNAVAILABLE', `${body.formatId} is not available for this video.`);
  }

  const params: DownloadParams = { formatId: body.formatId, itemIndex: body.itemIndex, audioOnly: body.audioOnly };
  await assertQueueCapacity('download');
  const job = await Job.create({ type: 'download', sourceUrl: url, platform, params });
  await enqueue('download', job._id);
  res.status(202).json({ jobId: job._id });
});

downloadRouter.post('/zip', async (req, res) => {
  const body = parseBody(z.object({ url: z.string().max(4096) }), req.body);
  const { url, platform } = validateMediaUrl(body.url);
  const { metadata } = await getMetadata(url, platform);
  if (metadata.items.length < 2) {
    throw new AppError(400, 'NOT_A_CAROUSEL', 'This post has a single item, so there is nothing to zip. Use the normal download instead.');
  }
  const params: DownloadParams = { zip: true };
  await assertQueueCapacity('download');
  const job = await Job.create({ type: 'download', sourceUrl: url, platform, params });
  await enqueue('download', job._id);
  res.status(202).json({ jobId: job._id });
});
