import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { compose, cutout, decodeImage, removeImageBackground, type RawImage } from '../src/services/bgremove.js';

const dir = path.join(env.TEMP_DIR, 'bg-test');
const W = 64;
const H = 48;

/** RGBA image: opaque red square in the middle, fully transparent elsewhere. */
function fakeCutout(): RawImage {
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inside = x >= 16 && x < 48 && y >= 12 && y < 36;
      data[i] = 255;
      data[i + 3] = inside ? 255 : 0;
    }
  return { data, width: W, height: H };
}

async function pixel(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

describe('background compositing', () => {
  const cut = fakeCutout();
  let original: RawImage;

  beforeAll(async () => {
    await fs.mkdir(dir, { recursive: true });
    const { data } = await sharp({ create: { width: W, height: H, channels: 4, background: '#00ff00' } }).raw().toBuffer({ resolveWithObject: true });
    original = { data, width: W, height: H };
  });

  it('transparent keeps alpha', async () => {
    const png = await compose(cut, original, { mode: 'transparent' });
    expect(await pixel(png, 0, 0)).toEqual([255, 0, 0, 0].map((v, i) => (i === 3 ? 0 : expect.any(Number))));
    expect((await pixel(png, 32, 24))[3]).toBe(255);
  });

  it('color fills the background', async () => {
    const png = await compose(cut, original, { mode: 'color', color: '#0000ff' });
    expect(await pixel(png, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(await pixel(png, 32, 24)).toEqual([255, 0, 0, 255]);
  });

  it('blur uses the original image behind the subject', async () => {
    const png = await compose(cut, original, { mode: 'blur', blur: 50 });
    expect(await pixel(png, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(await pixel(png, 32, 24)).toEqual([255, 0, 0, 255]);
  });

  it('image places a custom background scaled to cover', async () => {
    const bgPath = path.join(dir, 'bg.png');
    await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffff00' } }).png().toFile(bgPath);
    const png = await compose(cut, original, { mode: 'image', imagePath: bgPath });
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([W, H]);
    expect(await pixel(png, 0, 0)).toEqual([255, 255, 0, 255]);
  });

  it('rejects files that are not images', async () => {
    const bad = path.join(dir, 'bad.png');
    await fs.writeFile(bad, 'not an image');
    await expect(decodeImage(bad)).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });
});

describe('model inference (runs the real local model)', () => {
  it('keeps the subject and removes the background of a person drawing', async () => {
    const cut = await cutout(await decodeImage(path.join(import.meta.dirname, 'fixtures', 'person.svg')));
    const alphaAt = (x: number, y: number) => cut.data[(y * cut.width + x) * 4 + 3]!;
    expect(alphaAt(10, 10)).toBeLessThan(20); // sky
    expect(alphaAt(256, 170)).toBeGreaterThan(235); // face
    expect(alphaAt(256, 450)).toBeGreaterThan(235); // body
  }, 60_000);

  it('produces an RGBA cutout with the input size', async () => {
    const input = path.join(dir, 'photo.png');
    await fs.mkdir(dir, { recursive: true });
    await sharp({ create: { width: 200, height: 120, channels: 3, background: '#3366cc' } })
      .composite([{ input: Buffer.from('<svg width="200" height="120"><circle cx="100" cy="60" r="40" fill="#ffcc00"/></svg>') }])
      .png()
      .toFile(input);
    const img = await decodeImage(input);
    const cut = await cutout(img);
    expect([cut.width, cut.height]).toEqual([200, 120]);
    expect(cut.data.length).toBe(200 * 120 * 4);

    const out = await removeImageBackground(input, { mode: 'color', color: '#ffffff' });
    const meta = await sharp(out.transparentPng).metadata();
    expect(meta.hasAlpha).toBe(true);
    expect((await sharp(out.finalPng).metadata()).width).toBe(200);
  }, 60_000);
});

describe('POST /api/remove-bg/image without a database', () => {
  it('fails fast with DB_UNAVAILABLE', async () => {
    const res = await request(createApp()).post('/api/remove-bg/image').send({ fileId: 'x' });
    expect(res.status).toBe(503);
  });
});
