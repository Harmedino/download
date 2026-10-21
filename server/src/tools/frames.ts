import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AppError } from '../middleware/errors.js';
import { ffmpeg, inputArgs } from '../services/ffmpeg.js';
import { listOutputFiles, zipFiles } from '../services/storage.js';
import { clampRange, fileId, requireVideo, seconds, ts } from './common.js';
import { baseName, defineTool, resolutionOf, type ToolOutputFile } from './types.js';

export const IMAGE_FORMATS = ['jpg', 'png', 'webp'] as const;
type ImageFormat = (typeof IMAGE_FORMATS)[number];

const schema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('single'), fileId, times: z.array(seconds).min(1).max(20), format: z.enum(IMAGE_FORMATS).default('jpg') }),
  z.object({
    mode: z.literal('interval'),
    fileId,
    start: seconds.default(0),
    end: seconds.optional(),
    every: z.number().min(0.1).max(3600),
    max: z.number().int().min(1).max(100).default(30),
    format: z.enum(IMAGE_FORMATS).default('jpg'),
  }),
  z.object({
    mode: z.literal('contact'),
    fileId,
    start: seconds.default(0),
    end: seconds.optional(),
    columns: z.number().int().min(2).max(8).default(4),
    rows: z.number().int().min(1).max(10).default(4),
    tileWidth: z.number().int().min(120).max(640).default(320),
    format: z.enum(IMAGE_FORMATS).default('jpg'),
  }),
]);

/** Encoder flags for still images at high quality. */
export function imageArgs(format: ImageFormat): string[] {
  if (format === 'jpg') return ['-c:v', 'mjpeg', '-q:v', '2', '-pix_fmt', 'yuvj444p'];
  if (format === 'webp') return ['-c:v', 'libwebp', '-quality', '92'];
  return ['-c:v', 'png'];
}

export const MIME: Record<ImageFormat, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Grabs one full-resolution frame at `t` seconds. Shared with the Creator Pack. */
export async function grabFrame(input: string, t: number, out: string, format: ImageFormat): Promise<void> {
  await ffmpeg([...inputArgs(input, ['-ss', ts(t)]), '-frames:v', '1', '-update', '1', ...imageArgs(format), out], { timeoutMs: 120_000 });
}

export const framesTool = defineTool({
  schema,
  accepts: ['video'],
  fileIds: (p) => [p.fileId],
  summary(p, [input]) {
    const i = input!.info;
    const what = p.mode === 'single' ? `${p.times.length} frame(s)` : p.mode === 'interval' ? `every ${p.every}s` : `${p.columns}×${p.rows} contact sheet`;
    return { format: `${p.format.toUpperCase()} · ${what}`, resolution: p.mode === 'contact' ? `${p.tileWidth * p.columns}px wide` : resolutionOf(i.width, i.height) };
  },
  async run({ inputs: [input], params: p, outDir, report }) {
    const i = requireVideo(input!);
    const base = baseName(input!.name);
    const files: ToolOutputFile[] = [];
    const ext = p.format;

    if (p.mode === 'single') {
      for (const [k, t] of p.times.entries()) {
        report((k / p.times.length) * 100, `Extracting frame ${k + 1} of ${p.times.length}`);
        const at = Math.min(Math.max(0, t), Math.max(0, i.duration - 0.05));
        const out = path.join(outDir, `frame_${String(k + 1).padStart(2, '0')}.${ext}`);
        await grabFrame(input!.path, at, out, p.format);
        files.push({ path: out, name: `${base}_${at.toFixed(2).replace('.', 's')}.${ext}`, mimeType: MIME[p.format] });
      }
    } else if (p.mode === 'interval') {
      const { start, end } = clampRange(p.start, p.end, i.duration);
      const count = Math.min(p.max, Math.floor((end - start) / p.every) + 1);
      report(0, `Extracting ${count} frames`);
      const dir = path.join(outDir, 'frames');
      await fsp.mkdir(dir);
      await ffmpeg(
        [...inputArgs(input!.path, ['-ss', ts(start), '-t', ts(end - start)]), '-vf', `fps=1/${p.every}`, '-frames:v', String(count), ...imageArgs(p.format), path.join(dir, `%03d.${ext}`)],
        { duration: end - start, onProgress: (pct) => report(pct * 0.9, 'Extracting frames') },
      );
      const produced = await listOutputFiles(dir);
      if (!produced.length) throw new AppError(422, 'NO_FRAMES', 'No frames were found in that range.');
      produced.forEach((f, k) => {
        const at = start + k * p.every;
        files.push({ path: f, name: `${base}_${String(k + 1).padStart(3, '0')}_${at.toFixed(1)}s.${ext}`, mimeType: MIME[p.format] });
      });
      if (files.length > 1) {
        report(95, 'Creating ZIP');
        const zip = path.join(outDir, 'frames.zip');
        await zipFiles(files.map((f) => ({ path: f.path, name: f.name })), zip);
        files.unshift({ path: zip, name: `${base}_frames.zip`, mimeType: 'application/zip' });
      }
    } else {
      const { start, end } = clampRange(p.start, p.end, i.duration);
      const n = p.columns * p.rows;
      // Evenly spaced thumbnails, tiled into one image with thin gaps.
      const fps = n / (end - start);
      const out = path.join(outDir, `contact.${ext}`);
      report(0, 'Building contact sheet');
      await ffmpeg(
        [
          ...inputArgs(input!.path, ['-ss', ts(start), '-t', ts(end - start)]),
          '-vf', `fps=${fps.toFixed(6)},scale=${p.tileWidth}:-2:flags=lanczos,tile=${p.columns}x${p.rows}:padding=6:margin=6:color=0x111111`,
          '-frames:v', '1', '-update', '1',
          ...imageArgs(p.format),
          out,
        ],
        { duration: end - start, onProgress: (pct) => report(pct, 'Building contact sheet') },
      );
      files.push({ path: out, name: `${base}_contact_sheet.${ext}`, mimeType: MIME[p.format] });
    }
    return { files };
  },
});
