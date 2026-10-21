import path from 'node:path';
import { z } from 'zod';
import { ffmpeg, inputArgs } from '../services/ffmpeg.js';
import { clampRange, fileId, requireVideo, seconds, ts } from './common.js';
import { cropSchema } from './edit.js';
import { baseName, defineTool } from './types.js';

const MAX_SECONDS = 30;

const schema = z.object({
  fileId,
  start: seconds.default(0),
  end: seconds.optional(),
  fps: z.number().int().min(5).max(30).default(12),
  width: z.number().int().min(120).max(1080).default(480),
  speed: z.number().min(0.25).max(4).default(1),
  crop: cropSchema.optional(),
  format: z.enum(['gif', 'webp']).default('gif'),
});

export const gifTool = defineTool({
  schema,
  accepts: ['video'],
  fileIds: (p) => [p.fileId],
  validate(p, [input]) {
    const i = requireVideo(input!);
    clampRange(p.start, Math.min(p.end ?? i.duration, p.start + MAX_SECONDS * p.speed), i.duration);
  },
  summary: (p) => ({ format: p.format.toUpperCase(), resolution: `${p.width}px · ${p.fps} fps` }),
  async run({ inputs: [input], params: p, outDir, report }) {
    const i = requireVideo(input!);
    // Long GIFs get huge fast; cap the output at 30 seconds.
    const { start, end } = clampRange(p.start, Math.min(p.end ?? i.duration, p.start + MAX_SECONDS * p.speed), i.duration);
    const width = Math.min(p.width, Math.round(i.width * (p.crop?.w ?? 1)) || p.width);
    const pre = [
      ...(p.crop ? [`crop=w=iw*${p.crop.w}:h=ih*${p.crop.h}:x=iw*${p.crop.x}:y=ih*${p.crop.y}`] : []),
      ...(p.speed !== 1 ? [`setpts=PTS/${p.speed}`] : []),
      `fps=${p.fps}`,
      `scale=${width}:-2:flags=lanczos`,
    ].join(',');
    const out = path.join(outDir, `animation.${p.format}`);
    report(0, 'Making animation');
    const filter =
      p.format === 'gif'
        ? // A palette built from this clip keeps GIF colours close to the video.
          `[0:v]${pre},split[a][b];[a]palettegen=stats_mode=diff[pal];[b][pal]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[out]`
        : `[0:v]${pre}[out]`;
    await ffmpeg(
      [
        ...inputArgs(input!.path, ['-ss', ts(start), '-t', ts(end - start)]),
        '-filter_complex', filter,
        '-map', '[out]',
        ...(p.format === 'gif' ? ['-loop', '0'] : ['-c:v', 'libwebp', '-lossless', '0', '-quality', '75', '-loop', '0']),
        out,
      ],
      { duration: (end - start) / p.speed, onProgress: (pct) => report(pct, 'Making animation') },
    );
    return { files: [{ path: out, name: `${baseName(input!.name)}.${p.format}` }] };
  },
});
