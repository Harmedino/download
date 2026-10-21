import fsp from 'node:fs/promises';
import path from 'node:path';
import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errors.js';
import { requireBinary } from './binaries.js';
import { cutout, decodeImage } from './bgremove.js';

export type VideoBackground = 'transparent' | 'color';

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

function command(timeoutSeconds: number) {
  return ffmpeg({ timeout: timeoutSeconds }).setFfmpegPath(requireBinary('ffmpeg')).setFfprobePath(requireBinary('ffprobe'));
}

function parseRate(rate: string | undefined): number {
  const [n, d] = (rate ?? '').split('/').map(Number);
  const v = d ? n! / d : n!;
  return Number.isFinite(v) && v > 0 ? v : 30;
}

export function probeVideo(file: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    command(30)
      .input(file)
      .ffprobe((err, data) => {
        const video = data?.streams?.find((s) => s.codec_type === 'video');
        if (err || !video) return reject(new AppError(400, 'INVALID_VIDEO', "That file isn't a video we can read. Try an MP4, WebM or MOV."));
        const duration = Number(data.format?.duration ?? video.duration);
        resolve({
          duration: Number.isFinite(duration) ? duration : 0,
          width: video.width ?? 0,
          height: video.height ?? 0,
          fps: parseRate(video.avg_frame_rate ?? video.r_frame_rate),
          hasAudio: data.streams.some((s) => s.codec_type === 'audio'),
        });
      });
  });
}

export function assertDurationAllowed(info: VideoInfo, max = env.MAX_VIDEO_BG_SECONDS): void {
  // Allow a little slack for container rounding (a "60 s" phone clip is often 60.04 s).
  if (info.duration > max + 0.5) {
    throw new AppError(422, 'VIDEO_TOO_LONG', `Background removal works on clips up to ${max} seconds. This one is ${Math.round(info.duration)} seconds; trim it and try again.`);
  }
}

function runFfmpeg(cmd: ffmpeg.FfmpegCommand, output: string, onPercent?: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    cmd
      .on('progress', (p) => {
        if (typeof p.percent === 'number' && Number.isFinite(p.percent)) onPercent?.(Math.max(0, Math.min(100, p.percent)));
      })
      .on('error', (err, _stdout, stderr) => reject(Object.assign(new Error(`ffmpeg failed: ${err.message}`), { stderr })))
      .on('end', () => resolve())
      .save(output);
  });
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

export interface VideoBgOptions {
  inputPath: string;
  workDir: string;
  background: VideoBackground;
  /** #rrggbb when background is "color" */
  color?: string;
  fps?: number;
  maxWidth?: number;
  onProgress?: (pct: number, stage: string) => void;
}

export interface VideoBgResult {
  outputPath: string;
  mimeType: string;
  frames: number;
}

/**
 * ffmpeg splits the clip into frames, the segmentation model cuts out each frame,
 * and ffmpeg reassembles them: VP9 WebM with alpha (transparent) or H.264 MP4 on a solid color.
 * The original audio track is kept when there is one.
 */
export async function removeVideoBackground(o: VideoBgOptions): Promise<VideoBgResult> {
  const report = o.onProgress ?? (() => undefined);
  const info = await probeVideo(o.inputPath);
  assertDurationAllowed(info);

  const fps = Math.max(1, Math.min(o.fps ?? env.VIDEO_BG_FPS, Math.round(info.fps)));
  const maxWidth = o.maxWidth ?? env.VIDEO_BG_MAX_WIDTH;
  const width = even(Math.min(maxWidth, info.width || maxWidth));
  const height = even(info.width ? (info.height * width) / info.width : width);
  const framesDir = path.join(o.workDir, 'frames');
  const cutDir = path.join(o.workDir, 'cut');
  await fsp.mkdir(framesDir, { recursive: true });
  await fsp.mkdir(cutDir, { recursive: true });

  try {
    // 1. Split into frames (0-5 %)
    report(1, 'Extracting frames');
    await runFfmpeg(
      command(300)
        .input(o.inputPath)
        .inputOptions(['-t', String(env.MAX_VIDEO_BG_SECONDS + 1)])
        .outputOptions(['-vf', `fps=${fps},scale=${width}:${height}:flags=bicubic`, '-an', '-start_number', '0']),
      path.join(framesDir, '%05d.png'),
      (p) => report(1 + p * 0.04, 'Extracting frames'),
    );
    const frames = (await fsp.readdir(framesDir)).filter((f) => f.endsWith('.png')).sort();
    if (!frames.length) throw new AppError(400, 'INVALID_VIDEO', "We couldn't read any frames from that video.");

    // 2. Remove the background from every frame (5-90 %)
    for (const [i, name] of frames.entries()) {
      const cut = await cutout(await decodeImage(path.join(framesDir, name)));
      await sharp(cut.data, { raw: { width: cut.width, height: cut.height, channels: 4 } })
        .png({ compressionLevel: 1 })
        .toFile(path.join(cutDir, name));
      report(5 + ((i + 1) / frames.length) * 85, `Removing background (frame ${i + 1} of ${frames.length})`);
    }

    // 3. Reassemble (90-100 %)
    report(90, 'Encoding video');
    const pattern = path.join(cutDir, '%05d.png');
    const encodeProgress = (p: number) => report(90 + p * 0.09, 'Encoding video');
    if (o.background === 'transparent') {
      const outputPath = path.join(o.workDir, 'output.webm');
      const cmd = command(900).input(pattern).inputOptions(['-framerate', String(fps), '-start_number', '0']);
      if (info.hasAudio) cmd.input(o.inputPath);
      cmd.outputOptions([
        '-map', '0:v',
        ...(info.hasAudio ? ['-map', '1:a:0', '-c:a', 'libopus', '-b:a', '96k', '-shortest'] : []),
        '-c:v', 'libvpx-vp9',
        '-pix_fmt', 'yuva420p',
        '-b:v', '0',
        '-crf', '32',
        '-deadline', 'good',
        '-cpu-used', '4',
        '-row-mt', '1',
        '-auto-alt-ref', '0',
      ]);
      await runFfmpeg(cmd, outputPath, encodeProgress);
      return { outputPath, mimeType: 'video/webm', frames: frames.length };
    }

    const color = (o.color ?? '#ffffff').replace('#', '0x');
    const outputPath = path.join(o.workDir, 'output.mp4');
    const cmd = command(900)
      .input(`color=c=${color}:s=${width}x${height}:r=${fps}`)
      .inputOptions(['-f', 'lavfi'])
      .input(pattern)
      .inputOptions(['-framerate', String(fps), '-start_number', '0']);
    if (info.hasAudio) cmd.input(o.inputPath);
    cmd.complexFilter(['[0:v][1:v]overlay=shortest=1:format=auto,format=yuv420p[v]']).outputOptions([
      '-map', '[v]',
      ...(info.hasAudio ? ['-map', '2:a:0', '-c:a', 'aac', '-b:a', '128k', '-shortest'] : []),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '22',
      '-movflags', '+faststart',
    ]);
    await runFfmpeg(cmd, outputPath, encodeProgress);
    return { outputPath, mimeType: 'video/mp4', frames: frames.length };
  } finally {
    await fsp.rm(framesDir, { recursive: true, force: true });
    await fsp.rm(cutDir, { recursive: true, force: true });
  }
}
