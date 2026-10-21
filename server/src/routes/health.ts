import { Router } from 'express';
import { env } from '../config/env.js';
import { mongoState } from '../db/mongoose.js';
import { binaryStatus, type BinaryName } from '../services/binaries.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const mongo = mongoState();
  const names: BinaryName[] = ['yt-dlp', 'gallery-dl', 'ffmpeg', 'ffprobe'];
  const binaries = Object.fromEntries(
    names.map((n) => {
      const s = binaryStatus(n);
      return [n, { available: !!s?.available }];
    }),
  );
  // Always 200 while the process is up: this is the platform's liveness probe, and a 503 here makes
  // Render pull the instance out of rotation, so the browser can't reach it at all. Readiness is in `status`.
  const ok = mongo === 'connected';
  res.json({ status: ok ? 'ok' : 'degraded', mongo, binaries, allowedOrigins: env.CLIENT_ORIGIN, uptime: Math.round(process.uptime()) });
});
