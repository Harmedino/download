import { Router } from 'express';
import { AppError } from '../middleware/errors.js';
import { assertObjectId } from '../middleware/validate.js';
import { Job } from '../models/Job.js';
import { FileModel } from '../models/File.js';
import { env } from '../config/env.js';

export const jobsRouter = Router();

jobsRouter.get('/:id', async (req, res) => {
  const id = assertObjectId(req.params.id, 'job id');
  const job = await Job.findById(id).lean();
  if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'This job has expired or does not exist.');
  const files = job.outputFiles?.length ? await FileModel.find({ _id: { $in: job.outputFiles } }).lean() : [];

  res.set('Cache-Control', 'no-store');
  res.json({
    id: job._id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    stage: job.stage ?? null,
    platform: job.platform ?? null,
    error: job.error ?? null,
    createdAt: job.createdAt,
    files: files.map((f) => ({
      id: f._id,
      name: f.name,
      size: f.size,
      mimeType: f.mimeType,
      url: `/api/files/${f._id}`,
      expiresAt: new Date(new Date(f.createdAt).getTime() + env.FILE_TTL_MINUTES * 60_000),
    })),
  });
});
