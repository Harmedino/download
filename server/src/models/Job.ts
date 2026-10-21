import { Schema, model, type InferSchemaType, Types } from 'mongoose';
import { randomObjectId } from './ids.js';

/** ffmpeg/AI tools. They all run on the "media" queue. */
export const MEDIA_JOB_TYPES = [
  'edit',
  'convert',
  'compress',
  'gif',
  'frames',
  'thumbnail',
  'shorts',
  'subtitles',
  'burn-subtitles',
  'creator-pack',
] as const;
export const JOB_TYPES = ['fetch', 'download', 'remove-bg-image', ...MEDIA_JOB_TYPES] as const;
export const JOB_STATUSES = ['queued', 'processing', 'done', 'failed'] as const;
export type JobType = (typeof JOB_TYPES)[number];
export type MediaJobType = (typeof MEDIA_JOB_TYPES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];

export function isMediaJobType(t: string): t is MediaJobType {
  return (MEDIA_JOB_TYPES as readonly string[]).includes(t);
}

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
    /** sha256 of the browser's X-Client-Id; scopes history, retry and delete to that browser. */
    ownerHash: { type: String, default: null, index: true },
    /** Display name for history, e.g. the video title or uploaded file name. */
    title: { type: String, default: null },
    /** Where the input came from: an upload, a supported platform, or a direct file link. */
    sourceType: { type: String, enum: ['upload', 'link', 'direct', null], default: null },
    /** What the user picked, shown in history ("MP4", "1080x1920"). */
    summary: {
      type: new Schema({ format: String, resolution: String }, { _id: false }),
      default: null,
    },
    /** Validated request parameters the processor needs (formatId, itemIndex, background, ...). */
    params: { type: Schema.Types.Mixed, default: {} },
    /** Files the job reads; a retry is only possible while they still exist. */
    inputFiles: [{ type: Schema.Types.ObjectId, ref: 'File' }],
    outputFiles: [{ type: Schema.Types.ObjectId, ref: 'File' }],
    /** Tool-specific JSON result (subtitle cues, suggested titles, ...). */
    result: { type: Schema.Types.Mixed, default: null },
    /** Non-fatal problems, e.g. a Creator Pack item that was skipped because AI is not configured. */
    warnings: { type: [String], default: [] },
    attempts: { type: Number, default: 0 },
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
jobSchema.index({ ownerHash: 1, createdAt: -1 });

export type JobAttrs = InferSchemaType<typeof jobSchema>;
export const Job = model('Job', jobSchema);
export type JobDoc = InstanceType<typeof Job>;

export async function updateJob(
  id: Types.ObjectId | string,
  patch: Partial<Pick<JobAttrs, 'status' | 'progress' | 'stage' | 'error' | 'result' | 'warnings' | 'summary'>> & {
    outputFiles?: Types.ObjectId[];
  },
): Promise<void> {
  await Job.updateOne({ _id: id }, { $set: { ...patch, updatedAt: new Date() } });
}
