import { beforeAll, describe, expect, it } from 'vitest';
import { checkBinaries } from '../src/services/binaries.js';
import { probe } from '../src/services/ffmpeg.js';
import { atempoChain, buildEditGraph, editSchema, editTool, keepSegments, outputSize } from '../src/tools/edit.js';
import { asInput, makeClip, runTool } from './helpers/media.js';

const ID = 'a'.repeat(24);
let landscape: string;
let other: string;
let silent: string;

beforeAll(async () => {
  await checkBinaries();
  landscape = makeClip('edit-a.mp4', { width: 640, height: 360, seconds: 4 });
  other = makeClip('edit-b.mp4', { width: 480, height: 480, seconds: 3 });
  silent = makeClip('edit-silent.mp4', { width: 640, height: 360, seconds: 2, audio: false });
});

describe('edit planning', () => {
  it('removes cut sections and merges overlapping cuts', () => {
    expect(keepSegments(0, 10, [{ start: 2, end: 3 }, { start: 2.5, end: 4 }, { start: 8, end: 12 }])).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 8 },
    ]);
    expect(keepSegments(1, 5, [])).toEqual([{ start: 1, end: 5 }]);
  });

  it('chains atempo for speeds outside 0.5-2', () => {
    expect(atempoChain(4)).toEqual(['atempo=2', 'atempo=2']);
    expect(atempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
    expect(atempoChain(1)).toEqual([]);
  });

  it('computes output sizes for every aspect ratio', () => {
    const src = { width: 1920, height: 1080 };
    const base = { rotate: 0, fit: 'fill', aspect: 'original' } as const;
    expect(outputSize(src, { ...base })).toEqual({ width: 1920, height: 1080 });
    expect(outputSize(src, { ...base, aspect: '9:16' })).toEqual({ width: 608, height: 1080 });
    expect(outputSize(src, { ...base, aspect: '1:1' })).toEqual({ width: 1080, height: 1080 });
    expect(outputSize(src, { ...base, aspect: '4:5' })).toEqual({ width: 864, height: 1080 });
    expect(outputSize(src, { ...base, aspect: '9:16', fit: 'blur' })).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(src, { ...base, rotate: 90 })).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(src, { ...base, resolution: 720 })).toEqual({ width: 1280, height: 720 });
    expect(outputSize(src, { ...base, crop: { x: 0.25, y: 0, w: 0.5, h: 1 } })).toEqual({ width: 960, height: 1080 });
  });

  it('never puts user text into the filter graph', async () => {
    const p = editSchema.parse({ clips: [{ fileId: ID }], texts: [{ text: "evil',drawtext=text=x:[out];movie=/etc/passwd" }] });
    const g = buildEditGraph(p, [await asInput(landscape)]);
    expect(g.filter).not.toContain('passwd');
    expect(g.filter).toContain('textfile=text0.txt:expansion=none');
    expect(g.textFiles[0]!.text).toContain('passwd');
  });

  it('rejects cuts that remove everything', async () => {
    const p = editSchema.parse({ clips: [{ fileId: ID, start: 1, end: 2, cuts: [{ start: 0, end: 3 }] }] });
    const input = await asInput(landscape);
    expect(() => buildEditGraph(p, [input])).toThrowError(expect.objectContaining({ code: 'INVALID_RANGE' }));
  });
});

describe('edit rendering', () => {
  it('trims a video', async () => {
    const res = await runTool(editTool, { clips: [{ fileId: ID, start: 1, end: 3 }] }, [await asInput(landscape)]);
    const info = await probe(res.files[0]!.path);
    expect(info.duration).toBeGreaterThan(1.8);
    expect(info.duration).toBeLessThan(2.3);
    expect(info).toMatchObject({ width: 640, height: 360, hasAudio: true });
  });

  it('cuts a section out, converts to 9:16 and adds text, speed and colour changes', async () => {
    const res = await runTool(
      editTool,
      {
        clips: [{ fileId: ID, cuts: [{ start: 1, end: 2 }] }],
        aspect: '9:16',
        crop: { x: 0.3, y: 0, w: 0.3164, h: 1 },
        speed: 1.5,
        brightness: 0.1,
        contrast: 1.2,
        saturation: 1.3,
        texts: [{ text: 'Hello: world, 100%', start: 0, end: 1 }],
        fadeIn: 0.3,
        fadeOut: 0.3,
      },
      [await asInput(landscape)],
    );
    const info = await probe(res.files[0]!.path);
    expect(info.width! / info.height!).toBeCloseTo(9 / 16, 1);
    expect(info.duration).toBeGreaterThan(1.8);
    expect(info.duration).toBeLessThan(2.3); // (4 - 1) / 1.5
  });

  it('merges clips of different sizes with a crossfade, including one without audio', async () => {
    const res = await runTool(
      editTool,
      { clips: [{ fileId: ID }, { fileId: ID }, { fileId: ID }], transition: 'fade', transitionDuration: 0.5, fit: 'blur', rotate: 0 },
      [await asInput(landscape), await asInput(other), await asInput(silent)],
    );
    const info = await probe(res.files[0]!.path);
    expect(info).toMatchObject({ width: 640, height: 360, hasAudio: true });
    expect(info.duration).toBeGreaterThan(7.7); // 4 + 3 + 2 - 2 * 0.5
    expect(info.duration).toBeLessThan(8.4);
  });

  it('rotates, mutes and writes WebM', async () => {
    const res = await runTool(editTool, { clips: [{ fileId: ID, end: 1 }], rotate: 90, flipH: true, mute: true, format: 'webm', resolution: 360 }, [
      await asInput(landscape),
    ]);
    const info = await probe(res.files[0]!.path);
    expect(info).toMatchObject({ width: 360, height: 640, hasAudio: false, videoCodec: 'vp9' });
  });
});
