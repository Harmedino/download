import fs from 'node:fs';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkBinaries } from '../src/services/binaries.js';
import { probe } from '../src/services/ffmpeg.js';
import { smoothTrack, trackExpression } from '../src/services/tracking.js';
import { framesTool } from '../src/tools/frames.js';
import { gifTool } from '../src/tools/gif.js';
import { shortsTool } from '../src/tools/shorts.js';
import { textSvg, thumbnailTool } from '../src/tools/thumbnail.js';
import { asInput, makeClip, runTool } from './helpers/media.js';

const ID = 'a'.repeat(24);
let clip: string;

beforeAll(async () => {
  await checkBinaries();
  clip = makeClip('frames.mp4', { width: 1280, height: 720, seconds: 6 });
});

describe('frame extractor', () => {
  it('exports single frames at full resolution', async () => {
    const res = await runTool(framesTool, { fileId: ID, mode: 'single', times: [0.5, 2], format: 'png' }, [await asInput(clip)]);
    expect(res.files).toHaveLength(2);
    expect(await sharp(res.files[0]!.path).metadata()).toMatchObject({ width: 1280, height: 720, format: 'png' });
  });

  it('extracts frames at an interval, with a ZIP', async () => {
    const res = await runTool(framesTool, { fileId: ID, mode: 'interval', every: 2, format: 'webp' }, [await asInput(clip)]);
    expect(res.files[0]!.name).toMatch(/_frames\.zip$/);
    expect(res.files.length - 1).toBe(3);
    expect((await sharp(res.files[1]!.path).metadata()).format).toBe('webp');
  });

  it('builds a contact sheet', async () => {
    const res = await runTool(framesTool, { fileId: ID, mode: 'contact', columns: 3, rows: 2, tileWidth: 160, format: 'jpg' }, [await asInput(clip)]);
    const meta = await sharp(res.files[0]!.path).metadata();
    expect(meta.width).toBe(3 * 160 + 4 * 6);
  });
});

describe('GIF maker', () => {
  it('makes a looping GIF from a range', async () => {
    const res = await runTool(gifTool, { fileId: ID, start: 1, end: 3, fps: 10, width: 320 }, [await asInput(clip)]);
    const meta = await sharp(res.files[0]!.path, { animated: true }).metadata();
    expect(meta).toMatchObject({ format: 'gif', width: 320, loop: 0 });
    expect(meta.pages).toBeGreaterThanOrEqual(18);
  });

  it('makes an animated WebP', async () => {
    const res = await runTool(gifTool, { fileId: ID, end: 1, format: 'webp', width: 240 }, [await asInput(clip)]);
    expect((await sharp(res.files[0]!.path, { animated: true }).metadata()).format).toBe('webp');
  });
});

describe('thumbnail editor', () => {
  it('crops, enhances and adds escaped text', async () => {
    const frame = await runTool(framesTool, { fileId: ID, mode: 'single', times: [1], format: 'png' }, [await asInput(clip)]);
    const input = await asInput(frame.files[0]!.path);
    expect(input.info.kind).toBe('image');
    const res = await runTool(
      thumbnailTool,
      { fileId: ID, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, brightness: 1.2, contrast: 1.3, saturation: 1.4, sharpen: true, texts: [{ text: 'Big <news> & "more"' }], format: 'jpg' },
      [input],
    );
    expect(await sharp(res.files[0]!.path).metadata()).toMatchObject({ width: 640, height: 360, format: 'jpeg' });
    expect(textSvg(100, 100, [{ text: '<script>', x: 0.5, y: 0.5, size: 0.1, color: '#fff000', stroke: '#000000', font: 'sans' }])).not.toContain('<script>');
  });
});

describe('video to shorts', () => {
  it('converts landscape to 1080x1920 with a manual crop', async () => {
    const res = await runTool(shortsTool, { fileId: ID, start: 1, end: 3, centerX: 0.2 }, [await asInput(clip)]);
    const info = await probe(res.files[0]!.path);
    expect(info).toMatchObject({ width: 1080, height: 1920, hasAudio: true });
    expect(info.duration).toBeCloseTo(2, 0);
  });

  it('follows the subject automatically', async () => {
    const res = await runTool(shortsTool, { fileId: ID, end: 4, cropMode: 'auto', height: 1280 }, [await asInput(clip)]);
    const info = await probe(res.files[0]!.path);
    expect(info).toMatchObject({ width: 720, height: 1280 });
    const track = (res.result as { track: Array<{ t: number; x: number }> }).track;
    expect(track.length).toBeGreaterThan(3);
    expect(track.every((p) => p.x >= 0 && p.x <= 1)).toBe(true);
  });

  it('can letterbox the whole frame on a blurred background', async () => {
    const res = await runTool(shortsTool, { fileId: ID, end: 1, cropMode: 'blur', height: 1280 }, [await asInput(clip)]);
    expect(await probe(res.files[0]!.path)).toMatchObject({ width: 720, height: 1280 });
  });

  it('rejects ranges longer than the platform allows', async () => {
    const long = makeClip('long.mp4', { width: 320, height: 180, seconds: 200 });
    await expect(runTool(shortsTool, { fileId: ID, platform: 'shorts' }, [await asInput(long)])).rejects.toMatchObject({ code: 'INVALID_RANGE' });
    expect(fs.existsSync(long)).toBe(true);
  });

  it('smooths the subject path and limits pan speed', () => {
    const jumpy = [0, 1, 2, 3, 4, 5].map((t) => ({ t, x: t === 2 ? 0.95 : 0.3 }));
    const s = smoothTrack(jumpy, 0.3);
    expect(Math.max(...s.map((p) => p.x))).toBeLessThan(0.5);
    for (let i = 1; i < s.length; i++) expect(Math.abs(s[i]!.x - s[i - 1]!.x)).toBeLessThanOrEqual(0.25 + 1e-9);
    expect(trackExpression(s)).toMatch(/^'max\(0,min\(iw-ow,iw\*\(.+\)-ow\/2\)\)'$/);
  });
});
