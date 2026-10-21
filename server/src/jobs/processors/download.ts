import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Job as AgendaJob } from 'agenda';
import { AppError } from '../../middleware/errors.js';
import { Job, updateJob } from '../../models/Job.js';
import { galleryDlDownload } from '../../services/gallerydl.js';
import { getMetadata } from '../../services/media.js';
import type { QualityPreset } from '../../services/media.types.js';
import { env } from '../../config/env.js';
import { validateMedia } from '../../services/ffmpeg.js';
import { downloadToFile } from '../../services/safeFetch.js';
import type { SourcePlatform } from '../../services/sources.js';
import { jobDir, listOutputFiles, registerFile, safeFileName, zipFiles } from '../../services/storage.js';
import { ytdlpDownload } from '../../services/ytdlp.js';
import { failJob, progressReporter } from '../helpers.js';

export interface DownloadParams {
  formatId?: QualityPreset;
  itemIndex?: number;
  audioOnly?: boolean;
  zip?: boolean;
}

export async function processDownload(agendaJob: AgendaJob<{ jobId: string }>): Promise<void> {
  const { jobId } = agendaJob.attrs.data;
  const job = await Job.findById(jobId);
  if (!job || job.status === 'done') return;

  try {
    await updateJob(jobId, { status: 'processing', progress: 1, stage: 'Starting download', error: null });
    const params = (job.params ?? {}) as DownloadParams;
    const url = job.sourceUrl!;
    const { metadata: meta } = await getMetadata(url, job.platform as SourcePlatform);
    const outDir = await jobDir(jobId);
    // A retry must not pick up a previous attempt's partial files.
    for (const f of await fsp.readdir(outDir)) await fsp.rm(path.join(outDir, f), { recursive: true, force: true });
    const report = progressReporter(jobId, 0, params.zip ? 90 : 98);
    const isMulti = meta.items.length > 1;

    if (meta.extractor === 'direct') {
      const ext = meta.items[0]?.ext ?? 'bin';
      const dest = path.join(outDir, `media.${ext}`);
      await downloadToFile(url, dest, { maxBytes: env.MAX_DOWNLOAD_MB * 1024 * 1024, onProgress: (p) => report(p, 'Downloading') });
      report(100, 'Checking file');
      // The bytes must really be media of a format we allow, whatever the server claimed.
      await validateMedia(dest).catch(async (err) => {
        await fsp.rm(dest, { force: true });
        throw err;
      });
    } else if (meta.extractor === 'gallery-dl') {
      report(10, 'Downloading');
      await galleryDlDownload({ url, outDir, itemIndex: params.zip ? undefined : (params.itemIndex ?? (isMulti ? 0 : undefined)) });
    } else {
      await ytdlpDownload({
        url,
        outDir,
        preset: params.formatId,
        portrait: meta.portrait,
        audioOnly: params.audioOnly,
        allItems: params.zip,
        itemIndex: params.zip ? undefined : isMulti ? (params.itemIndex ?? 0) : undefined,
        onProgress: (p) => report(p, 'Downloading'),
      });
    }

    const produced = await listOutputFiles(outDir);
    if (!produced.length) throw new AppError(404, 'NO_MEDIA', "We couldn't find a downloadable file in this post.");

    let fileIds;
    if (params.zip) {
      report(100, 'Creating ZIP');
      const entries = produced.map((p, i) => ({ path: p, name: `${String(i + 1).padStart(2, '0')}${path.extname(p)}` }));
      const zipName = safeFileName(meta.title, 'zip');
      const zipPath = path.join(outDir, `snapgrab-${jobId}.zip`);
      await zipFiles(entries, zipPath);
      const f = await registerFile({ path: zipPath, name: zipName, jobId: job._id, mimeType: 'application/zip', ownerHash: job.ownerHash });
      fileIds = [f._id];
    } else {
      const suffix = [
        isMulti ? `${(params.itemIndex ?? 0) + 1}` : '',
        params.audioOnly ? '' : params.formatId && params.formatId !== 'best' ? params.formatId : '',
      ]
        .filter(Boolean)
        .join('_');
      const files = await Promise.all(
        produced.map((p, i) =>
          registerFile({
            path: p,
            name: safeFileName(`${meta.title}${suffix ? `_${suffix}` : ''}${produced.length > 1 ? `_${i + 1}` : ''}`, path.extname(p)),
            jobId: job._id,
            ownerHash: job.ownerHash,
          }),
        ),
      );
      fileIds = files.map((f) => f._id);
    }

    await updateJob(jobId, { status: 'done', progress: 100, stage: null, outputFiles: fileIds });
  } catch (err) {
    await failJob(jobId, err);
  }
}
