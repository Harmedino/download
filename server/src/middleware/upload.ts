import crypto from 'node:crypto';
import path from 'node:path';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { env } from '../config/env.js';
import { uploadsDir } from '../services/storage.js';
import { AppError } from './errors.js';

const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|avif|heic|heif|tiff|bmp)$/;
const VIDEO_TYPES = /^video\/(mp4|webm|quicktime|x-matroska|x-m4v|3gpp|ogg)$/;

function makeUpload(kind: 'image' | 'video') {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadsDir()),
      // Random names only: the client's filename never touches the filesystem.
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6);
        cb(null, `${crypto.randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 2, fields: 10, fieldSize: 1024 },
    fileFilter: (_req, file, cb) => {
      // A custom background image is always an image, even on the video endpoint.
      const allowed = file.fieldname === 'bgImage' || kind === 'image' ? IMAGE_TYPES : VIDEO_TYPES;
      if (allowed.test(file.mimetype)) cb(null, true);
      else cb(new AppError(415, 'UNSUPPORTED_FILE', kind === 'image' ? 'Please upload a JPG, PNG or WebP image.' : 'Please upload an MP4, WebM or MOV video.'));
    },
  });
}

/** Accepts multipart uploads (field "file", optional "bgImage"); JSON bodies pass straight through. */
export function uploadFor(kind: 'image' | 'video'): RequestHandler {
  const mw = makeUpload(kind).fields([
    { name: 'file', maxCount: 1 },
    { name: 'bgImage', maxCount: 1 },
  ]);
  return (req, res, next) => (req.is('multipart/form-data') ? mw(req, res, next) : next());
}

/** Turns multer's errors into the API's error shape. */
export const uploadErrors: ErrorRequestHandler = (err, _req, _res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'UPLOAD_TOO_LARGE', `Files must be ${env.MAX_UPLOAD_MB} MB or smaller.`));
    return next(new AppError(400, 'INVALID_UPLOAD', 'That upload could not be processed.'));
  }
  next(err);
};
