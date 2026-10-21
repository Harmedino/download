import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request } from 'express';
import { env } from '../config/env.js';
import { enqueue, queueFor } from '../jobs/agenda.js';
import { AppError } from '../middleware/errors.js';
import { assertOwns, requireOwner } from '../middleware/owner.js';
import { assertQueueCapacity } from '../middleware/queueGuard.js';
import { assertObjectId } from '../middleware/validate.js';
import { FileModel } from '../models/File.js';
import { Job, type JobDoc } from '../models/Job.js';
import { fileView } from '../services/mediaFiles.js';
import { deleteStoredFile, isInsideTempDir } from '../services/storage.js';

export const jobsRouter = Router();

const notFound = () => new AppError(404, 'JOB_NOT_FOUND', 'This job has expired or does not exist.');

type LeanJob = Pick<JobDoc, '_id' | 'type' | 'status' | 'progress' | 'stage' | 'platform' | 'error' | 'createdAt' | 'updatedAt' | 'outputFiles' | 'inputFiles'> & {
  ownerHash?: string | null;
  title?: string | null;
  sourceType?: string | null;
  sourceUrl?: string | null;
  summary?: { format?: string | null; resolution?: string | null } | null;
  result?: unknown;
  warnings?: string[];
};

/** JSON for one job, with the output files that still exist. Shared by /api/jobs/:id and /api/history. */
export async function jobView(job: LeanJob, filesById?: Map<string, Parameters<typeof fileView>[0]>) {
  let files: Array<Parameters<typeof fileView>[0]> = [];
  if (job.outputFiles?.length) {
    files = filesById
      ? job.outputFiles.map((id) => filesById.get(String(id))).filter((f) => !!f)
      : await FileModel.find({ _id: { $in: job.outputFiles } }).lean();
  }
  const ordered = job.outputFiles?.map((id) => files.find((f) => String(f._id) === String(id))).filter((f) => !!f) ?? [];
  return {
    id: job._id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    stage: job.stage ?? null,
    platform: job.platform ?? null,
    error: job.error ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    title: job.title ?? null,
    sourceType: job.sourceType ?? null,
    sourceUrl: job.sourceUrl ?? null,
    summary: job.summary ?? null,
    result: job.result ?? null,
    warnings: job.warnings ?? [],
    /** Failed jobs can be retried while their inputs still exist. */
    retryable: job.status === 'failed' && job.type !== 'fetch',
    files: ordered.map((f) => fileView(f)),
  };
}

jobsRouter.get('/:id', async (req, res) => {
  const id = assertObjectId(req.params.id, 'job id');
  const job = await Job.findById(id).lean<LeanJob>();
  if (!job) throw notFound();
  res.set('Cache-Control', 'no-store');
  res.json(await jobView(job));
});

async function loadOwnJob(req: Request, id: unknown) {
  requireOwner(req);
  const job = await Job.findById(assertObjectId(id, 'job id'));
  if (!job) throw notFound();
  // Jobs without an owner predate history and can't be managed from a browser.
  if (!job.ownerHash) throw notFound();
  assertOwns(req, job.ownerHash, notFound);
  return job;
}

/** Runs a failed job again with the same settings. */
jobsRouter.post('/:id/retry', async (req, res) => {
  const job = await loadOwnJob(req, req.params.id);
  if (job.status !== 'failed' || job.type === 'fetch') throw new AppError(409, 'NOT_RETRYABLE', 'Only failed jobs can be retried.');
  if (job.inputFiles?.length) {
    const inputs = await FileModel.find({ _id: { $in: job.inputFiles } }, { path: 1 }).lean();
    if (inputs.length !== job.inputFiles.length || inputs.some((f) => !isInsideTempDir(f.path) || !fs.existsSync(f.path))) {
      throw new AppError(410, 'FILE_EXPIRED', `The original file has been deleted (files are kept for ${env.FILE_TTL_MINUTES} minutes). Upload or import it again.`);
    }
  }
  await assertQueueCapacity(job.type as Exclude<typeof job.type, 'fetch'>, job.ownerHash);
  await Job.updateOne(
    { _id: job._id, status: 'failed' },
    { $set: { status: 'queued', progress: 0, stage: null, error: null, outputFiles: [], updatedAt: new Date() }, $inc: { attempts: 1 } },
  );
  await enqueue(queueFor(job.type as Exclude<typeof job.type, 'fetch'>), job._id);
  res.status(202).json({ jobId: job._id });
});

/** Deletes a job and its output files from the server. Running jobs can't be deleted mid-encode. */
export async function deleteJob(job: JobDoc): Promise<void> {
  const files = await FileModel.find({ jobId: job._id }, { path: 1 }).lean();
  for (const f of files) await deleteStoredFile(f);
  const dir = path.join(env.TEMP_DIR, 'jobs', String(job._id));
  if (isInsideTempDir(dir)) await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  await Job.deleteOne({ _id: job._id });
}

jobsRouter.delete('/:id', async (req, res) => {
  const job = await loadOwnJob(req, req.params.id);
  if (job.status === 'processing') throw new AppError(409, 'JOB_RUNNING', 'This job is still processing. Delete it once it finishes.');
  await deleteJob(job);
  res.status(204).end();
});
