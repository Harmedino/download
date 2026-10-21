import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { AppError } from '../middleware/errors.js';
import { requireBinary } from './binaries.js';
import { run } from './exec.js';

/**
 * Demuxers ffmpeg/ffprobe may use on any input. Everything else is refused, most importantly
 * playlist formats (HLS, concat, ...) that can make ffmpeg open other local files or URLs.
 * Together with `-protocol_whitelist file,pipe` an uploaded file can only ever read itself.
 */
const DEMUXERS = [
  'mov,mp4,m4a,3gp,3g2,mj2',
  'matroska,webm',
  'avi',
  'flv',
  'mpegts',
  'mpeg',
  'asf',
  'ogg',
  'mp3',
  'wav',
  'flac',
  'aac',
  'gif',
  'image2',
  'png_pipe',
  'jpeg_pipe',
  'webp_pipe',
  'bmp_pipe',
  'tiff_pipe',
].join(',');

const IMAGE_FORMATS = /^(image2|png_pipe|jpeg_pipe|webp_pipe|bmp_pipe|tiff_pipe)$/;

/** Input options that lock ffmpeg/ffprobe to reading one local file of a known format. */
export function inputArgs(path: string, extra: string[] = []): string[] {
  return ['-protocol_whitelist', 'file,pipe', '-format_whitelist', DEMUXERS, ...extra, '-i', path];
}

export interface MediaInfo {
  kind: 'video' | 'audio' | 'image';
  format: string;
  /** Seconds; null for still images. */
  duration: number | null;
  size: number | null;
  bitRate: number | null;
  /** Display size, with rotation metadata applied (a portrait phone video is taller than wide). */
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function rate(r: unknown): number | null {
  if (typeof r !== 'string') return null;
  const [a, b] = r.split('/').map(Number);
  if (!a || !b) return null;
  const fps = a / b;
  return fps > 0 && fps < 1000 ? Math.round(fps * 100) / 100 : null;
}

function rotationOf(stream: Raw): number {
  const side = Array.isArray(stream.side_data_list) ? stream.side_data_list.find((d: Raw) => d.rotation !== undefined) : null;
  const r = num(side?.rotation) ?? num(stream.tags?.rotate) ?? 0;
  return ((Math.round(r / 90) * 90) % 360 + 360) % 360;
}

/** Turns ffprobe JSON into the summary the tools and the client use. Exported for tests. */
export function parseProbe(raw: Raw): MediaInfo {
  const streams: Raw[] = Array.isArray(raw.streams) ? raw.streams : [];
  // Cover art in audio files shows up as a one-frame video stream; ignore it.
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === 'audio');
  const format = String(raw.format?.format_name ?? '');
  let width = num(video?.width);
  let height = num(video?.height);
  if (video && rotationOf(video) % 180 === 90) [width, height] = [height, width];
  const duration = num(raw.format?.duration) ?? num(video?.duration) ?? num(audio?.duration);
  const kind: MediaInfo['kind'] = video ? (IMAGE_FORMATS.test(format) ? 'image' : 'video') : 'audio';
  return {
    kind,
    format,
    duration: kind === 'image' ? null : duration,
    size: num(raw.format?.size),
    bitRate: num(raw.format?.bit_rate),
    width,
    height,
    fps: kind === 'video' ? rate(video?.avg_frame_rate) ?? rate(video?.r_frame_rate) : null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    hasAudio: !!audio,
  };
}

export async function probe(path: string): Promise<MediaInfo> {
  const bin = requireBinary('ffprobe');
  const res = await run(bin, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', ...inputArgs(path).slice(0, -2), path], {
    timeoutMs: 60_000,
    maxStdoutBytes: 5 * 1024 * 1024,
  });
  if (res.code !== 0) throw new AppError(415, 'INVALID_VIDEO', "We couldn't read that file. Please use an MP4, MOV, WebM, MKV, MP3, WAV or image file.");
  try {
    return parseProbe(JSON.parse(res.stdout));
  } catch {
    throw new AppError(415, 'INVALID_VIDEO', "We couldn't read that file.");
  }
}

/** Probes a file and rejects anything that isn't playable media within the configured limits. */
export async function validateMedia(path: string, allowed: Array<MediaInfo['kind']> = ['video', 'audio', 'image']): Promise<MediaInfo> {
  const info = await probe(path);
  if (!info.videoCodec && !info.audioCodec) throw new AppError(415, 'INVALID_VIDEO', 'That file has no video or audio in it.');
  if (!allowed.includes(info.kind)) {
    const want = allowed.join(' or ');
    throw new AppError(415, 'UNSUPPORTED_FILE', `This tool needs a ${want} file, but that file is ${info.kind === 'audio' ? 'audio only' : `an ${info.kind}`}.`);
  }
  if (info.kind === 'video' && (!info.width || !info.height)) throw new AppError(415, 'INVALID_VIDEO', "We couldn't read the video's size.");
  if (info.duration !== null && info.duration > env.MAX_MEDIA_DURATION_MINUTES * 60) {
    throw new AppError(413, 'VIDEO_TOO_LONG', `Videos can be up to ${env.MAX_MEDIA_DURATION_MINUTES} minutes long.`);
  }
  return info;
}

