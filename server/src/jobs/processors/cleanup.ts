import fsp from 'node:fs/promises';
import { env } from '../../config/env.js';
import { logger } from '../../logger.js';
import { FileModel } from '../../models/File.js';
import { isInsideTempDir, sweepTempDir } from '../../services/storage.js';

/**
 * MongoDB's TTL index removes `files` documents after an hour, but not the bytes on disk.
 * This job deletes expired files it still knows about, then sweeps anything left in TEMP_DIR
 * (including files whose documents the TTL monitor already removed).
 */
export async function processCleanup(): Promise<void> {
  const ttlMs = env.FILE_TTL_MINUTES * 60_000;
  const cutoff = new Date(Date.now() - ttlMs);
  const expired = await FileModel.find({ createdAt: { $lt: cutoff } }, { path: 1 }).lean();
  for (const f of expired) {
    if (isInsideTempDir(f.path)) await fsp.rm(f.path, { force: true }).catch(() => undefined);
  }
  if (expired.length) await FileModel.deleteMany({ _id: { $in: expired.map((f) => f._id) } });
  const swept = await sweepTempDir(ttlMs);
  if (expired.length || swept) logger.info({ files: expired.length, swept }, 'Cleanup removed expired files');
}
