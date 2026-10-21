import { Schema, model } from 'mongoose';
import type { MediaMetadata } from '../services/media.types.js';

const mediaCacheSchema = new Schema(
  {
    sourceUrl: { type: String, required: true, unique: true },
    platform: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 },
  },
  { collection: 'mediaCache', versionKey: false },
);

export interface MediaCacheAttrs {
  sourceUrl: string;
  platform: string;
  metadata: MediaMetadata;
  createdAt: Date;
}

export const MediaCache = model<MediaCacheAttrs>('MediaCache', mediaCacheSchema);
