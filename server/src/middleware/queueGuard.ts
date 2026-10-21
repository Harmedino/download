import { AppError } from './errors.js';
import { Job, MEDIA_JOB_TYPES, isMediaJobType, type JobType } from '../models/Job.js';

/** Max jobs of each type waiting or running at once, across all users. Keeps one burst from queuing hours of CPU work. */
export const QUEUE_LIMITS = {
  download: 30,
  'remove-bg-image': 20,
  /** All video tools together. */
  media: 20,
};
/** Video jobs one browser may have waiting or running, so one person can't fill the queue. */
export const PER_OWNER_MEDIA_LIMIT = 4;

const busy = () =>
  new AppError(503, 'SERVER_BUSY', 'SnapGrab is busy right now. Please try again in a few minutes.', { retryAfterSeconds: 120 });

export async function assertQueueCapacity(type: Exclude<JobType, 'fetch'>, ownerHash?: string | null): Promise<void> {
  const active = { $in: ['queued', 'processing'] as Array<'queued' | 'processing'> };
  if (!isMediaJobType(type)) {
    if ((await Job.countDocuments({ type, status: active })) >= QUEUE_LIMITS[type]) throw busy();
    return;
  }
  if ((await Job.countDocuments({ type: { $in: MEDIA_JOB_TYPES }, status: active })) >= QUEUE_LIMITS.media) throw busy();
  if (ownerHash && (await Job.countDocuments({ ownerHash, type: { $in: MEDIA_JOB_TYPES }, status: active })) >= PER_OWNER_MEDIA_LIMIT) {
    throw new AppError(429, 'TOO_MANY_JOBS', `You already have ${PER_OWNER_MEDIA_LIMIT} videos processing. Wait for one to finish, then try again.`, {
      retryAfterSeconds: 60,
    });
  }
}
