import type { Types } from 'mongoose';
import { logger } from '../logger.js';
import { updateJob } from '../models/Job.js';

/** Returns a progress reporter that writes to MongoDB at most every 750 ms and only when the value moves. */
export function progressReporter(jobId: Types.ObjectId | string, from = 0, to = 100) {
  let lastPct = -1;
  let lastAt = 0;
  let lastStage: string | null = null;
  return (pct: number, stage?: string) => {
    const scaled = Math.round(from + ((to - from) * Math.max(0, Math.min(100, pct))) / 100);
    const now = Date.now();
    const stageChanged = stage !== undefined && stage !== lastStage;
    if (!stageChanged && (scaled <= lastPct || now - lastAt < 750)) return;
    lastPct = scaled;
    lastAt = now;
    if (stage !== undefined) lastStage = stage;
    updateJob(jobId, { progress: scaled, ...(stage !== undefined ? { stage } : {}) }).catch((err) =>
      logger.warn({ err }, 'progress update failed'),
    );
  };
}

export async function failJob(jobId: Types.ObjectId | string, err: unknown): Promise<void> {
  const e = err as { status?: number; code?: string; message?: string };
  const known = typeof e?.code === 'string' && typeof e?.status === 'number';
  if (!known || (e.status ?? 500) >= 500) logger.error({ err, jobId: String(jobId) }, 'Job failed');
  await updateJob(jobId, {
    status: 'failed',
    stage: null,
    error: known
      ? { code: e.code!, message: e.message ?? 'Job failed' }
      : { code: 'JOB_FAILED', message: 'Something went wrong while processing. Please try again.' },
  });
}
