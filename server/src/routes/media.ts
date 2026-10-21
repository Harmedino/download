import fsp from 'node:fs/promises';
import { Router } from 'express';
import { AppError } from '../middleware/errors.js';
import { requireOwner } from '../middleware/owner.js';
import { limits } from '../middleware/rateLimit.js';
import { uploadErrors, uploadMedia } from '../middleware/upload.js';
import { validateMedia } from '../services/ffmpeg.js';
import { ensureProbe, fileView, loadOwnFile } from '../services/mediaFiles.js';
import { deleteStoredFile, registerFile } from '../services/storage.js';

export const mediaRouter = Router();

/** Upload a video, audio or image for the editing tools. The file is checked with ffprobe before it is accepted. */
mediaRouter.post('/upload', limits.mediaUpload(), uploadMedia(), async (req, res) => {
  const upload = req.file;
  if (!upload) throw new AppError(400, 'INVALID_UPLOAD', 'Choose a file to upload.');
  try {
    const info = await validateMedia(upload.path);
    const file = await registerFile({
      path: upload.path,
      name: upload.originalname || 'upload',
      mimeType: upload.mimetype && upload.mimetype !== 'application/octet-stream' ? upload.mimetype : undefined,
      ownerHash: req.ownerHash ?? null,
      probe: info,
    });
    res.status(201).json(fileView(file.toObject()));
  } catch (err) {
    await fsp.rm(upload.path, { force: true });
    throw err;
  }
});

/** Media details (duration, size, codecs) for a stored file, e.g. one produced by a link download. */
mediaRouter.get('/:id', async (req, res) => {
  const f = await loadOwnFile(req, req.params.id);
  await ensureProbe(f);
  res.set('Cache-Control', 'no-store');
  res.json(fileView(f));
});

/** Deletes an uploaded or produced file now instead of waiting for automatic cleanup. */
mediaRouter.delete('/:id', async (req, res) => {
  requireOwner(req);
  const f = await loadOwnFile(req, req.params.id);
  if (!f.ownerHash) throw new AppError(403, 'NOT_OWNER', 'Only files created from this browser can be deleted here.');
  await deleteStoredFile(f);
  res.status(204).end();
});

mediaRouter.use(uploadErrors);
