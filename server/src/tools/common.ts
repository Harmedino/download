import { z } from 'zod';
import { AppError } from '../middleware/errors.js';
import { fitOutput, type MediaInfo } from '../services/ffmpeg.js';
import type { ToolInput } from './types.js';

export const fileId = z.string().regex(/^[a-f0-9]{24}$/i, 'must be a file id');
/** Seconds into a video. */
export const seconds = z.number().min(0).max(24 * 3600);
export const RESOLUTIONS = [2160, 1440, 1080, 720, 480, 360] as const;
export const resolution = z
  .number()
  .int()
  .refine((v) => (RESOLUTIONS as readonly number[]).includes(v), 'must be one of 2160, 1440, 1080, 720, 480, 360');

/** Scales so the short side is at most `shortSide`, never upscaling; even numbers for yuv420p. */
export function scaleToShortSide(width: number, height: number, shortSide?: number | null): { width: number; height: number } {
  const scale = shortSide ? Math.min(1, shortSide / Math.min(width, height)) : 1;
  return fitOutput(width * scale, height * scale);
}

export function requireVideo(input: ToolInput): MediaInfo & { width: number; height: number; duration: number } {
  const i = input.info;
  if (i.kind !== 'video' || !i.width || !i.height) throw new AppError(415, 'UNSUPPORTED_FILE', 'This tool needs a video file.');
  if (!i.duration) throw new AppError(415, 'INVALID_VIDEO', "We couldn't read how long this video is.");
  return i as MediaInfo & { width: number; height: number; duration: number };
}

/** Clamps a [start, end] range to the media and checks it isn't empty. */
export function clampRange(start: number | undefined, end: number | undefined, duration: number): { start: number; end: number } {
  const s = Math.max(0, Math.min(start ?? 0, duration));
  const e = Math.max(0, Math.min(end ?? duration, duration));
  if (e - s < 0.1) throw new AppError(400, 'INVALID_RANGE', 'Pick a time range that is at least a tenth of a second long.');
  return { start: s, end: e };
}

/** ffmpeg time argument with millisecond precision. */
export function ts(t: number): string {
  return t.toFixed(3);
}
