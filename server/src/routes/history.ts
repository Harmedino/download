import { Router } from 'express';
import { requireOwner } from '../middleware/owner.js';
import { FileModel } from '../models/File.js';
import { Job } from '../models/Job.js';
import { deleteJob, jobView } from './jobs.js';

export const historyRouter = Router();

/** This browser's jobs (downloads, edits, exports), newest first. Nothing here is visible to anyone else. */
historyRouter.get('/', async (req, res) => {
  const ownerHash = requireOwner(req);
  const jobs = await Job.find({ ownerHash, type: { $ne: 'fetch' } }, { params: 0 })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  const fileIds = jobs.flatMap((j) => j.outputFiles ?? []);
  const files = fileIds.length ? await FileModel.find({ _id: { $in: fileIds } }).lean() : [];
  const byId = new Map(files.map((f) => [String(f._id), f]));
  res.set('Cache-Control', 'no-store');
  res.json({ jobs: await Promise.all(jobs.map((j) => jobView(j, byId))) });
});

/** Deletes every finished or failed job of this browser, with its files. */
historyRouter.delete('/', async (req, res) => {
  const ownerHash = requireOwner(req);
  const jobs = await Job.find({ ownerHash, status: { $ne: 'processing' } });
  for (const j of jobs) await deleteJob(j);
  res.json({ deleted: jobs.length });
});
