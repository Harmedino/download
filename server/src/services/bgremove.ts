import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { removeBackground, type Config } from '@imgly/background-removal-node';
import { AppError } from '../middleware/errors.js';

export type BackgroundMode = 'transparent' | 'color' | 'blur' | 'image';

export interface BackgroundOptions {
  mode: BackgroundMode;
  /** #rrggbb, used when mode is "color" */
  color?: string;
  /** Path of the replacement background, used when mode is "image" */
  imagePath?: string;
  /** Blur strength 1-100, used when mode is "blur" */
  blur?: number;
}

/** Longest side we feed the model; larger photos are scaled down (the model works at 1024 px internally). */
const MAX_SIDE = 4096;

// The library resolves its model relative to process.cwd() by default; point it at the installed package instead.
const require = createRequire(import.meta.url);
const PUBLIC_PATH = pathToFileURL(path.dirname(require.resolve('@imgly/background-removal-node')) + path.sep).href;

const CONFIG: Config = {
  publicPath: PUBLIC_PATH,
  model: 'medium',
  output: { format: 'image/x-rgba8' },
};

// One inference at a time: each run holds a 1024x1024 tensor and saturates the CPU,
// so parallel runs only add memory pressure without finishing sooner.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
}

/** Decodes any sharp-supported image to upright RGBA, capped at MAX_SIDE. */
export async function decodeImage(input: string | Buffer): Promise<RawImage> {
  try {
    const { data, info } = await sharp(input, { failOn: 'error', limitInputPixels: 100_000_000 })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new AppError(400, 'INVALID_IMAGE', "That file isn't an image we can read. Try a JPG, PNG or WebP.");
  }
}

/** Runs the segmentation model and returns RGBA pixels with the background made transparent. */
export async function cutout(img: RawImage): Promise<RawImage> {
  const blob = new Blob([new Uint8Array(img.data)], { type: `image/x-rgba8;width=${img.width};height=${img.height}` });
  const out = await serialized(() => removeBackground(blob, CONFIG));
  return { data: Buffer.from(await out.arrayBuffer()), width: img.width, height: img.height };
}

const rawInput = (img: RawImage) => ({ raw: { width: img.width, height: img.height, channels: 4 as const } });

/** Places the cutout on the requested background and encodes a PNG. */
export async function compose(cut: RawImage, original: RawImage, bg: BackgroundOptions): Promise<Buffer> {
  const fg = await sharp(cut.data, rawInput(cut)).png().toBuffer();
  switch (bg.mode) {
    case 'transparent':
      return sharp(fg).png({ compressionLevel: 9 }).toBuffer();
    case 'color':
      return sharp(fg).flatten({ background: bg.color ?? '#ffffff' }).png().toBuffer();
    case 'blur': {
      const strength = Math.max(1, Math.min(100, bg.blur ?? 40));
      const sigma = Math.max(0.5, (Math.max(cut.width, cut.height) / 1000) * strength * 0.4);
      const back = await sharp(original.data, rawInput(original)).removeAlpha().blur(sigma).png().toBuffer();
      return sharp(back).composite([{ input: fg }]).png().toBuffer();
    }
    case 'image': {
      if (!bg.imagePath) throw new AppError(400, 'INVALID_REQUEST', 'Choose a background image.');
      const back = await sharp(bg.imagePath, { failOn: 'error' })
        .rotate()
        .resize(cut.width, cut.height, { fit: 'cover' })
        .ensureAlpha()
        .png()
        .toBuffer()
        .catch(() => {
          throw new AppError(400, 'INVALID_IMAGE', "The background image isn't an image we can read.");
        });
      return sharp(back).composite([{ input: fg }]).png().toBuffer();
    }
  }
}

/** Convenience: file in, cutout + optional composite out. */
export async function removeImageBackground(inputPath: string, bg: BackgroundOptions) {
  const original = await decodeImage(inputPath);
  const cut = await cutout(original);
  const transparentPng = await compose(cut, original, { mode: 'transparent' });
  const finalPng = bg.mode === 'transparent' ? transparentPng : await compose(cut, original, bg);
  return { transparentPng, finalPng, width: cut.width, height: cut.height };
}
