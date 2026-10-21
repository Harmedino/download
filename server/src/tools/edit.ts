import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AppError } from '../middleware/errors.js';
import { VIDEO_CONTAINERS, ffmpeg, fitOutput, inputArgs, videoEncodeArgs, type MediaInfo, type VideoContainer } from '../services/ffmpeg.js';
import { FONT_IDS, ffColor, fontFile } from '../services/fonts.js';
import { fileId, resolution, seconds, ts } from './common.js';
import { baseName, defineTool, resolutionOf, type ToolInput } from './types.js';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb color');
const range = z.object({ start: seconds, end: seconds });

const clipSchema = z.object({
  fileId,
  start: seconds.optional(),
  end: seconds.optional(),
  /** Sections to remove from inside the clip. */
  cuts: z.array(range).max(20).default([]),
});

export const textSchema = z.object({
  text: z.string().trim().min(1).max(200),
  /** Seconds on the output timeline; whole video when omitted. */
  start: seconds.optional(),
  end: seconds.optional(),
  /** Position as a fraction of the free space: 0 = left/top edge, 1 = right/bottom edge. */
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.9),
  /** Font size as a fraction of the video height. */
  size: z.number().min(0.02).max(0.25).default(0.06),
  color: hex.default('#ffffff'),
  font: z.enum(FONT_IDS).default('sans'),
  box: z.boolean().default(false),
});

const unit = z.number().min(0).max(1);
export const cropSchema = z
  .object({ x: unit, y: unit, w: z.number().min(0.05).max(1), h: z.number().min(0.05).max(1) })
  .refine((c) => c.x + c.w <= 1.001 && c.y + c.h <= 1.001, 'crop must stay inside the frame');

