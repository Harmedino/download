import fs from 'node:fs';
import type { Request } from 'express';
import type { Types } from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { AppError } from '../middleware/errors.js';
import { assertOwns } from '../middleware/owner.js';
import { assertObjectId } from '../middleware/validate.js';
import { FileModel } from '../models/File.js';
import { probe, type MediaInfo } from './ffmpeg.js';
import { isInsideTempDir } from './storage.js';

export const fileExpired = () =>
  new AppError(404, 'FILE_EXPIRED', `That file has expired. Files are kept for ${env.FILE_TTL_MINUTES} minutes; please upload or import it again.`);

type LeanFile = { _id: unknown; jobId?: unknown; path: string; name: string; size: number; mimeType: string; createdAt: Date; ownerHash?: string | null; probe?: unknown };

/** Public JSON for a stored file. */
export function fileView(f: LeanFile) {
  return {
    id: String(f._id),
    name: f.name,
    size: f.size,
    mimeType: f.mimeType,
    url: `/api/files/${String(f._id)}`,
    expiresAt: new Date(new Date(f.createdAt).getTime() + env.FILE_TTL_MINUTES * 60_000),
    info: (f.probe as MediaInfo | null) ?? null,
  };
}

/** Probes a stored file once and caches the result on its record. */
export async function ensureProbe(f: LeanFile): Promise<MediaInfo> {
  if (f.probe) return f.probe as MediaInfo;
  const info = await probe(f.path);
  await FileModel.updateOne({ _id: f._id as Types.ObjectId }, { $set: { probe: info } }).catch((err) => logger.warn({ err }, 'Failed to cache probe'));
  f.probe = info;
  return info;
}

/** Loads a file the requester may use as tool input. Someone else's file looks expired. */
export async function loadOwnFile(req: Request, id: unknown): Promise<LeanFile> {
  const f = await FileModel.findById(assertObjectId(id, 'file id')).lean<LeanFile>();
  if (!f || !isInsideTempDir(f.path) || !fs.existsSync(f.path)) throw fileExpired();
  assertOwns(req, f.ownerHash, fileExpired);
  return f;
}
