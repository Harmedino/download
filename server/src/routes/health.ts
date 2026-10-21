import { Router } from 'express';
import { mongoState } from '../db/mongoose.js';
import { binaryStatus, type BinaryName } from '../services/binaries.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const mongo = mongoState();
  const names: BinaryName[] = ['yt-dlp', 'gallery-dl', 'ffmpeg', 'ffprobe'];
  const binaries = Object.fromEntries(
    names.map((n) => {
      const s = binaryStatus(n);
      return [n, s ? { available: s.available, version: s.version ?? null } : { available: false, version: null }];
    }),
  );
  const ok = mongo === 'connected';
  res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', mongo, binaries, uptime: Math.round(process.uptime()) });
});
