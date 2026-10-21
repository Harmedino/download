import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { Job as AgendaJob } from 'agenda';
import { AppError } from '../../middleware/errors.js';
import { FileModel } from '../../models/File.js';
import { Job, isMediaJobType, updateJob } from '../../models/Job.js';
import { ensureProbe, fileExpired } from '../../services/mediaFiles.js';
import { isInsideTempDir, jobDir, registerFile, safeFileName } from '../../services/storage.js';
import { TOOLS } from '../../tools/index.js';
import type { ToolInput } from '../../tools/types.js';
import { failJob, progressReporter } from '../helpers.js';

/** Runs one ffmpeg/AI tool job: load and check inputs, run the tool, register its outputs. */
export async function processMedia(agendaJob: AgendaJob<{ jobId: string }>): Promise<void> {
  const { jobId } = agendaJob.attrs.data;
  const job = await Job.findById(jobId);
  if (!job || job.status === 'done' || !isMediaJobType(job.type)) return;
  const tool = TOOLS[job.type];
  // Long encodes outlive Agenda's lock; keep it fresh so another worker doesn't start the job again.
  const keepAlive = setInterval(() => void agendaJob.touch().catch(() => undefined), 60_000);

  try {
    if (!tool) throw new AppError(501, 'TOOL_UNAVAILABLE', 'This tool is not available on this server.');
    await updateJob(jobId, { status: 'processing', progress: 0, stage: 'Starting', error: null, warnings: [] });

    const files = await FileModel.find({ _id: { $in: job.inputFiles } }).lean();
    const inputs: ToolInput[] = [];
    for (const id of job.inputFiles) {
      const f = files.find((x) => String(x._id) === String(id));
      if (!f || !isInsideTempDir(f.path) || !fs.existsSync(f.path)) throw fileExpired();
      inputs.push({ id: String(f._id), path: f.path, name: f.name, info: await ensureProbe(f) });
    }

    // A retry starts from a clean directory.
    const outDir = await jobDir(jobId);
    await fsp.rm(outDir, { recursive: true, force: true });
    await fsp.mkdir(outDir, { recursive: true });

    const report = progressReporter(jobId, 0, 98);
    const res = await tool.run({ job, jobId, outDir, inputs, params: tool.schema.parse(job.params), report });

    const ids = [];
    for (const f of res.files) {
      const ext = f.name.split('.').pop() ?? 'bin';
      const doc = await registerFile({ path: f.path, name: safeFileName(f.name.replace(/\.[^.]+$/, ''), ext), jobId: job._id, mimeType: f.mimeType, ownerHash: job.ownerHash });
      ids.push(doc._id);
    }
    await updateJob(jobId, { status: 'done', progress: 100, stage: null, outputFiles: ids, result: res.result ?? null, warnings: res.warnings ?? [] });
  } catch (err) {
    await failJob(jobId, err);
  } finally {
    clearInterval(keepAlive);
  }
}
