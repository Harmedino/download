import { env } from '../config/env.js';
import { AppError } from '../middleware/errors.js';
import { requireBinary } from './binaries.js';
import { run } from './exec.js';
import type { FormatOption, MediaItem, MediaMetadata, QualityPreset } from './media.types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type RawInfo = Record<string, any>;

const PRESET_HEIGHTS: Array<[QualityPreset, number]> = [
  ['360p', 360],
  ['720p', 720],
  ['1080p', 1080],
];

/** Flags shared by every yt-dlp invocation. User URLs always come after `--`. */
export function baseArgs(): string[] {
  return [
    '--ignore-config',
    '--no-warnings',
    '--no-cache-dir',
    '--color', 'never',
    '--socket-timeout', '20',
    // Only platform extractors: the generic one would fetch whatever URL a post links to (SSRF).
    '--use-extractors', 'default,-generic',
    // YouTube needs a JS runtime; reuse the Node binary we are already running on.
    '--js-runtimes', `node:${process.execPath}`,
  ];
}

/** Maps yt-dlp / gallery-dl stderr to stable error codes that the client turns into friendly text. */
export function mapExtractorError(stderr: string): AppError {
  const msg = stderr.split('\n').filter((l) => /error/i.test(l)).join('\n') || stderr;
  const t = msg.toLowerCase();
  const test = (...needles: Array<string | RegExp>) =>
    needles.some((n) => (typeof n === 'string' ? t.includes(n) : n.test(t)));

  if (test('private', 'login required', 'log in', 'sign in to confirm', 'requires authentication', 'cookies', 'age-restricted', 'inappropriate for some users', 'not authorized'))
    return new AppError(403, 'PRIVATE_POST', "This post is private or requires a login, so it can't be downloaded. Only public posts are supported.");
  if (test('unsupported url', 'no suitable extractor'))
    return new AppError(400, 'UNSUPPORTED_URL', "We couldn't find any media at that link. Make sure it points to a single post or video.");
  if (test('file is larger than max-filesize', 'larger than max-filesize'))
    return new AppError(413, 'FILE_TOO_LARGE', `That file is larger than the ${env.MAX_DOWNLOAD_MB} MB limit.`);
  if (test('http error 429', 'too many requests', 'rate-limit', 'rate limit'))
    return new AppError(429, 'UPSTREAM_RATE_LIMITED', 'The platform is limiting requests right now. Please try again in a few minutes.');
  if (test('video unavailable', 'not available', 'has been removed', 'does not exist', 'http error 404', 'no longer available', 'deleted', 'not found'))
    return new AppError(404, 'MEDIA_UNAVAILABLE', 'This post was removed or is unavailable.');
  if (test("there's no video", 'no video', 'no media', 'no formats', 'requested format is not available'))
    return new AppError(404, 'NO_MEDIA', "We couldn't find a downloadable video or image in this post.");
  if (test('timed out', 'getaddrinfo', 'name or service not known', 'connection refused', 'connection reset', 'unable to download webpage', 'network is unreachable', 'tunnel connection failed'))
    return new AppError(502, 'UPSTREAM_UNREACHABLE', "We couldn't reach the platform. Please try again shortly.");
  return new AppError(502, 'FETCH_FAILED', "We couldn't read this post. The platform may have changed something; please try again later.");
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function isVideoFormat(f: RawInfo): boolean {
  return f.vcodec !== 'none' && (num(f.height) !== null || num(f.width) !== null) && !/^(jpe?g|png|webp|gif)$/.test(f.ext ?? '');
}

function isAudioOnly(f: RawInfo): boolean {
  return f.vcodec === 'none' && f.acodec && f.acodec !== 'none';
}

function size(f: RawInfo | undefined): number | null {
  if (!f) return null;
  return num(f.filesize) ?? num(f.filesize_approx);
}

/** The "p" resolution of a frame is its short side, so portrait 1080x1920 counts as 1080p. */
function resOf(f: RawInfo): number | null {
  const w = num(f.width);
  const h = num(f.height);
  if (w !== null && h !== null) return Math.min(w, h);
  return h ?? w;
}

function pickBestAudio(formats: RawInfo[]): RawInfo | undefined {
  return formats.filter(isAudioOnly).sort((a, b) => (num(b.abr) ?? num(b.tbr) ?? 0) - (num(a.abr) ?? num(a.tbr) ?? 0))[0];
}

function pickBestVideoUnder(formats: RawInfo[], maxRes: number): RawInfo | undefined {
  return formats
    .filter((f) => isVideoFormat(f) && (resOf(f) ?? 0) <= maxRes)
    .sort((a, b) => (resOf(b) ?? 0) - (resOf(a) ?? 0) || (num(b.tbr) ?? 0) - (num(a.tbr) ?? 0))[0];
}

function estimate(formats: RawInfo[], video: RawInfo | undefined): number | null {
  if (!video) return null;
  const v = size(video);
  if (v === null) return null;
  if (video.acodec && video.acodec !== 'none') return v;
  const a = size(pickBestAudio(formats));
  return a === null ? v : v + a;
}

export function buildFormatOptions(raw: RawInfo): FormatOption[] {
  const formats: RawInfo[] = Array.isArray(raw.formats) ? raw.formats : [];
  const videos = formats.filter(isVideoFormat);
  if (!videos.length) return [];
  const maxRes = Math.max(...videos.map((f) => resOf(f) ?? 0));
  const options: FormatOption[] = [];
  for (const [id, h] of PRESET_HEIGHTS) {
    // Only offer a preset if the source actually reaches roughly that resolution.
    if (h !== 360 && maxRes < h * 0.9) continue;
    const best = pickBestVideoUnder(formats, h);
    if (!best) continue;
    options.push({ id, label: id, height: resOf(best), ext: 'mp4', filesize: estimate(formats, best) });
  }
  const top = pickBestVideoUnder(formats, Number.MAX_SAFE_INTEGER);
  if (!options.some((o) => o.height === maxRes)) {
    options.push({ id: 'best', label: maxRes ? `Best (${maxRes}p)` : 'Best', height: maxRes || null, ext: 'mp4', filesize: estimate(formats, top) });
  }
  return options;
}

function isImageEntry(e: RawInfo): boolean {
  const formats: RawInfo[] = Array.isArray(e.formats) ? e.formats : [];
  if (formats.some(isVideoFormat)) return false;
  return /^(jpe?g|png|webp|gif|heic)$/i.test(e.ext ?? '') || (!formats.length && !e.duration);
}

function toItem(e: RawInfo, index: number): MediaItem {
  return {
    index,
    type: isImageEntry(e) ? 'image' : 'video',
    title: e.title ?? null,
    thumbnail: e.thumbnail ?? e.thumbnails?.at?.(-1)?.url ?? null,
    width: num(e.width),
    height: num(e.height),
    duration: num(e.duration),
    ext: e.ext ?? null,
  };
}

function isPortrait(info: RawInfo): boolean {
  const formats: RawInfo[] = Array.isArray(info.formats) ? info.formats : [];
  const top = formats.filter(isVideoFormat).sort((a, b) => (resOf(b) ?? 0) - (resOf(a) ?? 0))[0] ?? info;
  return (num(top.height) ?? 0) > (num(top.width) ?? 0);
}

/** Converts `yt-dlp -J` output into the API's metadata shape. */
export function normalizeYtdlpInfo(raw: RawInfo): MediaMetadata {
  const entries: RawInfo[] = raw._type === 'playlist' && Array.isArray(raw.entries) ? raw.entries.filter(Boolean) : [];
  const primary = entries[0] ?? raw;
  const items = entries.length ? entries.map(toItem) : [toItem(raw, 0)];
  const formats = entries.length > 1 ? [] : buildFormatOptions(primary);
  const allFormats: RawInfo[] = Array.isArray(primary.formats) ? primary.formats : [];
  const kind: MediaMetadata['kind'] = entries.length > 1 ? 'carousel' : items[0]!.type;
  const hasAudio =
    kind === 'video' && (allFormats.some((f) => f.acodec && f.acodec !== 'none') || (!allFormats.length && !!primary.acodec));

  return {
    extractor: 'yt-dlp',
    kind,
    id: raw.id ?? null,
    title: (raw.title || primary.title || raw.description || 'Untitled').toString().slice(0, 300),
    uploader: raw.uploader ?? raw.channel ?? primary.uploader ?? null,
    thumbnail: raw.thumbnail ?? primary.thumbnail ?? items[0]?.thumbnail ?? null,
    duration: num(raw.duration) ?? num(primary.duration),
    filesize: formats.at(-1)?.filesize ?? size(primary),
    formats,
    hasAudio,
    portrait: isPortrait(primary),
    items,
  };
}

export async function ytdlpFetch(url: string): Promise<MediaMetadata> {
  const bin = requireBinary('yt-dlp');
  const res = await run(bin, [...baseArgs(), '-J', '--playlist-items', '1:50', '--', url], { timeoutMs: 60_000 });
  if (res.timedOut) throw new AppError(504, 'UPSTREAM_TIMEOUT', 'The platform took too long to respond. Please try again.');
  if (res.code !== 0) throw mapExtractorError(res.stderr);
  let raw: RawInfo;
  try {
    raw = JSON.parse(res.stdout);
  } catch {
    throw new AppError(502, 'FETCH_FAILED', "We couldn't read this post.");
  }
  return normalizeYtdlpInfo(raw);
}

/**
 * yt-dlp format selector for a preset. Portrait videos are limited by width so
 * "720p" means the short side, matching how buildFormatOptions labels them.
 */
export function formatSelector(preset: QualityPreset | undefined, portrait: boolean): string {
  if (!preset || preset === 'best') return 'bv*+ba/b';
  const h = PRESET_HEIGHTS.find(([p]) => p === preset)?.[1];
  if (!h) return 'bv*+ba/b';
  const dim = portrait ? 'width' : 'height';
  return `bv*[${dim}<=${h}]+ba/b[${dim}<=${h}]/bv*+ba/b`;
}

/** Turns yt-dlp's per-stream progress into one 0-100 number across video + audio streams. */
export function createProgressTracker(expectedStreams: number, onProgress: (pct: number) => void) {
  let stream = 0;
  let last = 0;
  return (line: string) => {
    const m = /^\[sg\]\s*([\d.]+)%/.exec(line.trim());
    if (!m) return;
    const pct = Math.min(100, parseFloat(m[1]!));
    if (pct + 5 < last && stream < expectedStreams - 1) stream++;
    last = pct;
    const overall = ((stream + pct / 100) / expectedStreams) * 95;
    onProgress(Math.max(1, Math.min(95, Math.round(overall))));
  };
}

export interface YtdlpDownloadOptions {
  url: string;
  outDir: string;
  preset?: QualityPreset;
  portrait?: boolean;
  audioOnly?: boolean;
  /** 0-based index into a multi-item post; undefined downloads a single item or the whole post. */
  itemIndex?: number;
  /** Download every item of a multi-item post. */
  allItems?: boolean;
  onProgress?: (pct: number) => void;
}

export async function ytdlpDownload(o: YtdlpDownloadOptions): Promise<void> {
  const bin = requireBinary('yt-dlp');
  const ffmpeg = requireBinary('ffmpeg');
  const args = [
    ...baseArgs(),
    '--newline',
    '--progress-template', 'download:[sg] %(progress._percent_str)s',
    '--max-filesize', `${env.MAX_DOWNLOAD_MB}M`,
    '--ffmpeg-location', ffmpeg,
    '--restrict-filenames',
    '--no-mtime',
    '-P', o.outDir,
    '-o', o.allItems ? '%(playlist_index|0)02d_%(title).60B_[%(id)s].%(ext)s' : '%(title).80B_[%(id)s].%(ext)s',
  ];
  if (o.audioOnly) {
    args.push('-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    args.push('-f', formatSelector(o.preset, !!o.portrait), '--merge-output-format', 'mp4');
  }
  if (o.allItems) args.push('--yes-playlist', '--playlist-items', '1:50');
  else if (o.itemIndex !== undefined) args.push('--yes-playlist', '--playlist-items', String(o.itemIndex + 1));
  else args.push('--no-playlist');
  args.push('--', o.url);

  const track = createProgressTracker(o.audioOnly || o.allItems ? 1 : 2, (p) => o.onProgress?.(p));
  const res = await run(bin, args, { timeoutMs: 30 * 60_000, onLine: (l) => track(l) });
  if (res.timedOut) throw new AppError(504, 'UPSTREAM_TIMEOUT', 'The download took too long and was stopped.');
  if (res.code !== 0) throw mapExtractorError(res.stderr);
}
