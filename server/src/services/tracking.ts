import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ffmpeg, inputArgs } from './ffmpeg.js';

export interface TrackPoint {
  /** Seconds from the start of the clip. */
  t: number;
  /** Horizontal centre of the subject, 0-1 of the frame width. */
  x: number;
}

/**
 * Finds where the subject is across a clip so a vertical crop can follow it. Frames are sampled with
 * ffmpeg and scored with libvips' "attention" strategy (via sharp), which looks for skin tones,
 * saturated colour and detail: the speaker or main object in most videos. It is a saliency
 * heuristic, not face recognition, so the manual crop stays available.
 */
export async function trackSubject(o: {
  input: string;
  start: number;
  duration: number;
  /** Crop width as a fraction of the frame width. */
  cropW: number;
  workDir: string;
  onProgress?: (pct: number) => void;
}): Promise<TrackPoint[]> {
  const step = Math.max(0.5, o.duration / 90);
  const dir = path.join(o.workDir, 'track');
  await fsp.mkdir(dir, { recursive: true });
  await ffmpeg([...inputArgs(o.input, ['-ss', o.start.toFixed(3), '-t', o.duration.toFixed(3)]), '-vf', `fps=1/${step},scale=320:-2`, '-q:v', '4', path.join(dir, '%04d.jpg')], {
    duration: o.duration,
    onProgress: (p) => o.onProgress?.(p * 0.6),
  });
  const frames = (await fsp.readdir(dir)).filter((f) => f.endsWith('.jpg')).sort();
  const raw: TrackPoint[] = [];
  for (const [k, f] of frames.entries()) {
    const img = sharp(path.join(dir, f));
    const { width = 320, height = 180 } = await img.metadata();
    const cw = Math.max(2, Math.round(width * o.cropW));
    const { info } = await img.resize({ width: cw, height, fit: 'cover', position: sharp.strategy.attention }).toBuffer({ resolveWithObject: true });
    const left = Math.abs((info as { cropOffsetLeft?: number }).cropOffsetLeft ?? (width - cw) / 2);
    raw.push({ t: k * step, x: (left + cw / 2) / width });
    o.onProgress?.(60 + (k / frames.length) * 40);
  }
  await fsp.rm(dir, { recursive: true, force: true });
  return smoothTrack(raw, o.cropW);
}

/** Median filter, then limit how fast the crop may pan, so it glides instead of jumping. Exported for tests. */
export function smoothTrack(points: TrackPoint[], cropW: number, maxSpeed = 0.25): TrackPoint[] {
  if (!points.length) return [{ t: 0, x: 0.5 }];
  const median = points.map((p, i) => {
    const w = points.slice(Math.max(0, i - 2), i + 3).map((q) => q.x).sort((a, b) => a - b);
    return { t: p.t, x: w[Math.floor(w.length / 2)]! };
  });
  const out: TrackPoint[] = [median[0]!];
  for (let i = 1; i < median.length; i++) {
    const prev = out[i - 1]!;
    const dt = median[i]!.t - prev.t;
    const limit = maxSpeed * dt;
    const dx = Math.max(-limit, Math.min(limit, median[i]!.x - prev.x));
    out.push({ t: median[i]!.t, x: prev.x + dx });
  }
  const half = cropW / 2;
  return out.map((p) => ({ t: Number(p.t.toFixed(3)), x: Number(Math.min(1 - half, Math.max(half, p.x)).toFixed(4)) }));
}

/**
 * ffmpeg crop `x` expression (pixels) that moves linearly between track points. A flat sum of
 * per-interval terms, so it stays shallow even with ~90 points.
 */
export function trackExpression(points: TrackPoint[]): string {
  const terms: string[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const slope = (b.x - a.x) / (b.t - a.t || 1);
    terms.push(`(gte(t,${a.t})*lt(t,${b.t})*(${a.x}+${slope.toFixed(6)}*(t-${a.t})))`);
  }
  const last = points.at(-1)!;
  terms.push(`(gte(t,${last.t})*${last.x})`);
  // Quoted so the commas inside stay part of this one option.
  return `'max(0,min(iw-ow,iw*(${terms.join('+')})-ow/2))'`;
}
