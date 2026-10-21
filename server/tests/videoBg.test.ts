import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { checkBinaries } from '../src/services/binaries.js';
import { assertDurationAllowed, probeVideo, removeVideoBackground } from '../src/services/videoBg.js';

const dir = path.join(env.TEMP_DIR, 'video-test');
const clip = path.join(dir, 'clip.mp4');

function ffprobeJson(file: string) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]).toString());
}

beforeAll(async () => {
  await checkBinaries();
  await fs.mkdir(dir, { recursive: true });
  // 1 s clip of a drawn person (tests/fixtures/person.svg) slowly panning, with a sine-wave audio track.
  const still = path.join(dir, 'person.png');
  await sharp(path.join(import.meta.dirname, 'fixtures', 'person.svg')).png().toFile(still);
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    '-loop', '1', '-framerate', '25', '-i', still,
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-vf', "crop=448:336:x='32*t':y=60,scale=320:240",
    '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip,
  ]);
});

describe('probeVideo / limits', () => {
  it('reads duration, size, fps and audio', async () => {
    const info = await probeVideo(clip);
    expect(info.width).toBe(320);
    expect(info.height).toBe(240);
    expect(info.fps).toBe(25);
    expect(info.hasAudio).toBe(true);
    expect(info.duration).toBeGreaterThan(0.9);
  });

  it('rejects clips over the limit', () => {
    expect(() => assertDurationAllowed({ duration: 61, width: 1, height: 1, fps: 30, hasAudio: false }, 60)).toThrow(
      expect.objectContaining({ code: 'VIDEO_TOO_LONG' }),
    );
    expect(() => assertDurationAllowed({ duration: 60.2, width: 1, height: 1, fps: 30, hasAudio: false }, 60)).not.toThrow();
  });

  it('rejects non-video files', async () => {
    const bad = path.join(dir, 'bad.mp4');
    await fs.writeFile(bad, 'nope');
    await expect(probeVideo(bad)).rejects.toMatchObject({ code: 'INVALID_VIDEO' });
  });
});

// Runs the real model on every frame, so keep the clip tiny (4 frames).
describe('removeVideoBackground (real pipeline)', () => {
  it('produces a VP9 WebM with an alpha channel and the original audio', async () => {
    const work = path.join(dir, 'transparent');
    const stages = new Set<string>();
    let last = 0;
    const res = await removeVideoBackground({
      inputPath: clip, workDir: work, background: 'transparent', fps: 4, maxWidth: 160,
      onProgress: (p, s) => { expect(p).toBeGreaterThanOrEqual(0); last = p; stages.add(s.replace(/\(.*\)/, '').trim()); },
    });
    expect(res.mimeType).toBe('video/webm');
    expect(res.frames).toBe(4);
    expect(last).toBeGreaterThanOrEqual(90);
    expect([...stages]).toEqual(expect.arrayContaining(['Extracting frames', 'Removing background', 'Encoding video']));
    const probe = ffprobeJson(res.outputPath);
    const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
    expect(v.codec_name).toBe('vp9');
    expect(v.tags?.alpha_mode ?? v.tags?.ALPHA_MODE).toBe('1');
    expect([v.width, v.height]).toEqual([160, 120]);
    expect(probe.streams.some((s: { codec_type: string }) => s.codec_type === 'audio')).toBe(true);
    // Decode with libvpx (the native vp9 decoder drops alpha) and check the subject survived:
    // some pixels opaque, some transparent.
    const frame = path.join(dir, 'frame0.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-c:v', 'libvpx-vp9', '-i', res.outputPath, '-frames:v', '1', frame]);
    const alpha = (await sharp(frame).ensureAlpha().stats()).channels[3]!;
    expect(alpha.min).toBe(0);
    expect(alpha.max).toBeGreaterThan(200);
    expect(alpha.mean).toBeGreaterThan(20);
    expect(alpha.mean).toBeLessThan(200);
    // Temporary frame folders are removed.
    expect((await fs.readdir(work)).sort()).toEqual(['output.webm']);
  }, 120_000);

  it('produces an H.264 MP4 on a solid color', async () => {
    const res = await removeVideoBackground({ inputPath: clip, workDir: path.join(dir, 'color'), background: 'color', color: '#00ff00', fps: 4, maxWidth: 160 });
    expect(res.mimeType).toBe('video/mp4');
    const probe = ffprobeJson(res.outputPath);
    const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
    expect(v.codec_name).toBe('h264');
    expect(v.pix_fmt).toBe('yuv420p');
    expect(probe.streams.some((s: { codec_type: string }) => s.codec_type === 'audio')).toBe(true);
    expect(Number(probe.format.duration)).toBeGreaterThan(0.5);
    // Top-left corner is background, so it should now be (close to) the requested green.
    const frame = path.join(dir, 'frame-color.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', res.outputPath, '-frames:v', '1', frame]);
    const { data } = await sharp(frame).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeLessThan(40);
    expect(data[1]).toBeGreaterThan(200);
    expect(data[2]).toBeLessThan(40);
  }, 120_000);
});
