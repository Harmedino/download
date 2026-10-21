import fs from 'node:fs';

/** Fonts the text and subtitle tools offer. The Docker image installs fonts-dejavu-core and fonts-liberation. */
export const FONTS = {
  sans: { label: 'Sans', family: 'DejaVu Sans', files: ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'] },
  serif: { label: 'Serif', family: 'DejaVu Serif', files: ['/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'] },
  mono: { label: 'Mono', family: 'DejaVu Sans Mono', files: ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'] },
  arial: { label: 'Arial-style', family: 'Liberation Sans', files: ['/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf'] },
  times: { label: 'Times-style', family: 'Liberation Serif', files: ['/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf'] },
} as const;

export type FontId = keyof typeof FONTS;
export const FONT_IDS = Object.keys(FONTS) as [FontId, ...FontId[]];

/** Absolute path of a font file for drawtext, falling back to any installed one. */
export function fontFile(id: FontId = 'sans'): string {
  for (const f of [...FONTS[id].files, ...FONTS.sans.files]) if (fs.existsSync(f)) return f;
  for (const font of Object.values(FONTS)) for (const f of font.files) if (fs.existsSync(f)) return f;
  return FONTS.sans.files[0];
}

/** "#ff00aa" -> "0xff00aa" (ffmpeg colour syntax, no characters that need filter escaping). */
export function ffColor(hex: string, alpha?: number): string {
  return `0x${hex.replace('#', '')}${alpha !== undefined ? `@${alpha}` : ''}`;
}
