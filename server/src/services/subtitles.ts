import { z } from 'zod';
import { FONT_IDS, FONTS, type FontId } from './fonts.js';

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export const cueSchema = z
  .object({ start: z.number().min(0).max(86_400), end: z.number().min(0).max(86_400), text: z.string().trim().min(1).max(500) })
  .refine((c) => c.end > c.start, 'cue end must be after its start');
export const cuesSchema = z.array(cueSchema).min(1).max(5000);

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb color');
export const subtitleStyleSchema = z.object({
  font: z.enum(FONT_IDS).default('sans'),
  /** Font size as a fraction of the video height. */
  size: z.number().min(0.02).max(0.12).default(0.05),
  color: hex.default('#ffffff'),
  outline: hex.default('#000000'),
  position: z.enum(['bottom', 'middle', 'top']).default('bottom'),
  /** Distance from the top or bottom edge, as a fraction of the height. */
  margin: z.number().min(0).max(0.4).default(0.06),
  /** Semi-transparent box behind the text instead of an outline. */
  box: z.boolean().default(false),
  bold: z.boolean().default(true),
});
export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>;

export interface TimedWord {
  word: string;
  start: number;
  end: number;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
  words?: TimedWord[];
}

/**
 * Splits recognised speech into readable cues: at most `maxChars` characters (about two lines) and
 * `maxSeconds` long, breaking at sentence ends when possible. Uses word timings when the provider
 * returns them, otherwise spreads a segment's time over its text.
 */
export function buildCues(segments: Segment[], maxChars = 84, maxSeconds = 6): Cue[] {
  const cues: Cue[] = [];
  for (const seg of segments) {
    const text = seg.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    let words = seg.words?.filter((w) => w.word.trim()) ?? [];
    if (!words.length) {
      // No word timings: estimate them from character positions.
      const tokens = text.split(' ');
      const total = text.length || 1;
      let pos = 0;
      words = tokens.map((w) => {
        const start = seg.start + ((seg.end - seg.start) * pos) / total;
        pos += w.length + 1;
        return { word: w, start, end: seg.start + ((seg.end - seg.start) * Math.min(pos, total)) / total };
      });
    }
    let cur: TimedWord[] = [];
    const flush = () => {
      if (!cur.length) return;
      cues.push({ start: round(cur[0]!.start), end: round(Math.max(cur.at(-1)!.end, cur[0]!.start + 0.3)), text: cur.map((w) => w.word.trim()).join(' ') });
      cur = [];
    };
    for (const w of words) {
      const len = cur.reduce((n, x) => n + x.word.trim().length + 1, 0) + w.word.trim().length;
      if (cur.length && (len > maxChars || w.end - cur[0]!.start > maxSeconds)) flush();
      cur.push(w);
      if (/[.!?…。！？]$/.test(w.word.trim()) && len > maxChars * 0.4) flush();
    }
    flush();
  }
  // Never overlap: a cue ends when the next begins.
  for (let i = 0; i < cues.length - 1; i++) if (cues[i]!.end > cues[i + 1]!.start) cues[i]!.end = Math.max(cues[i]!.start + 0.1, cues[i + 1]!.start);
  return cues;
}

const round = (t: number) => Math.round(t * 1000) / 1000;

function clock(t: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`;
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${clock(c.start, ',')} --> ${clock(c.end, ',')}\n${c.text}\n`).join('\n');
}

export function toVtt(cues: Cue[]): string {
  // "-->" inside cue text would end the timing line in some players.
  return `WEBVTT\n\n${cues.map((c) => `${clock(c.start, '.')} --> ${clock(c.end, '.')}\n${c.text.replace(/-->/g, '->')}\n`).join('\n')}`;
}

/** Plain transcript with a timestamp at the start of each paragraph (every ~30 s). */
export function toTranscript(cues: Cue[]): string {
  const out: string[] = [];
  let para: string[] = [];
  let paraStart = 0;
  for (const c of cues) {
    if (!para.length) paraStart = c.start;
    para.push(c.text);
    if (c.end - paraStart > 30 && /[.!?…]$/.test(c.text)) {
      out.push(`[${clock(paraStart, '.').slice(0, 8)}] ${para.join(' ')}`);
      para = [];
    }
  }
  if (para.length) out.push(`[${clock(paraStart, '.').slice(0, 8)}] ${para.join(' ')}`);
  return out.join('\n\n') + '\n';
}

/** "#rrggbb" plus opacity (0 = opaque) -> ASS "&HAABBGGRR". */
function assColor(hex: string, alpha = 0): string {
  const h = hex.replace('#', '');
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** Cue text for ASS: braces would start override tags and backslashes escapes, so neither reaches libass. */
export function assText(text: string): string {
  return text.replace(/\\/g, '∖').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\r?\n/g, '\\N');
}

/** An ASS script that renders `cues` with `style` on a `width` x `height` video (for ffmpeg's ass filter). */
export function buildAss(cues: Cue[], style: SubtitleStyle, width: number, height: number): string {
  const size = Math.round(height * style.size);
  const font = FONTS[style.font as FontId].family;
  const align = { bottom: 2, middle: 5, top: 8 }[style.position];
  const marginV = style.position === 'middle' ? 0 : Math.round(height * style.margin);
  const marginH = Math.round(width * 0.05);
  const outline = style.box ? Math.max(2, Math.round(size * 0.25)) : Math.max(1, Math.round(size * 0.08));
  const borderStyle = style.box ? 3 : 1;
  const outlineColor = style.box ? assColor('#000000', 0.4) : assColor(style.outline);
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${font},${size},${assColor(style.color)},${assColor(style.color)},${outlineColor},${assColor('#000000', 0.5)},${style.bold ? -1 : 0},0,0,0,100,100,0,0,${borderStyle},${outline},0,${align},${marginH},${marginH},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${assText(c.text)}`),
    '',
  ].join('\n');
}
