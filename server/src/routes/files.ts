import fs from 'node:fs';
import { Router } from 'express';
import { create as contentDisposition } from 'content-disposition';
import { AppError } from '../middleware/errors.js';
import { assertObjectId } from '../middleware/validate.js';
import { FileModel } from '../models/File.js';
import { isInsideTempDir } from '../services/storage.js';

export const filesRouter = Router();

// Types a browser may render inline for previews. Everything else is always an attachment.
const INLINE_SAFE = /^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime|x-matroska)|audio\/(mpeg|mp4|ogg|wav)|text\/vtt)$/;

filesRouter.get('/:id', async (req, res) => {
  const id = assertObjectId(req.params.id, 'file id');
  const file = await FileModel.findById(id).lean();
  const gone = () => new AppError(404, 'FILE_EXPIRED', 'This file has expired. Files are kept for a limited time; please download it again.');
  if (!file || !isInsideTempDir(file.path) || !fs.existsSync(file.path)) throw gone();

  const inline = req.query.inline === '1' && INLINE_SAFE.test(file.mimeType);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', contentDisposition(file.name, { type: inline ? 'inline' : 'attachment' }));
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // sendFile handles Range requests, which video previews need for seeking.
  res.sendFile(file.path, { dotfiles: 'allow' }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: { code: 'FILE_EXPIRED', message: gone().message } });
  });
});
