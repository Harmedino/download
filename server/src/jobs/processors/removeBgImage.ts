import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Job as AgendaJob } from 'agenda';
import { Job, updateJob } from '../../models/Job.js';
import { removeImageBackground, type BackgroundMode } from '../../services/bgremove.js';
import { jobDir, registerFile, safeFileName } from '../../services/storage.js';
import { failJob } from '../helpers.js';

export interface RemoveBgParams {
  inputPath: string;
  inputName: string;
  background: BackgroundMode;
  color?: string;
  blur?: number;
  bgImagePath?: string;
}

export async function processRemoveBgImage(agendaJob: AgendaJob<{ jobId: string }>): Promise<void> {
  const { jobId } = agendaJob.attrs.data;
  const job = await Job.findById(jobId);
  if (!job || job.status === 'done') return;

  try {
    const p = job.params as RemoveBgParams;
    await updateJob(jobId, { status: 'processing', progress: 10, stage: 'Removing background', error: null });
    const { transparentPng, finalPng } = await removeImageBackground(p.inputPath, {
      mode: p.background,
      color: p.color,
      blur: p.blur,
      imagePath: p.bgImagePath,
    });
    await updateJob(jobId, { progress: 90, stage: 'Saving' });

    const dir = await jobDir(jobId);
    const base = path.parse(p.inputName).name || 'image';
    const outputs: Array<{ buf: Buffer; name: string }> = [];
    // The composited result comes first; the transparent cutout is always included so the
    // client can try other backgrounds without another server round-trip.
    if (p.background !== 'transparent') outputs.push({ buf: finalPng, name: `${base}_${p.background}` });
    outputs.push({ buf: transparentPng, name: `${base}_transparent` });

    const ids = [];
    for (const [i, o] of outputs.entries()) {
      const filePath = path.join(dir, `${i}.png`);
      await fsp.writeFile(filePath, o.buf);
      const f = await registerFile({ path: filePath, name: safeFileName(o.name, 'png'), jobId: job._id, mimeType: 'image/png', ownerHash: job.ownerHash });
      ids.push(f._id);
    }
    await updateJob(jobId, { status: 'done', progress: 100, stage: null, outputFiles: ids });
  } catch (err) {
    await failJob(jobId, err);
  }
}
