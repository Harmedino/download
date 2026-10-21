import path from 'node:path';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errors.js';
import type { MediaMetadata } from './media.types.js';
import { detectPlatform, validateMediaUrl, type Platform } from './platform.js';
import { checkPublicUrl, inspectRemoteFile, type SafeFetchOptions } from './safeFetch.js';

/** A supported platform, or a public link straight to a media file. */
export type SourcePlatform = Platform | 'direct';

/**
 * Services that protect their media with DRM, subscriptions or paywalls. We say so plainly instead
 * of trying (and failing, or worse, succeeding) to get around that.
 */
const PROTECTED: Array<[RegExp, string]> = [
  [/(^|\.)netflix\.com$/, 'Netflix'],
  [/(^|\.)disneyplus\.com$/, 'Disney+'],
  [/(^|\.)(primevideo\.com|amazon\.[a-z.]+)$/, 'Amazon Prime Video'],
  [/(^|\.)hulu\.com$/, 'Hulu'],
  [/(^|\.)(max\.com|hbomax\.com)$/, 'Max'],
  [/(^|\.)peacocktv\.com$/, 'Peacock'],
  [/(^|\.)paramountplus\.com$/, 'Paramount+'],
  [/(^|\.)(tv|music)\.apple\.com$/, 'Apple TV / Apple Music'],
  [/(^|\.)spotify\.com$/, 'Spotify'],
  [/(^|\.)tidal\.com$/, 'Tidal'],
  [/(^|\.)deezer\.com$/, 'Deezer'],
  [/(^|\.)crunchyroll\.com$/, 'Crunchyroll'],
  [/(^|\.)dazn\.com$/, 'DAZN'],
  [/(^|\.)(onlyfans\.com|fansly\.com|patreon\.com)$/, 'This subscription site'],
];

export function protectedService(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return PROTECTED.find(([re]) => re.test(host))?.[1] ?? null;
}

const MEDIA_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|mp3|m4a|wav|flac|ogg|opus|aac|jpe?g|png|webp|gif)$/i;
const MEDIA_TYPE = /^(video|audio|image)\//;

/**
 * Validates a pasted link and decides how to handle it: a supported platform (yt-dlp/gallery-dl),
 * a direct media file, or a clear refusal.
 */
export function resolveSource(input: unknown): { url: string; platform: SourcePlatform } {
  try {
    return validateMediaUrl(input);
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== 'UNSUPPORTED_PLATFORM') throw err;
  }
  const raw = String(input).trim();
  const u = checkPublicUrl(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  const service = protectedService(u.hostname);
  if (service) {
    throw new AppError(
      403,
      'PROTECTED_CONTENT',
      `${service} protects its videos and music with DRM or a subscription, so SnapGrab can't download them. Use the service's own offline or download feature instead.`,
    );
  }
  if (!env.DIRECT_URLS_ENABLED) {
    throw new AppError(400, 'UNSUPPORTED_PLATFORM', 'That site is not supported. Try a link from one of the sites listed on the home page.');
  }
  u.hash = '';
  return { url: u.toString(), platform: 'direct' };
}

export function isDirect(platform: string | null | undefined): boolean {
  return platform === 'direct';
}

/** Metadata for a direct file link, read from its HTTP headers (duration and size come after import). */
export async function directMetadata(url: string, opts: SafeFetchOptions = {}): Promise<MediaMetadata> {
  const info = await inspectRemoteFile(url, opts);
  const byExt = MEDIA_EXT.exec(new URL(info.url).pathname)?.[1]?.toLowerCase() ?? null;
  // Many CDNs send application/octet-stream; trust the extension then, ffprobe validates the bytes after download.
  const mediaType = MEDIA_TYPE.test(info.contentType) ? info.contentType : info.contentType === 'application/octet-stream' && byExt ? `x/${byExt}` : null;
  if (!mediaType) {
    // A web page on a site we don't support. Name the platform if it is one of ours under a different host.
    throw new AppError(
      400,
      'UNSUPPORTED_SOURCE',
      detectPlatform(new URL(info.url).hostname)
        ? 'That link redirects to a page we can’t read. Paste the post link instead.'
        : 'This site is not supported, and the link is not a direct link to a video, audio or image file. Paste a link from a supported site, or a link that ends in .mp4, .mov, .webm, .mp3 or similar.',
    );
  }
  if (info.size && info.size > env.MAX_DOWNLOAD_MB * 1024 * 1024) {
    throw new AppError(413, 'FILE_TOO_LARGE', `That file is larger than the ${env.MAX_DOWNLOAD_MB} MB limit.`);
  }
  const ext = byExt ?? mediaType.split('/')[1]!.replace('jpeg', 'jpg').replace('quicktime', 'mov').replace(/[^a-z0-9]/g, '').slice(0, 5);
  const kind = mediaType.startsWith('image/') || /^(jpe?g|png|webp|gif)$/.test(ext) ? 'image' : 'video';
  const title = path.parse(info.fileName).name.slice(0, 200) || 'Media file';
  return {
    extractor: 'direct',
    kind,
    id: null,
    title,
    uploader: new URL(info.url).hostname,
    thumbnail: null,
    duration: null,
    filesize: info.size,
    formats: [],
    hasAudio: false,
    portrait: false,
    items: [{ index: 0, type: kind, title, thumbnail: null, width: null, height: null, duration: null, ext }],
  };
}
