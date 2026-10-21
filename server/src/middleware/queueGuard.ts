import { AppError } from './errors.js';
import { Job, type JobType } from '../models/Job.js';

/** Max jobs of each type waiting or running at once, across all users. Keeps one burst from queuing hours of CPU work. */
export const QUEUE_LIMITS: Record<Exclude<JobType, 'fetch'>, number> = {
  download: 30,
  'remove-bg-image': 20,
  'remove-bg-video': 4,
};

export async function assertQueueCapacity(type: Exclude<JobType, 'fetch'>): Promise<void> {
  const active = await Job.countDocuments({ type, status: { $in: ['queued', 'processing'] } });
  if (active >= QUEUE_LIMITS[type]) {
    throw new AppError(503, 'SERVER_BUSY', 'SnapGrab is busy right now. Please try again in a few minutes.', { retryAfterSeconds: 120 });
  }
}
