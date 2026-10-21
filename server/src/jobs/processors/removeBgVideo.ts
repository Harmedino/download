import path from 'node:path';
import type { Job as AgendaJob } from 'agenda';
import { Job, updateJob } from '../../models/Job.js';
import { removeVideoBackground, type VideoBackground } from '../../services/videoBg.js';
import { jobDir, registerFile, safeFileName } from '../../services/storage.js';
import { failJob, progressReporter } from '../helpers.js';

export interface RemoveBgVideoParams {
  inputPath: string;
  inputName: string;
  background: VideoBackground;
  color?: string;
}

export async function processRemoveBgVideo(agendaJob: AgendaJob<{ jobId: string }>): Promise<void> {
  const { jobId } = agendaJob.attrs.data;
  const job = await Job.findById(jobId);
  if (!job || job.status === 'done') return;

  try {
    const p = job.params as RemoveBgVideoParams;
    await updateJob(jobId, { status: 'processing', progress: 1, stage: 'Starting', error: null });
    const report = progressReporter(jobId, 0, 99);
    const workDir = await jobDir(jobId);
    let lastTouch = Date.now();
    const result = await removeVideoBackground({
      inputPath: p.inputPath,
      workDir,
      background: p.background,
      color: p.color,
      onProgress: (pct, stage) => {
        report(pct, stage);
        // Long jobs: renew Agenda's lock so another worker doesn't pick this job up.
        if (Date.now() - lastTouch > 30_000) {
          lastTouch = Date.now();
          void agendaJob.touch().catch(() => undefined);
        }
      },
    });
    const base = path.parse(p.inputName).name || 'video';
    const ext = result.mimeType === 'video/webm' ? 'webm' : 'mp4';
    const file = await registerFile({
      path: result.outputPath,
      name: safeFileName(`${base}_${p.background === 'transparent' ? 'transparent' : 'bg'}`, ext),
      jobId: job._id,
      mimeType: result.mimeType,
    });
    await updateJob(jobId, { status: 'done', progress: 100, stage: null, outputFiles: [file._id] });
  } catch (err) {
    await failJob(jobId, err);
  }
}
