import { logger } from '../logger.js';
import { AppError } from '../middleware/errors.js';
import { MediaCache } from '../models/MediaCache.js';
import { binaryStatus } from './binaries.js';
import { galleryDlFetch } from './gallerydl.js';
import { ytdlpFetch } from './ytdlp.js';
import type { MediaMetadata } from './media.types.js';
import type { Platform } from './platform.js';

const CACHE_MS = 60 * 60 * 1000;
// Platforms where posts can be image-only or mixed carousels, which gallery-dl handles better than yt-dlp.
const IMAGE_PLATFORMS = new Set<Platform>(['instagram', 'pinterest', 'twitter', 'reddit', 'tiktok', 'facebook']);
const NO_MEDIA_CODES = new Set(['NO_MEDIA', 'UNSUPPORTED_URL']);

/** Runs yt-dlp first and falls back to gallery-dl for image posts and carousels. */
export async function extractMetadata(url: string, platform: Platform): Promise<MediaMetadata> {
  const hasYtdlp = binaryStatus('yt-dlp')?.available;
  const hasGallery = binaryStatus('gallery-dl')?.available && IMAGE_PLATFORMS.has(platform);

  if (!hasYtdlp && hasGallery) return galleryDlFetch(url);

  let ytErr: unknown;
  try {
    const meta = await ytdlpFetch(url);
    // yt-dlp can skip the images inside mixed carousels; gallery-dl sees every item.
    if (meta.kind === 'carousel' && hasGallery) {
      const g = await galleryDlFetch(url).catch(() => null);
      if (g && g.items.length > meta.items.length) return g;
    }
    return meta;
  } catch (err) {
    ytErr = err;
    if (!(err instanceof AppError) || !NO_MEDIA_CODES.has(err.code) || !IMAGE_PLATFORMS.has(platform)) throw err;
  }

  if (!hasGallery) {
    logger.warn({ url }, 'yt-dlp found no video and gallery-dl is not installed; image posts need gallery-dl');
    throw ytErr;
  }
  try {
    return await galleryDlFetch(url);
  } catch (gErr) {
    // A private-post signal from either tool is the most useful thing to show the user.
    if (gErr instanceof AppError && gErr.code === 'PRIVATE_POST') throw gErr;
    throw ytErr;
  }
}

const inflight = new Map<string, Promise<MediaMetadata>>();

/** Returns metadata from mediaCache when fresh, otherwise extracts it (deduplicating concurrent requests). */
export async function getMetadata(url: string, platform: Platform): Promise<{ metadata: MediaMetadata; cached: boolean }> {
  const hit = await MediaCache.findOne({ sourceUrl: url, createdAt: { $gt: new Date(Date.now() - CACHE_MS) } }).lean();
  if (hit) return { metadata: hit.metadata, cached: true };

  let p = inflight.get(url);
  if (!p) {
    p = extractMetadata(url, platform).finally(() => inflight.delete(url));
    inflight.set(url, p);
  }
  const metadata = await p;
  await MediaCache.updateOne(
    { sourceUrl: url },
    { $set: { platform, metadata, createdAt: new Date() } },
    { upsert: true },
  ).catch((err) => logger.warn({ err }, 'Failed to write mediaCache'));
  return { metadata, cached: false };
}
