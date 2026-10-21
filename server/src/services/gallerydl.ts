import { AppError } from '../middleware/errors.js';
import { requireBinary } from './binaries.js';
import { run } from './exec.js';
import { mapExtractorError } from './ytdlp.js';
import type { MediaItem, MediaMetadata } from './media.types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Kw = Record<string, any>;

const VIDEO_EXT = /^(mp4|webm|mov|m4v|mkv|gifv)$/i;

/** Extractors that fetch arbitrary URLs a post links to; never follow them (SSRF). */
const BLOCKED_CATEGORIES = new Set(['directlink', 'generic']);

function baseArgs(): string[] {
  return ['--config-ignore', '--quiet', '--filter', `category not in (${[...BLOCKED_CATEGORIES].map((c) => `'${c}'`).join(', ')})`];
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Parses `gallery-dl -j` output: a JSON array of messages where
 * `[3, url, kwdict]` is a downloadable file and `[2, kwdict]` is post-level metadata.
 */
export function normalizeGalleryDlJson(json: unknown): MediaMetadata {
  if (!Array.isArray(json)) throw new AppError(502, 'FETCH_FAILED', "We couldn't read this post.");
  let post: Kw = {};
  const files: Array<{ url: string; kw: Kw }> = [];
  for (const msg of json) {
    if (!Array.isArray(msg)) continue;
    if (msg[0] === 2 && msg[1] && typeof msg[1] === 'object') post = msg[1];
    if (msg[0] === 3 && typeof msg[1] === 'string' && !BLOCKED_CATEGORIES.has(msg[2]?.category)) files.push({ url: msg[1], kw: msg[2] ?? {} });
    // gallery-dl reports extractor errors as [-1, {error, message}]
    if (msg[0] === -1 && msg[1]) throw mapExtractorError(`ERROR: ${msg[1].error ?? ''} ${msg[1].message ?? ''}`);
  }
  if (!files.length) throw new AppError(404, 'NO_MEDIA', "We couldn't find a downloadable video or image in this post.");

  const items: MediaItem[] = files.map(({ url, kw }, index) => {
    const ext = (kw.extension ?? '').toString();
    const isVideo = url.startsWith('ytdl:') || VIDEO_EXT.test(ext);
    return {
      index,
      type: isVideo ? 'video' : 'image',
      title: null,
      // Image URLs double as thumbnails; videos rarely expose one through gallery-dl.
      thumbnail: isVideo ? (kw.thumbnail ?? kw.display_url ?? null) : url,
      width: num(kw.width),
      height: num(kw.height),
      duration: num(kw.duration),
      ext: ext || null,
    };
  });

  const first = files[0]!.kw;
  const meta = { ...first, ...post };
  const rawTitle = meta.title ?? meta.description ?? meta.content ?? meta.caption ?? meta.grid_title ?? '';
  const title = rawTitle.toString().replace(/\s+/g, ' ').trim().slice(0, 300) || 'Untitled post';
  return {
    extractor: 'gallery-dl',
    kind: items.length > 1 ? 'carousel' : items[0]!.type,
    id: (meta.post_id ?? meta.id ?? meta.shortcode ?? null)?.toString() ?? null,
    title,
    uploader: meta.username ?? meta.author?.name ?? meta.author ?? meta.owner_username ?? null,
    thumbnail: items.find((i) => i.thumbnail)?.thumbnail ?? null,
    duration: items.length === 1 ? items[0]!.duration : null,
    filesize: null,
    formats: [],
    hasAudio: false,
    portrait: (items[0]!.height ?? 0) > (items[0]!.width ?? 0),
    items,
  };
}

export async function galleryDlFetch(url: string): Promise<MediaMetadata> {
  const bin = requireBinary('gallery-dl');
  const res = await run(bin, [...baseArgs(), '-j', '--range', '1-50', '--', url], { timeoutMs: 60_000 });
  if (res.timedOut) throw new AppError(504, 'UPSTREAM_TIMEOUT', 'The platform took too long to respond. Please try again.');
  let json: unknown;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    throw res.code !== 0 ? mapExtractorError(res.stderr) : new AppError(502, 'FETCH_FAILED', "We couldn't read this post.");
  }
  return normalizeGalleryDlJson(json);
}

export async function galleryDlDownload(o: { url: string; outDir: string; itemIndex?: number }): Promise<void> {
  const bin = requireBinary('gallery-dl');
  const range = o.itemIndex === undefined ? '1-50' : String(o.itemIndex + 1);
  const res = await run(
    bin,
    [...baseArgs(), '--range', range, '-D', o.outDir, '-f', '{num:>02}_{filename}.{extension}', '--no-mtime', '--', o.url],
    { timeoutMs: 10 * 60_000 },
  );
  if (res.timedOut) throw new AppError(504, 'UPSTREAM_TIMEOUT', 'The download took too long and was stopped.');
  if (res.code !== 0) throw mapExtractorError(res.stderr);
}
