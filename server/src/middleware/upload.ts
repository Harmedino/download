import crypto from 'node:crypto';
import path from 'node:path';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { env } from '../config/env.js';
import { uploadsDir } from '../services/storage.js';
import { AppError } from './errors.js';

const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|avif|heic|heif|tiff|bmp)$/;

function makeUpload() {
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
      if (IMAGE_TYPES.test(file.mimetype)) cb(null, true);
      else cb(new AppError(415, 'UNSUPPORTED_FILE', 'Please upload a JPG, PNG or WebP image.'));
    },
  });
}

/** Accepts multipart uploads (field "file", optional "bgImage"); JSON bodies pass straight through. */
export function uploadImage(): RequestHandler {
  const mw = makeUpload().fields([
    { name: 'file', maxCount: 1 },
    { name: 'bgImage', maxCount: 1 },
  ]);
  return (req, res, next) => (req.is('multipart/form-data') ? mw(req, res, next) : next());
}

const MEDIA_TYPES = /^(video|audio|image)\//;
const MEDIA_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|mp3|m4a|wav|flac|ogg|opus|aac|jpe?g|png|webp|gif)$/i;

/** Accepts one video, audio or image upload in field "file" (ffprobe checks the bytes afterwards). */
export function uploadMedia(): RequestHandler {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadsDir()),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6);
        cb(null, `${crypto.randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: env.MAX_MEDIA_UPLOAD_BYTES, files: 1, fields: 10, fieldSize: 1024 },
    fileFilter: (_req, file, cb) => {
      if (MEDIA_TYPES.test(file.mimetype) || MEDIA_EXT.test(file.originalname)) cb(null, true);
      else cb(new AppError(415, 'UNSUPPORTED_FILE', 'Please upload a video (MP4, MOV, WebM, MKV), an audio file or an image.'));
    },
  }).single('file');
}

/** Turns multer's errors into the API's error shape. */
export const uploadErrors: ErrorRequestHandler = (err, _req, _res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const mb = _req.baseUrl.startsWith('/api/media') ? env.MAX_MEDIA_UPLOAD_MB : env.MAX_UPLOAD_MB;
      return next(new AppError(413, 'UPLOAD_TOO_LARGE', `Files must be ${mb} MB or smaller.`));
    }
    return next(new AppError(400, 'INVALID_UPLOAD', 'That upload could not be processed.'));
  }
  next(err);
};
