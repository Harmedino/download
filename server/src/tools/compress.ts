import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AppError } from '../middleware/errors.js';
import { ffmpeg, inputArgs, videoEncodeArgs, type QualityLevel } from '../services/ffmpeg.js';
import { fileId, requireVideo, resolution, scaleToShortSide } from './common.js';
import { baseName, defineTool, resolutionOf } from './types.js';

const schema = z.object({
  fileId,
  /** Constant-quality presets... */
  level: z.enum(['high', 'balanced', 'small']).default('balanced'),
  /** ...or aim for a file size in MB (overrides level). */
  targetMb: z.number().min(1).max(4000).optional(),
  resolution: resolution.optional(),
});

const LEVEL: Record<'high' | 'balanced' | 'small', QualityLevel> = { high: 0, balanced: 1, small: 2 };
const AUDIO_BPS = 96_000;

/** Picks the video bitrate for a size target and a resolution that bitrate can carry. Exported for tests. */
export function planTarget(targetMb: number, duration: number, width: number, height: number, hasAudio: boolean) {
  // 4% headroom for container overhead, so the result lands under the target.
  const total = (targetMb * 1024 * 1024 * 8 * 0.96) / duration;
  const video = total - (hasAudio ? AUDIO_BPS : 0);
  if (video < 80_000) {
    const minMb = Math.ceil((((80_000 + (hasAudio ? AUDIO_BPS : 0)) * duration) / 8 / 1024 / 1024 / 0.96) * 10) / 10;
    throw new AppError(400, 'TARGET_TOO_SMALL', `That target is too small for a ${Math.round(duration)}-second video. Try at least ${minMb} MB.`);
  }
  // Rough bits-per-pixel budget for H.264 at 30 fps: drop resolution when the bitrate can't feed it.
  const shortSide = video < 600_000 ? 480 : video < 1_500_000 ? 720 : video < 4_000_000 ? 1080 : null;
  return { videoBitrate: video, size: scaleToShortSide(width, height, shortSide) };
}

export const compressTool = defineTool({
  schema,
  accepts: ['video'],
  fileIds: (p) => [p.fileId],
  summary(p, [input]) {
    const i = input!.info;
    const size = scaleToShortSide(i.width!, i.height!, p.resolution);
    return { format: p.targetMb ? `MP4 · ${p.targetMb} MB target` : `MP4 · ${p.level}`, resolution: resolutionOf(size.width, size.height) };
  },
  async run({ inputs: [input], params: p, outDir, report }) {
    const i = requireVideo(input!);
    let size = scaleToShortSide(i.width, i.height, p.resolution);
    let encode: string[];
    if (p.targetMb) {
      const plan = planTarget(p.targetMb, i.duration, i.width, i.height, i.hasAudio);
      if (!p.resolution) size = plan.size;
      encode = videoEncodeArgs('mp4', { bitrate: plan.videoBitrate, hasAudio: i.hasAudio, audioBitrate: AUDIO_BPS });
    } else {
      encode = videoEncodeArgs('mp4', { quality: LEVEL[p.level], hasAudio: i.hasAudio, audioBitrate: p.level === 'small' ? AUDIO_BPS : 128_000 });
    }
    const out = path.join(outDir, 'compressed.mp4');
    report(0, 'Compressing');
    await ffmpeg(
      [
        ...inputArgs(input!.path),
        '-map', '0:v:0', ...(i.hasAudio ? ['-map', '0:a:0'] : []),
        '-vf', `scale=${size.width}:${size.height}:flags=lanczos,setsar=1`,
        ...encode,
        out,
      ],
      { duration: i.duration, onProgress: (pct) => report(pct, 'Compressing') },
    );
    const { size: bytes } = await fsp.stat(out);
    const before = input!.info.size ?? null;
    const warnings =
      before && bytes >= before ? ['The compressed file is not smaller than the original, which is usually already well compressed. Try "Small" or a lower resolution.'] : [];
    return {
      files: [{ path: out, name: `${baseName(input!.name)}_compressed.mp4` }],
      result: { originalSize: before, compressedSize: bytes },
      warnings,
    };
  },
});
