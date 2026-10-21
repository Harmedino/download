import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import type { Types } from 'mongoose';
import { env } from '../config/env.js';
import { FileModel, type FileDoc } from '../models/File.js';

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  zip: 'application/zip',
  avi: 'video/x-msvideo',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json',
};

export function mimeFromPath(p: string): string {
  return MIME[path.extname(p).slice(1).toLowerCase()] ?? 'application/octet-stream';
}

export const uploadsDir = () => path.join(env.TEMP_DIR, 'uploads');

export async function jobDir(jobId: Types.ObjectId | string): Promise<string> {
  const dir = path.join(env.TEMP_DIR, 'jobs', String(jobId));
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

export async function ensureStorageDirs(): Promise<void> {
  await fsp.mkdir(path.join(env.TEMP_DIR, 'jobs'), { recursive: true });
  await fsp.mkdir(uploadsDir(), { recursive: true });
}

/** True if `p` resolves to a location inside TEMP_DIR (defence against path traversal). */
export function isInsideTempDir(p: string): boolean {
  const rel = path.relative(env.TEMP_DIR, path.resolve(p));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Produces a filesystem- and header-safe download name, e.g. "My clip_720p.mp4". */
export function safeFileName(base: string, ext: string): string {
  const cleaned = base
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*#%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .replace(/[. ]+$/, '');
  const e = ext.replace(/^\./, '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  return `${cleaned || 'snapgrab'}.${e}`;
}

const IGNORED = /\.(part|ytdl|temp|tmp)$|^\./i;

/** Finished files in a job directory (skips partial downloads), sorted by name. */
export async function listOutputFiles(dir: string): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && !IGNORED.test(e.name))
    .map((e) => path.join(dir, e.name))
    .sort();
}

export async function registerFile(opts: {
  path: string;
  name: string;
  jobId?: Types.ObjectId | string | null;
  mimeType?: string;
  ownerHash?: string | null;
  probe?: unknown;
}): Promise<FileDoc> {
  const stat = await fsp.stat(opts.path);
  return FileModel.create({
    path: opts.path,
    name: opts.name,
    size: stat.size,
    mimeType: opts.mimeType ?? mimeFromPath(opts.path),
    jobId: opts.jobId ?? null,
    ownerHash: opts.ownerHash ?? null,
    probe: opts.probe ?? null,
  });
}

/** Deletes a file's bytes (only inside TEMP_DIR) and its record. */
export async function deleteStoredFile(file: { _id: Types.ObjectId | unknown; path: string }): Promise<void> {
  if (isInsideTempDir(file.path)) await fsp.rm(file.path, { force: true }).catch(() => undefined);
  await FileModel.deleteOne({ _id: file._id as Types.ObjectId });
}

export function zipFiles(files: Array<{ path: string; name: string }>, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    // Media is already compressed; storing avoids burning CPU for ~0% gain.
    const archive = new ZipArchive({ store: true });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const f of files) archive.file(f.path, { name: f.name });
    void archive.finalize();
  });
}

/** Removes files/dirs under TEMP_DIR whose mtime is older than the TTL. Returns how many entries were removed. */
export async function sweepTempDir(maxAgeMs: number, now = Date.now()): Promise<number> {
  let removed = 0;
  for (const sub of ['jobs', 'uploads']) {
    const dir = path.join(env.TEMP_DIR, sub);
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      try {
        const st = await fsp.stat(p);
        if (now - st.mtimeMs > maxAgeMs) {
          await fsp.rm(p, { recursive: true, force: true });
          removed++;
        }
      } catch {
        /* already gone */
      }
    }
  }
  return removed;
}
