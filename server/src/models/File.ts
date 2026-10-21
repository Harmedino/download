import { Schema, model, type InferSchemaType } from 'mongoose';
import { env } from '../config/env.js';
import { randomObjectId } from './ids.js';

const fileSchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, default: randomObjectId },
    path: { type: String, required: true },
    /** Filename offered to the browser in Content-Disposition. */
    name: { type: String, required: true },
    size: { type: Number, required: true },
    mimeType: { type: String, required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', default: null },
    /** Same as Job.ownerHash. Files with an owner can only be used as tool input by that browser. */
    ownerHash: { type: String, default: null },
    /** ffprobe summary for media files (see services/ffmpeg.ts MediaInfo). */
    probe: { type: Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now, expires: Math.round(env.FILE_TTL_MINUTES * 60) },
  },
  { collection: 'files', versionKey: false },
);

export type FileAttrs = InferSchemaType<typeof fileSchema>;
export const FileModel = model('File', fileSchema);
export type FileDoc = InstanceType<typeof FileModel>;
