import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { FONT_IDS, FONTS } from '../services/fonts.js';
import { fileId } from './common.js';
import { cropSchema } from './edit.js';
import { IMAGE_FORMATS, MIME } from './frames.js';
import { baseName, defineTool, resolutionOf } from './types.js';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb color');

const schema = z.object({
  fileId,
  crop: cropSchema.optional(),
  /** Output width in pixels; the original (cropped) size when omitted. Never upscales past 4K. */
  width: z.number().int().min(64).max(3840).optional(),
  brightness: z.number().min(0.3).max(2).default(1),
  contrast: z.number().min(0.5).max(2).default(1),
  saturation: z.number().min(0).max(3).default(1),
  sharpen: z.boolean().default(false),
  texts: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(120),
        /** Centre of the text, as fractions of the image. */
        x: z.number().min(0).max(1).default(0.5),
        y: z.number().min(0).max(1).default(0.5),
        size: z.number().min(0.02).max(0.4).default(0.12),
        color: hex.default('#ffffff'),
        stroke: hex.default('#000000'),
        font: z.enum(FONT_IDS).default('sans'),
      }),
    )
    .max(5)
    .default([]),
  format: z.enum(IMAGE_FORMATS).default('jpg'),
});

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

/** Text layer as SVG. Everything the user typed is XML-escaped; nothing is loaded from outside. */
export function textSvg(width: number, height: number, texts: z.infer<typeof schema>['texts']): string {
  const items = texts
    .map((t) => {
      const size = Math.round(height * t.size);
      return (
        `<text x="${Math.round(t.x * width)}" y="${Math.round(t.y * height)}" font-family="${xml(FONTS[t.font].family)}" font-weight="bold" font-size="${size}" ` +
        `fill="${t.color}" stroke="${t.stroke}" stroke-width="${Math.max(1, Math.round(size * 0.08))}" paint-order="stroke" stroke-linejoin="round" ` +
        `text-anchor="middle" dominant-baseline="middle">${xml(t.text)}</text>`
      );
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${items}</svg>`;
}

export const thumbnailTool = defineTool({
  schema,
  accepts: ['image'],
  fileIds: (p) => [p.fileId],
  summary(p, [input]) {
    const i = input!.info;
    const w = p.width ?? Math.round((i.width ?? 0) * (p.crop?.w ?? 1));
    const h = i.width && i.height ? Math.round((w / ((i.width ?? 1) * (p.crop?.w ?? 1))) * i.height * (p.crop?.h ?? 1)) : null;
    return { format: p.format.toUpperCase(), resolution: resolutionOf(w, h) };
  },
  async run({ inputs: [input], params: p, outDir, report }) {
    report(10, 'Editing image');
    let img = sharp(input!.path, { limitInputPixels: 80_000_000 }).rotate();
    const meta = await img.metadata();
    const W = meta.autoOrient?.width ?? meta.width ?? 0;
    const H = meta.autoOrient?.height ?? meta.height ?? 0;
    if (p.crop) {
      const left = Math.round(p.crop.x * W);
      const top = Math.round(p.crop.y * H);
      img = img.extract({ left, top, width: Math.max(1, Math.min(W - left, Math.round(p.crop.w * W))), height: Math.max(1, Math.min(H - top, Math.round(p.crop.h * H))) });
    }
    if (p.width) img = img.resize({ width: p.width, withoutEnlargement: false, kernel: 'lanczos3' });
    if (p.brightness !== 1 || p.saturation !== 1) img = img.modulate({ brightness: p.brightness, saturation: p.saturation });
    if (p.contrast !== 1) img = img.linear(p.contrast, 128 * (1 - p.contrast));
    if (p.sharpen) img = img.sharpen();

    // Render the edits so far, then lay the text on the final size.
    const base = await img.toBuffer({ resolveWithObject: true });
    let out = sharp(base.data);
    if (p.texts.length) out = out.composite([{ input: Buffer.from(textSvg(base.info.width, base.info.height, p.texts)), top: 0, left: 0 }]);
    const file = path.join(outDir, `thumbnail.${p.format}`);
    report(70, 'Saving');
    if (p.format === 'jpg') await out.jpeg({ quality: 92, mozjpeg: true }).toFile(file);
    else if (p.format === 'png') await out.png().toFile(file);
    else await out.webp({ quality: 90 }).toFile(file);
    return { files: [{ path: file, name: `${baseName(input!.name)}_thumbnail.${p.format}`, mimeType: MIME[p.format] }] };
  },
});
