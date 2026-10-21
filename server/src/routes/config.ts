import { Router } from 'express';
import { env } from '../config/env.js';
import { aiStatus } from '../services/ai.js';
import { binaryStatus } from '../services/binaries.js';
import { availableTools } from './tools.js';

export const configRouter = Router();

/** Limits and feature flags the client shows (retention, upload size, which tools work on this server). */
configRouter.get('/', (_req, res) => {
  const ffmpeg = !!binaryStatus('ffmpeg')?.available && !!binaryStatus('ffprobe')?.available;
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    fileTtlMinutes: env.FILE_TTL_MINUTES,
    maxUploadMb: env.MAX_UPLOAD_MB,
    maxMediaUploadMb: env.MAX_MEDIA_UPLOAD_MB,
    maxMediaMinutes: env.MAX_MEDIA_DURATION_MINUTES,
    maxDownloadMb: env.MAX_DOWNLOAD_MB,
    jobTimeoutMinutes: env.JOB_TIMEOUT_MINUTES,
    directUrls: env.DIRECT_URLS_ENABLED,
    tools: ffmpeg ? availableTools() : [],
    /** Which AI services are configured (provider and model only). */
    ai: aiStatus(),
  });
});
