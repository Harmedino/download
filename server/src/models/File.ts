import { Schema, model, type InferSchemaType } from 'mongoose';
import { env } from '../config/env.js';

const fileSchema = new Schema(
  {
    path: { type: String, required: true },
    /** Filename offered to the browser in Content-Disposition. */
    name: { type: String, required: true },
    size: { type: Number, required: true },
    mimeType: { type: String, required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', default: null },
    createdAt: { type: Date, default: Date.now, expires: Math.round(env.FILE_TTL_MINUTES * 60) },
  },
  { collection: 'files', versionKey: false },
);

export type FileAttrs = InferSchemaType<typeof fileSchema>;
export const FileModel = model('File', fileSchema);
export type FileDoc = InstanceType<typeof FileModel>;