export const ASPECTS = { original: null, '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 } as const;
const TRANSITIONS = ['none', 'fade', 'fadeblack', 'dissolve', 'wipeleft', 'slideleft', 'circleopen'] as const;

export const editSchema = z.object({
  clips: z.array(clipSchema).min(1).max(10),
  /** Crop rectangle as fractions of the (unrotated) frame. */
  crop: cropSchema.optional(),
  aspect: z.enum(Object.keys(ASPECTS) as [keyof typeof ASPECTS, ...Array<keyof typeof ASPECTS>]).default('original'),
  /** How a clip that doesn't match the output shape is fitted: crop to fill, or letterbox on blur/black. */
  fit: z.enum(['fill', 'blur', 'black']).default('fill'),
  resolution: resolution.optional(),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  flipH: z.boolean().default(false),
  speed: z.number().min(0.25).max(4).default(1),
  brightness: z.number().min(-0.5).max(0.5).default(0),
  contrast: z.number().min(0.5).max(2).default(1),
  saturation: z.number().min(0).max(3).default(1),
  texts: z.array(textSchema).max(10).default([]),
  transition: z.enum(TRANSITIONS).default('none'),
  transitionDuration: z.number().min(0.2).max(2).default(0.5),
  fadeIn: z.number().min(0).max(5).default(0),
  fadeOut: z.number().min(0).max(5).default(0),
  mute: z.boolean().default(false),
  format: z.enum(VIDEO_CONTAINERS as [VideoContainer, ...VideoContainer[]]).default('mp4'),
});

export type EditParams = z.infer<typeof editSchema>;
type Range = { start: number; end: number };

/** The parts of [start, end] left after removing `cuts`. Exported for tests. */
export function keepSegments(start: number, end: number, cuts: Range[]): Range[] {
  const sorted = cuts
    .map((c) => ({ start: Math.max(start, Math.min(c.start, c.end)), end: Math.min(end, Math.max(c.start, c.end)) }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  let cursor = start;
  for (const c of sorted) {
    if (c.start > cursor) out.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (end > cursor) out.push({ start: cursor, end });
  // Slivers shorter than two frames only cause glitches.
  return out.filter((s) => s.end - s.start >= 0.08);
}

/** atempo only accepts 0.5-2, so larger changes are chained. */
export function atempoChain(speed: number): string[] {
  const parts: string[] = [];
  let s = speed;
  while (s > 2) {
    parts.push('atempo=2');
    s /= 2;
  }
  while (s < 0.5) {
    parts.push('atempo=0.5');
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 1e-3) parts.push(`atempo=${Number(s.toFixed(4))}`);
  return parts;
}

/** Output frame size: crop, rotate, reshape to the aspect, then cap. Exported for tests. */
export function outputSize(info: { width: number; height: number }, p: Pick<EditParams, 'crop' | 'rotate' | 'aspect' | 'fit' | 'resolution'>) {
  let w = info.width * (p.crop?.w ?? 1);
  let h = info.height * (p.crop?.h ?? 1);
  if (p.rotate % 180 === 90) [w, h] = [h, w];
  const ratio = ASPECTS[p.aspect];
  if (ratio) {
    if (p.fit === 'fill' || p.crop) {
      // Largest box of that shape inside the frame.
      if (w / h > ratio) w = h * ratio;
      else h = w / ratio;
    } else {
      // Letterboxing: keep the source's short side as the output's short side.
      const short = Math.min(w, h);
      [w, h] = ratio >= 1 ? [short * ratio, short] : [short, short / ratio];
    }
  }
  const scale = p.resolution ? Math.min(1, p.resolution / Math.min(w, h)) : 1;
  return fitOutput(w * scale, h * scale);
}

export interface ClipPlan {
  input: ToolInput;
  /** Input-side seek, so long videos aren't decoded from the start. */
  seek: number;
  length: number;
  /** Kept segments relative to `seek`. */
  segments: Range[];
  duration: number;
}

export function planClips(p: EditParams, inputs: ToolInput[]): ClipPlan[] {
  return p.clips.map((c, i) => {
    const input = inputs[i]!;
    const total = input.info.duration ?? 0;
    const start = Math.max(0, Math.min(c.start ?? 0, total));
    const end = Math.max(0, Math.min(c.end ?? total, total));
    if (end - start < 0.1) throw new AppError(400, 'INVALID_RANGE', `Clip ${i + 1}: pick a section at least a tenth of a second long.`);
    const segments = keepSegments(start, end, c.cuts).map((s) => ({ start: s.start - start, end: s.end - start }));
    if (!segments.length) throw new AppError(400, 'INVALID_RANGE', `Clip ${i + 1}: the cuts remove the whole clip.`);
    return { input, seek: start, length: end - start, segments, duration: segments.reduce((n, s) => n + s.end - s.start, 0) };
  });
}

export interface Graph {
  /** -i arguments for every clip, in order. */
  inputs: string[];
  filter: string;
  hasAudio: boolean;
  width: number;
  height: number;
  /** Output duration in seconds. */
  duration: number;
  /** Text overlay files to write into the job directory before running ffmpeg. */
  textFiles: Array<{ name: string; text: string }>;
}

const r3 = (n: number) => Number(n.toFixed(4));

/** Builds the whole ffmpeg filter graph for an edit. Pure, so it can be tested without ffmpeg. */
export function buildEditGraph(p: EditParams, inputs: ToolInput[], o: { cropX?: string; size?: { width: number; height: number } } = {}): Graph {
  const clips = planClips(p, inputs);
  const first = clips[0]!.input.info as MediaInfo & { width: number; height: number };
  const { width: W, height: H } = o.size ?? outputSize(first, p);
  const fps = Math.min(60, Math.round(first.fps ?? 30)) || 30;
  const hasAudio = !p.mute && clips.some((c) => c.input.info.hasAudio);
  const chains: string[] = [];
  const inputArgsList: string[] = [];

  clips.forEach((c, i) => {
    inputArgsList.push(...inputArgs(c.input.path, ['-ss', ts(c.seek), '-t', ts(c.length)]));
    const n = c.segments.length;
    const v = (k: number) => `c${i}v${k}`;
    const a = (k: number) => `c${i}a${k}`;
    const clipAudio = hasAudio && c.input.info.hasAudio;

    // 1. Cut out the kept segments and join them.
    if (n === 1 && c.segments[0]!.start < 0.01 && Math.abs(c.segments[0]!.end - c.length) < 0.01) {
      chains.push(`[${i}:v:0]null[${v(0)}]`);
      if (clipAudio) chains.push(`[${i}:a:0]anull[${a(0)}]`);
    } else {
      chains.push(n > 1 ? `[${i}:v:0]split=${n}${c.segments.map((_, k) => `[${v(k)}in]`).join('')}` : `[${i}:v:0]null[${v(0)}in]`);
      if (clipAudio) chains.push(n > 1 ? `[${i}:a:0]asplit=${n}${c.segments.map((_, k) => `[${a(k)}in]`).join('')}` : `[${i}:a:0]anull[${a(0)}in]`);
      c.segments.forEach((s, k) => {
        chains.push(`[${v(k)}in]trim=start=${ts(s.start)}:end=${ts(s.end)},setpts=PTS-STARTPTS[${v(k)}]`);
        if (clipAudio) chains.push(`[${a(k)}in]atrim=start=${ts(s.start)}:end=${ts(s.end)},asetpts=PTS-STARTPTS[${a(k)}]`);
      });
    }
    if (n > 1) {
      const pads = c.segments.map((_, k) => `[${v(k)}]${clipAudio ? `[${a(k)}]` : ''}`).join('');
      chains.push(`${pads}concat=n=${n}:v=1:a=${clipAudio ? 1 : 0}[c${i}vj]${clipAudio ? `[c${i}aj]` : ''}`);
    } else {
      chains.push(`[${v(0)}]null[c${i}vj]`);
      if (clipAudio) chains.push(`[${a(0)}]anull[c${i}aj]`);
    }

    // 2. Crop, rotate, flip, then fit into the output frame.
    const shape: string[] = [];
    if (p.crop) {
      const x = o.cropX ?? `iw*${r3(p.crop.x)}`;
      shape.push(`crop=w=iw*${r3(p.crop.w)}:h=ih*${r3(p.crop.h)}:x=${x}:y=ih*${r3(p.crop.y)}`);
    }
    if (p.rotate === 90) shape.push('transpose=1');
    if (p.rotate === 270) shape.push('transpose=2');
    if (p.rotate === 180) shape.push('hflip,vflip');
    if (p.flipH) shape.push('hflip');
    const pre = shape.length ? `${shape.join(',')},` : '';
    const post = `setsar=1,fps=${fps},format=yuv420p`;
    if (p.fit === 'blur' && !p.crop) {
      chains.push(`[c${i}vj]${pre}split=2[c${i}bg][c${i}fg]`);
      chains.push(`[c${i}bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2[c${i}bgb]`);
      chains.push(`[c${i}fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[c${i}fgs]`);
      chains.push(`[c${i}bgb][c${i}fgs]overlay=(W-w)/2:(H-h)/2,${post}[v${i}]`);
    } else if (p.fit === 'black' && !p.crop) {
      chains.push(`[c${i}vj]${pre}scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,${post}[v${i}]`);
    } else {
      chains.push(`[c${i}vj]${pre}scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},${post}[v${i}]`);
    }
    if (hasAudio) {
      const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
      chains.push(clipAudio ? `[c${i}aj]${fmt}[a${i}]` : `anullsrc=r=48000:cl=stereo,atrim=0:${ts(c.duration)},${fmt}[a${i}]`);
    }
  });

  // 3. Join the clips, with a transition between them when asked.
  let total = clips.reduce((n, c) => n + c.duration, 0);
  let vLabel = 'v0';
  let aLabel = 'a0';
  if (clips.length > 1) {
    if (p.transition === 'none') {
      const pads = clips.map((_, i) => `[v${i}]${hasAudio ? `[a${i}]` : ''}`).join('');
      chains.push(`${pads}concat=n=${clips.length}:v=1:a=${hasAudio ? 1 : 0}[vm]${hasAudio ? '[am]' : ''}`);
      vLabel = 'vm';
      aLabel = 'am';
    } else {
      const td = Math.min(p.transitionDuration, ...clips.map((c) => c.duration / 2));
      let offset = 0;
      for (let i = 1; i < clips.length; i++) {
        offset += clips[i - 1]!.duration - td;
        chains.push(`[${vLabel}][v${i}]xfade=transition=${p.transition}:duration=${ts(td)}:offset=${ts(offset)}[x${i}]`);
        vLabel = `x${i}`;
        if (hasAudio) {
          chains.push(`[${aLabel}][a${i}]acrossfade=d=${ts(td)}[y${i}]`);
          aLabel = `y${i}`;
        }
      }
      total -= td * (clips.length - 1);
    }
  }

  // 4. Speed, colour, text and fades apply to the joined video.
  const duration = total / p.speed;
  const vf: string[] = [];
  const af: string[] = [];
  if (p.speed !== 1) {
    vf.push(`setpts=PTS/${r3(p.speed)}`);
    af.push(...atempoChain(p.speed));
  }
  if (p.brightness !== 0 || p.contrast !== 1 || p.saturation !== 1) {
    vf.push(`eq=brightness=${r3(p.brightness)}:contrast=${r3(p.contrast)}:saturation=${r3(p.saturation)}`);
  }
  const textFiles: Graph['textFiles'] = [];
  p.texts.forEach((t, k) => {
    const name = `text${k}.txt`;
    textFiles.push({ name, text: t.text });
    const start = Math.max(0, t.start ?? 0);
    const end = Math.min(duration, t.end ?? duration);
    const box = t.box ? `:box=1:boxcolor=${ffColor('#000000', 0.55)}:boxborderw=${Math.round(H * t.size * 0.3)}` : '';
    // The user's text is read from a file with expansion off, so it can't inject filter syntax.
    vf.push(
      `drawtext=fontfile=${fontFile(t.font)}:textfile=${name}:expansion=none:fontsize=${Math.round(H * t.size)}:fontcolor=${ffColor(t.color)}` +
        `:borderw=${Math.max(1, Math.round(H * t.size * 0.06))}:bordercolor=${ffColor('#000000', 0.7)}${box}` +
        `:x=(w-text_w)*${r3(t.x)}:y=(h-text_h)*${r3(t.y)}:enable='between(t,${ts(start)},${ts(end)})'`,
    );
  });
  if (p.fadeIn > 0) {
    vf.push(`fade=t=in:st=0:d=${ts(p.fadeIn)}`);
    af.push(`afade=t=in:st=0:d=${ts(p.fadeIn)}`);
  }
  if (p.fadeOut > 0) {
    const st = Math.max(0, duration - p.fadeOut);
    vf.push(`fade=t=out:st=${ts(st)}:d=${ts(p.fadeOut)}`);
    af.push(`afade=t=out:st=${ts(st)}:d=${ts(p.fadeOut)}`);
  }
  chains.push(`[${vLabel}]${vf.length ? vf.join(',') : 'null'}[vout]`);
  if (hasAudio) chains.push(`[${aLabel}]${af.length ? af.join(',') : 'anull'}[aout]`);

  return { inputs: inputArgsList, filter: chains.join(';'), hasAudio, width: W, height: H, duration, textFiles };
}

/** Writes text files and runs the edit. Shared with the Shorts tool. */
export async function renderEdit(
  p: EditParams,
  inputs: ToolInput[],
  outDir: string,
  outName: string,
  onProgress: (pct: number) => void,
  o: { cropX?: string; size?: { width: number; height: number }; extraFilter?: string } = {},
): Promise<{ path: string; graph: Graph }> {
  const graph = buildEditGraph(p, inputs, o);
  for (const t of graph.textFiles) await fsp.writeFile(path.join(outDir, t.name), t.text, 'utf8');
  let filter = graph.filter;
  if (o.extraFilter) filter = filter.replace(/\[vout\]$|\[vout\](?=;)/, `[vpre];[vpre]${o.extraFilter}[vout]`);
  const out = path.join(outDir, outName);
  await ffmpeg(
    [
      ...graph.inputs,
      '-filter_complex', filter,
      '-map', '[vout]', ...(graph.hasAudio ? ['-map', '[aout]'] : []),
      ...videoEncodeArgs(p.format, { hasAudio: graph.hasAudio }),
      out,
    ],
    { duration: graph.duration, onProgress, cwd: outDir },
  );
  return { path: out, graph };
}

export const editTool = defineTool({
  schema: editSchema,
  accepts: ['video'],
  fileIds: (p) => p.clips.map((c) => c.fileId),
  validate(p, inputs) {
    buildEditGraph(p, inputs);
  },
  summary(p, inputs) {
    const s = outputSize(inputs[0]!.info as { width: number; height: number }, p);
    return { format: p.format.toUpperCase(), resolution: resolutionOf(s.width, s.height) };
  },
  async run({ inputs, params: p, outDir, report }) {
    report(0, 'Rendering');
    const name = `${baseName(inputs[0]!.name)}_edited.${p.format}`;
    const { path: out } = await renderEdit(p, inputs, outDir, `edited.${p.format}`, (pct) => report(pct, 'Rendering'));
    return { files: [{ path: out, name }] };
  },
});
