import { z } from 'zod';
import { AppError } from '../middleware/errors.js';
import { trackExpression, trackSubject, type TrackPoint } from '../services/tracking.js';
import { clampRange, fileId, requireVideo, seconds } from './common.js';
import { editSchema, renderEdit, textSchema } from './edit.js';
import { baseName, defineTool } from './types.js';

/** Upload guidance per platform: all 9:16; the longest clip each accepts as a short-form video. */
export const SHORT_PLATFORMS = {
  shorts: { label: 'YouTube Shorts', maxSeconds: 180 },
  reels: { label: 'Instagram Reels', maxSeconds: 180 },
  tiktok: { label: 'TikTok', maxSeconds: 600 },
} as const;

const schema = z.object({
  fileId,
  platform: z.enum(['shorts', 'reels', 'tiktok']).default('shorts'),
  start: seconds.default(0),
  end: seconds.optional(),
  /** manual: crop at `centerX`; auto: follow the subject; blur: whole frame on a blurred background. */
  cropMode: z.enum(['manual', 'auto', 'blur']).default('manual'),
  /** Horizontal centre of the crop, 0-1 of the frame width. */
  centerX: z.number().min(0).max(1).default(0.5),
  /** Output height: 1920 (1080x1920) or 1280 (720x1280). */
  height: z.union([z.literal(1920), z.literal(1280)]).default(1920),
  texts: z.array(textSchema).max(10).default([]),
});

export type ShortsParams = z.infer<typeof schema>;

export const shortsTool = defineTool({
  schema,
  accepts: ['video'],
  fileIds: (p) => [p.fileId],
  validate(p, [input]) {
    const i = requireVideo(input!);
    const { start, end } = clampRange(p.start, p.end, i.duration);
    if (end - start > SHORT_PLATFORMS[p.platform].maxSeconds) {
      throw new AppError(400, 'INVALID_RANGE', `${SHORT_PLATFORMS[p.platform].label} accepts up to ${SHORT_PLATFORMS[p.platform].maxSeconds / 60} minutes. Pick a shorter section.`);
    }
  },
  summary: (p) => ({ format: `MP4 · ${SHORT_PLATFORMS[p.platform].label}`, resolution: p.height === 1920 ? '1080x1920' : '720x1280' }),
  async run({ inputs: [input], params: p, outDir, report }) {
    const i = requireVideo(input!);
    const { start, end } = clampRange(p.start, p.end, i.duration);
    // Widest 9:16 window inside the frame (the full width for sources that are already tall).
    const cropW = Math.min(1, (i.height * 9) / 16 / i.width);
    let track: TrackPoint[] | null = null;
    let cropX: string | undefined;
    if (p.cropMode === 'auto' && cropW < 0.999) {
      report(0, 'Finding the subject');
      track = await trackSubject({ input: input!.path, start, duration: end - start, cropW, workDir: outDir, onProgress: (pct) => report(pct * 0.25, 'Finding the subject') });
      cropX = trackExpression(track);
    }
    const params = editSchema.parse({
      clips: [{ fileId: p.fileId, start, end }],
      aspect: '9:16',
      fit: p.cropMode === 'blur' ? 'blur' : 'fill',
      crop: p.cropMode === 'blur' ? undefined : { x: Math.min(1 - cropW, Math.max(0, p.centerX - cropW / 2)), y: 0, w: cropW, h: 1 },
      texts: p.texts,
      format: 'mp4',
    });
    const size = { width: p.height === 1920 ? 1080 : 720, height: p.height };
    const offset = track ? 25 : 0;
    const { path: out } = await renderEdit(params, [input!], outDir, 'short.mp4', (pct) => report(offset + pct * ((100 - offset) / 100), 'Rendering vertical video'), {
      cropX,
      size,
    });
    const warnings =
      i.height < size.height * 0.56 * 0.9 && p.cropMode !== 'blur'
        ? [`The source is ${i.width}x${i.height}, so the cropped area is upscaled to ${size.width}x${size.height} and may look soft.`]
        : [];
    return {
      files: [{ path: out, name: `${baseName(input!.name)}_${p.platform}.mp4` }],
      result: { track, cropWidth: cropW },
      warnings,
    };
  },
});
