import { Schema, model, type InferSchemaType, Types } from 'mongoose';
import { randomObjectId } from './ids.js';

export const JOB_TYPES = ['fetch', 'download', 'remove-bg-image'] as const;
export const JOB_STATUSES = ['queued', 'processing', 'done', 'failed'] as const;
export type JobType = (typeof JOB_TYPES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];

const jobSchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, default: randomObjectId },
    type: { type: String, enum: JOB_TYPES, required: true },
    status: { type: String, enum: JOB_STATUSES, default: 'queued', index: true },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    /** Short human-readable stage, e.g. "Removing background (12/120)". */
    stage: { type: String, default: null },
    sourceUrl: { type: String, default: null },
    platform: { type: String, default: null },
    /** Validated request parameters the processor needs (formatId, itemIndex, background, ...). */
    params: { type: Schema.Types.Mixed, default: {} },
    outputFiles: [{ type: Schema.Types.ObjectId, ref: 'File' }],
    error: {
      type: new Schema({ code: String, message: String }, { _id: false }),
      default: null,
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'jobs', versionKey: false },
);

// Job records are only useful while their files exist; keep them a day for debugging.
jobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export type JobAttrs = InferSchemaType<typeof jobSchema>;
export const Job = model('Job', jobSchema);
export type JobDoc = InstanceType<typeof Job>;

export async function updateJob(
  id: Types.ObjectId | string,
  patch: Partial<Pick<JobAttrs, 'status' | 'progress' | 'stage' | 'error'>> & { outputFiles?: Types.ObjectId[] },
): Promise<void> {
  await Job.updateOne({ _id: id }, { $set: { ...patch, updatedAt: new Date() } });
}
