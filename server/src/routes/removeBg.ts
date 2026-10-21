import fsp from 'node:fs/promises';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { enqueue } from '../jobs/agenda.js';
import type { RemoveBgParams } from '../jobs/processors/removeBgImage.js';
import type { RemoveBgVideoParams } from '../jobs/processors/removeBgVideo.js';
import { assertDurationAllowed, probeVideo } from '../services/videoBg.js';
import { AppError } from '../middleware/errors.js';
import { assertQueueCapacity } from '../middleware/queueGuard.js';
import { limits } from '../middleware/rateLimit.js';
import { uploadErrors, uploadFor } from '../middleware/upload.js';
import { assertObjectId, parseBody } from '../middleware/validate.js';
import { FileModel } from '../models/File.js';
import { Job } from '../models/Job.js';
import { isInsideTempDir, registerFile } from '../services/storage.js';

export const removeBgRouter = Router();
const imageLimit = limits.removeBgImage();
const videoLimit = limits.removeBgVideo();

const optionsSchema = z.object({
  fileId: z.string().optional(),
  background: z.enum(['transparent', 'color', 'blur', 'image']).default('transparent'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb color')
    .optional(),
  blur: z.coerce.number().int().min(1).max(100).optional(),
});

type UploadedFiles = Record<string, Express.Multer.File[] | undefined>;

/** Resolves the input either from a multipart upload or from a previously downloaded file id. */
async function resolveInput(req: Request, kind: 'image' | 'video') {
  const files = (req.files ?? {}) as UploadedFiles;
  const body = parseBody(optionsSchema, req.body);
  const upload = files['file']?.[0];
  const bgUpload = files['bgImage']?.[0];

  const cleanup = async () => {
    for (const f of [upload, bgUpload]) if (f) await fsp.rm(f.path, { force: true });
  };

  try {
    if (body.background === 'color' && !body.color) throw new AppError(400, 'INVALID_REQUEST', 'Pick a background color.');
    if (body.background === 'image' && !bgUpload) throw new AppError(400, 'INVALID_REQUEST', 'Upload a background image.');

    let inputPath: string;
    let inputName: string;
    if (upload) {
      // Register uploads so the hourly cleanup removes them like any other file.
      await registerFile({ path: upload.path, name: upload.originalname || 'upload', mimeType: upload.mimetype });
      inputPath = upload.path;
      inputName = upload.originalname || 'upload';
    } else if (body.fileId) {
      const file = await FileModel.findById(assertObjectId(body.fileId, 'file id')).lean();
      if (!file || !isInsideTempDir(file.path)) throw new AppError(404, 'FILE_EXPIRED', 'That file has expired. Please download it again.');
      if (!file.mimeType.startsWith(`${kind}/`)) {
        throw new AppError(415, 'UNSUPPORTED_FILE', kind === 'image' ? 'That file is not an image.' : 'That file is not a video.');
      }
      inputPath = file.path;
      inputName = file.name;
    } else {
      throw new AppError(400, 'INVALID_REQUEST', `Upload a${kind === 'image' ? 'n image' : ' video'} or pass a fileId.`);
    }
    if (bgUpload) await registerFile({ path: bgUpload.path, name: bgUpload.originalname || 'background', mimeType: bgUpload.mimetype });

    return { inputPath, inputName, body, bgImagePath: bgUpload?.path };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

removeBgRouter.post('/image', imageLimit, uploadFor('image'), async (req, res) => {
  const { inputPath, inputName, body, bgImagePath } = await resolveInput(req, 'image');
  const params: RemoveBgParams = {
    inputPath,
    inputName,
    background: body.background,
    color: body.color,
    blur: body.blur,
    bgImagePath,
  };
  await assertQueueCapacity('remove-bg-image').catch(async (err) => {
    await fsp.rm(inputPath, { force: true }).catch(() => undefined);
    throw err;
  });
  const job = await Job.create({ type: 'remove-bg-image', params });
  await enqueue('remove-bg-image', job._id);
  res.status(202).json({ jobId: job._id });
});

removeBgRouter.post('/video', videoLimit, uploadFor('video'), async (req, res) => {
  const { inputPath, inputName, body, bgImagePath } = await resolveInput(req, 'video');
  const uploaded = !!(req.files as UploadedFiles | undefined)?.['file']?.[0];
  try {
    if (body.background !== 'transparent' && body.background !== 'color') {
      throw new AppError(400, 'INVALID_REQUEST', 'Video backgrounds can be transparent or a solid color.');
    }
    // Probe now so an over-long clip is rejected immediately instead of after queueing.
    assertDurationAllowed(await probeVideo(inputPath));
    await assertQueueCapacity('remove-bg-video');
  } catch (err) {
    if (uploaded) await fsp.rm(inputPath, { force: true });
    if (bgImagePath) await fsp.rm(bgImagePath, { force: true });
    throw err;
  }
  const params: RemoveBgVideoParams = { inputPath, inputName, background: body.background, color: body.color };
  const job = await Job.create({ type: 'remove-bg-video', params });
  await enqueue('remove-bg-video', job._id);
  res.status(202).json({ jobId: job._id });
});

removeBgRouter.use(uploadErrors);

export { resolveInput };
