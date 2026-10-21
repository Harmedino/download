import { Router } from 'express';
import { enqueue } from '../jobs/agenda.js';
import { AppError } from '../middleware/errors.js';
import { assertQueueCapacity } from '../middleware/queueGuard.js';
import { parseBody } from '../middleware/validate.js';
import { Job, isMediaJobType } from '../models/Job.js';
import { ensureProbe, loadOwnFile } from '../services/mediaFiles.js';
import { TOOLS } from '../tools/index.js';
import type { ToolInput } from '../tools/types.js';

export const toolsRouter = Router();

/** Which tools this server offers (the client hides the rest). */
export function availableTools(): string[] {
  return Object.keys(TOOLS);
}

/**
 * Starts a media tool job: POST /api/tools/convert { fileId, format, ... } -> 202 { jobId }.
 * Inputs must be files this browser uploaded or downloaded; they are probed and checked before queueing.
 */
toolsRouter.post('/:type', async (req, res) => {
  const type = String(req.params.type);
  const tool = isMediaJobType(type) ? TOOLS[type] : undefined;
  if (!isMediaJobType(type) || !tool) throw new AppError(404, 'TOOL_UNAVAILABLE', 'That tool does not exist.');

  const params = parseBody(tool.schema, req.body);
  tool.requires?.(params);
  const ids = tool.fileIds(params);
  const inputs: ToolInput[] = [];
  let origin: { sourceType?: 'upload' | 'link' | 'direct' | null; platform?: string | null; sourceUrl?: string | null } | null = null;
  for (const id of ids) {
    const f = await loadOwnFile(req, id);
    // History shows where the media came from; outputs of earlier jobs inherit their source.
    if (!inputs.length && f.jobId) origin = await Job.findById(f.jobId, { sourceType: 1, platform: 1, sourceUrl: 1 }).lean();
    const info = await ensureProbe(f);
    if (!tool.accepts.includes(info.kind)) {
      throw new AppError(415, 'UNSUPPORTED_FILE', `This tool works with ${tool.accepts.join(' or ')} files, but "${f.name}" is ${info.kind === 'audio' ? 'audio only' : `an ${info.kind}`}.`);
    }
    inputs.push({ id: String(f._id), path: f.path, name: f.name, info });
  }
  tool.validate?.(params, inputs);

  await assertQueueCapacity(type, req.ownerHash);
  const first = inputs[0];
  const job = await Job.create({
    type,
    params,
    ownerHash: req.ownerHash ?? null,
    title: first ? (inputs.length > 1 ? `${first.name} + ${inputs.length - 1} more` : first.name) : type,
    sourceType: origin?.sourceType ?? 'upload',
    platform: origin?.platform ?? null,
    sourceUrl: origin?.sourceUrl ?? null,
    summary: tool.summary(params, inputs),
    inputFiles: inputs.map((i) => i.id),
  });
  await enqueue('media', job._id);
  res.status(202).json({ jobId: job._id });
});
