import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  PORT: z.coerce.number().int().positive().default(4000),
  /** One origin or a comma-separated list, e.g. "https://snapgrab.vercel.app,https://snapgrab.com" */
  CLIENT_ORIGIN: z
    .string()
    .default('http://localhost:4200')
    .transform((v) => v.split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean))
    .refine((list) => list.length > 0 && list.every((o) => /^https?:\/\/[^/\s]+$/.test(o)), {
      message: 'must be one or more origins like https://app.example.com (no path), comma-separated',
    }),
  TEMP_DIR: z.string().default('./tmp'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(50),
  YTDLP_PATH: z.string().default('yt-dlp'),
  GALLERYDL_PATH: z.string().default('gallery-dl'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  MAX_DOWNLOAD_MB: z.coerce.number().positive().default(500),
  FILE_TTL_MINUTES: z.coerce.number().positive().default(60),
  /** Uploads for the video tools (videos, audio and images). */
  MAX_MEDIA_UPLOAD_MB: z.coerce.number().positive().default(500),
  /** Longest video or audio the tools accept. */
  MAX_MEDIA_DURATION_MINUTES: z.coerce.number().positive().default(60),
  /** A media job is killed (and marked failed) after this long. */
  JOB_TIMEOUT_MINUTES: z.coerce.number().positive().default(30),
  /** How many ffmpeg jobs run at once. Each uses FFMPEG_THREADS cores. */
  MEDIA_CONCURRENCY: z.coerce.number().int().positive().default(1),
  FFMPEG_THREADS: z.coerce.number().int().positive().default(2),
  /** Longest side of any video the tools write; larger sources are scaled down. */
  MAX_OUTPUT_SIDE: z.coerce.number().int().positive().default(3840),
  /** Allow public direct links to media files (https://example.com/clip.mp4). */
  DIRECT_URLS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${issues}\nSee server/.env.example`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  TEMP_DIR: path.resolve(parsed.data.TEMP_DIR),
  MAX_UPLOAD_BYTES: Math.round(parsed.data.MAX_UPLOAD_MB * 1024 * 1024),
  MAX_MEDIA_UPLOAD_BYTES: Math.round(parsed.data.MAX_MEDIA_UPLOAD_MB * 1024 * 1024),
  JOB_TIMEOUT_MS: Math.round(parsed.data.JOB_TIMEOUT_MINUTES * 60_000),
};

export type Env = typeof env;
