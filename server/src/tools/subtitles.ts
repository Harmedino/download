import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AppError } from '../middleware/errors.js';
import { requireTranscriber } from '../services/ai.js';
import { ffmpeg, inputArgs, videoEncodeArgs, VIDEO_CONTAINERS, type VideoContainer } from '../services/ffmpeg.js';
import { buildAss, cuesSchema, subtitleStyleSchema, toSrt, toTranscript, toVtt, type Cue, type SubtitleStyle } from '../services/subtitles.js';
import { transcribe } from '../services/transcribe.js';
import { fileId } from './common.js';
import { baseName, defineTool, resolutionOf, type ToolOutputFile } from './types.js';

/** "auto" or an ISO 639-1/639-3 code ("en", "es", "yue"). */
export const languageSchema = z.string().regex(/^(auto|[a-z]{2,3})$/, 'must be "auto" or a language code like "en"').default('auto');

/** SRT, VTT and transcript files for a set of cues. Shared with the Creator Pack. */
export async function writeSubtitleFiles(cues: Cue[], outDir: string, base: string, which: { subtitles: boolean; transcript: boolean }): Promise<ToolOutputFile[]> {
  const files: ToolOutputFile[] = [];
  if (which.subtitles) {
    await fsp.writeFile(path.join(outDir, 'subtitles.srt'), toSrt(cues), 'utf8');
    await fsp.writeFile(path.join(outDir, 'subtitles.vtt'), toVtt(cues), 'utf8');
    files.push({ path: path.join(outDir, 'subtitles.srt'), name: `${base}.srt`, mimeType: 'application/x-subrip' }, { path: path.join(outDir, 'subtitles.vtt'), name: `${base}.vtt`, mimeType: 'text/vtt' });
  }
  if (which.transcript) {
    await fsp.writeFile(path.join(outDir, 'transcript.txt'), toTranscript(cues), 'utf8');
    files.push({ path: path.join(outDir, 'transcript.txt'), name: `${base}_transcript.txt`, mimeType: 'text/plain' });
  }
  return files;
}

export const subtitlesTool = defineTool({
  schema: z.object({ fileId, language: languageSchema }),
  accepts: ['video', 'audio'],
  fileIds: (p) => [p.fileId],
  requires: () => void requireTranscriber(),
  validate(_p, [input]) {
    if (!input!.info.hasAudio) throw new AppError(400, 'AUDIO_UNAVAILABLE', 'This video has no audio track, so there is no speech to turn into subtitles.');
  },
  summary: (p) => ({ format: `SRT + VTT · ${p.language === 'auto' ? 'auto language' : p.language.toUpperCase()}`, resolution: 'Subtitles' }),
  async run({ inputs: [input], params: p, outDir, report }) {
    const provider = requireTranscriber();
    const t = await transcribe(provider, { input: input!.path, duration: input!.info.duration ?? 0, workDir: outDir, language: p.language, onProgress: (pct, stage) => report(pct * 0.97, stage) });
    report(98, 'Writing subtitle files');
    const files = await writeSubtitleFiles(t.cues, outDir, baseName(input!.name), { subtitles: true, transcript: true });
    return { files, result: { cues: t.cues, language: t.language, provider: t.provider, model: t.model } };
  },
});

/** Writes `subs.ass` into `dir` and returns the ffmpeg filter that burns it in (a relative path, so no escaping). */
export async function assFilter(dir: string, cues: Cue[], style: SubtitleStyle, width: number, height: number): Promise<string> {
  await fsp.writeFile(path.join(dir, 'subs.ass'), buildAss(cues, style, width, height), 'utf8');
  return 'ass=subs.ass';
}

export const burnSubtitlesTool = defineTool({
  schema: z.object({
    fileId,
    cues: cuesSchema,
    style: subtitleStyleSchema.default(subtitleStyleSchema.parse({})),
    format: z.enum(VIDEO_CONTAINERS as unknown as [VideoContainer, ...VideoContainer[]]).default('mp4'),
  }),
  accepts: ['video'],
  fileIds: (p) => [p.fileId],
  summary: (p, [input]) => ({ format: `${p.format.toUpperCase()} · burned-in subtitles`, resolution: resolutionOf(input!.info.width, input!.info.height) }),
  async run({ inputs: [input], params: p, outDir, report }) {
    const i = input!.info;
    if (!i.width || !i.height) throw new AppError(415, 'UNSUPPORTED_FILE', 'This tool needs a video file.');
    // Even dimensions for yuv420p; subtitles are laid out on the output size.
    const w = i.width - (i.width % 2);
    const h = i.height - (i.height % 2);
    const filter = await assFilter(outDir, p.cues, p.style, w, h);
    const out = `subtitled.${p.format}`;
    report(0, 'Burning in subtitles');
    await ffmpeg(
      [
        ...inputArgs(input!.path),
        '-map', '0:v:0', ...(i.hasAudio ? ['-map', '0:a:0'] : []),
        '-vf', `scale=${w}:${h},setsar=1,${filter}`,
        ...videoEncodeArgs(p.format, { hasAudio: i.hasAudio }),
        out,
      ],
      { duration: i.duration ?? undefined, cwd: outDir, onProgress: (pct) => report(pct, 'Burning in subtitles') },
    );
    return { files: [{ path: path.join(outDir, out), name: `${baseName(input!.name)}_subtitled.${p.format}` }] };
  },
});