export interface FfmpegOptions {
  /** Expected output duration in seconds, for progress. */
  duration?: number | null;
  onProgress?: (pct: number) => void;
  timeoutMs?: number;
  cwd?: string;
}

/** Parses ffmpeg `-progress` output lines into a percentage of `duration`. Exported for tests. */
export function progressFromLine(line: string, duration: number): number | null {
  const m = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim());
  if (!m || !duration) return null;
  return Math.max(0, Math.min(100, (Number(m[1]) / 1e6 / duration) * 100));
}

/** Runs ffmpeg with an argument array (never a shell), reporting progress and enforcing the job time limit. */
export async function ffmpeg(args: string[], opts: FfmpegOptions = {}): Promise<void> {
  const bin = requireBinary('ffmpeg');
  const timeoutMs = opts.timeoutMs ?? env.JOB_TIMEOUT_MS;
  const res = await run(bin, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', ...args], {
    timeoutMs,
    cwd: opts.cwd,
    maxStdoutBytes: 1024 * 1024,
    onLine: (line, stream) => {
      if (stream !== 'stdout' || !opts.onProgress || !opts.duration) return;
      const pct = progressFromLine(line, opts.duration);
      if (pct !== null) opts.onProgress(pct);
    },
  });
  if (res.timedOut) {
    throw new AppError(504, 'PROCESSING_TIMEOUT', `Processing took longer than ${env.JOB_TIMEOUT_MINUTES} minutes and was stopped. Try a shorter clip or a lower resolution.`);
  }
  if (res.code !== 0) {
    logger.error({ stderr: res.stderr.slice(-2000), code: res.code }, 'ffmpeg failed');
    throw new AppError(500, 'PROCESSING_FAILED', "We couldn't process this file. It may be damaged or use an unusual format.");
  }
}

export type VideoContainer = 'mp4' | 'webm' | 'mov' | 'mkv';
export type AudioContainer = 'mp3' | 'm4a' | 'wav';

export const VIDEO_CONTAINERS: VideoContainer[] = ['mp4', 'webm', 'mov', 'mkv'];
export const AUDIO_CONTAINERS: AudioContainer[] = ['mp3', 'm4a', 'wav'];

/** CRF scale per codec: [high quality, balanced, small]. */
const CRF = { x264: [20, 26, 31], vp9: [31, 37, 43] };
export type QualityLevel = 0 | 1 | 2;

/** Encoder flags for a video container. `bitrate` (bits/s) switches to a size-targeted encode. */
export function videoEncodeArgs(container: VideoContainer, o: { quality?: QualityLevel; bitrate?: number; hasAudio: boolean; audioBitrate?: number }): string[] {
  const q = o.quality ?? 0;
  const ab = `${Math.round((o.audioBitrate ?? 160_000) / 1000)}k`;
  const threads = ['-threads', String(env.FFMPEG_THREADS)];
  if (container === 'webm') {
    const rateArgs = o.bitrate ? ['-b:v', String(Math.round(o.bitrate)), '-maxrate', String(Math.round(o.bitrate * 1.5)), '-bufsize', String(Math.round(o.bitrate * 2))] : ['-crf', String(CRF.vp9[q]), '-b:v', '0'];
    return ['-c:v', 'libvpx-vp9', ...rateArgs, '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-pix_fmt', 'yuv420p', ...(o.hasAudio ? ['-c:a', 'libopus', '-b:a', ab] : ['-an']), ...threads];
  }
  const rateArgs = o.bitrate ? ['-b:v', String(Math.round(o.bitrate)), '-maxrate', String(Math.round(o.bitrate * 1.5)), '-bufsize', String(Math.round(o.bitrate * 2))] : ['-crf', String(CRF.x264[q])];
  return [
    '-c:v', 'libx264', '-preset', 'veryfast', ...rateArgs, '-pix_fmt', 'yuv420p',
    ...(o.hasAudio ? ['-c:a', 'aac', '-b:a', ab] : ['-an']),
    ...(container === 'mp4' || container === 'mov' ? ['-movflags', '+faststart'] : []),
    ...threads,
  ];
}

export function audioEncodeArgs(container: AudioContainer): string[] {
  if (container === 'mp3') return ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'];
  if (container === 'm4a') return ['-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];
  return ['-vn', '-c:a', 'pcm_s16le'];
}

/** Even dimensions that fit inside MAX_OUTPUT_SIDE, keeping the aspect ratio. */
export function fitOutput(width: number, height: number, maxSide = env.MAX_OUTPUT_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}
