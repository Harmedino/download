import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:4200'),
  TEMP_DIR: z.string().default('./tmp'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(50),
  YTDLP_PATH: z.string().default('yt-dlp'),
  GALLERYDL_PATH: z.string().default('gallery-dl'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
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
