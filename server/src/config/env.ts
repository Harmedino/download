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
  MAX_VIDEO_BG_SECONDS: z.coerce.number().positive().default(60),
  VIDEO_BG_FPS: z.coerce.number().int().min(1).max(30).default(12),
  VIDEO_BG_MAX_WIDTH: z.coerce.number().int().min(160).max(1920).default(720),
  FILE_TTL_MINUTES: z.coerce.number().positive().default(60),
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
};

export type Env = typeof env;
