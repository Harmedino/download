import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errors.js';
import { LLM_UNAVAILABLE, llmModel, llmProvider, TRANSCRIBE_UNAVAILABLE, transcriber } from '../services/ai.js';
import { audioEncodeArgs, ffmpeg, inputArgs } from '../services/ffmpeg.js';
import { suggestMetadata, type Suggestions } from '../services/llm.js';
import { zipFiles } from '../services/storage.js';
import { cuesSchema, toTranscript, type Cue } from '../services/subtitles.js';
import { transcribe } from '../services/transcribe.js';
import { fileId, requireVideo, seconds } from './common.js';
import { grabFrame } from './frames.js';
import { languageSchema, writeSubtitleFiles } from './subtitles.js';
import { baseName, defineTool, type ToolOutputFile } from './types.js';

export const PACK_ITEMS = ['original', 'edited', 'thumbnail', 'audio', 'subtitles', 'transcript', 'frames', 'ai'] as const;
type Item = (typeof PACK_ITEMS)[number];

const schema = z.object({
  fileId,
  /** An edited version (e.g. an editor or shorts output) to include as well. */
  editedFileId: fileId.optional(),
  items: z.array(z.enum(PACK_ITEMS)).min(1),
  /** Where to take the thumbnail from; a third of the way in when omitted. */
  thumbnailTime: seconds.optional(),
  frameCount: z.number().int().min(3).max(30).default(8),
  language: languageSchema,
  /** Subtitles the user already generated and corrected; used instead of transcribing again. */
  cues: cuesSchema.optional(),
});

type Params = z.infer<typeof schema>;

/** Items that need speech-to-text (unless cues are supplied). */
const NEEDS_SPEECH: Item[] = ['subtitles', 'transcript'];

export const creatorPackTool = defineTool({
  schema,
  accepts: ['video'],
  fileIds: (p) => [p.fileId, ...(p.editedFileId ? [p.editedFileId] : [])],
  validate(p) {
    if (p.items.includes('edited') && !p.editedFileId) throw new AppError(400, 'INVALID_REQUEST', 'Choose the edited video to include, or untick "Edited video".');
  },
  summary: (p) => ({ format: `ZIP · ${p.items.length} item${p.items.length === 1 ? '' : 's'}`, resolution: 'Creator Pack' }),
  async run({ inputs, params: p, outDir, report }) {
    const [input, edited] = inputs;
    const i = requireVideo(input!);
    const base = baseName(input!.name);
    const want = new Set(p.items);
    const pack: ToolOutputFile[] = [];
    const skipped: Array<{ item: string; reason: string }> = [];
    const warnings: string[] = [];
    let suggestions: Suggestions | null = null;
    let aiSource: string | null = null;

    if (want.has('original')) pack.push({ path: input!.path, name: `video/${input!.name}` });
    if (want.has('edited') && edited) pack.push({ path: edited.path, name: `video/${edited.name}` });

    if (want.has('thumbnail')) {
      report(5, 'Making the thumbnail');
      const at = Math.min(p.thumbnailTime ?? i.duration / 3, Math.max(0, i.duration - 0.05));
      const out = path.join(outDir, 'thumbnail.jpg');
      await grabFrame(input!.path, at, out, 'jpg');
      pack.push({ path: out, name: `${base}_thumbnail.jpg`, mimeType: 'image/jpeg' });
    }

    if (want.has('audio')) {
      if (i.hasAudio) {
        report(10, 'Extracting audio');
        const out = path.join(outDir, 'audio.mp3');
        await ffmpeg([...inputArgs(input!.path), '-map', '0:a:0', ...audioEncodeArgs('mp3'), out], { duration: i.duration, onProgress: (pct) => report(10 + pct * 0.1, 'Extracting audio') });
        pack.push({ path: out, name: `audio/${base}.mp3` });
      } else skipped.push({ item: 'Audio', reason: 'the video has no audio track' });
    }

    // Speech: reuse supplied cues, otherwise transcribe once for subtitles, transcript and the AI step.
    let cues: Cue[] | null = p.cues ?? null;
    let language: string | null = p.language === 'auto' ? null : p.language;
    const speechWanted = NEEDS_SPEECH.some((k) => want.has(k)) || want.has('ai');
    if (!cues && speechWanted) {
      const provider = transcriber();
      if (!i.hasAudio) {
        for (const k of NEEDS_SPEECH) if (want.has(k)) skipped.push({ item: label(k), reason: 'the video has no audio track' });
      } else if (!provider) {
        for (const k of NEEDS_SPEECH) if (want.has(k)) skipped.push({ item: label(k), reason: TRANSCRIBE_UNAVAILABLE });
        if (want.has('ai')) warnings.push('No speech-to-text is configured, so the AI suggestions are based on the frames only.');
      } else {
        try {
          const t = await transcribe(provider, { input: input!.path, duration: i.duration, workDir: outDir, language: p.language, onProgress: (pct, stage) => report(20 + pct * 0.45, stage) });
          cues = t.cues;
          language = t.language;
        } catch (e) {
          if (!(e instanceof AppError)) throw e;
          // One failing service shouldn't sink the whole pack: report it and carry on.
          for (const k of NEEDS_SPEECH) if (want.has(k)) skipped.push({ item: label(k), reason: e.message });
          if (want.has('ai') && e.code !== 'NO_SPEECH') warnings.push(`Speech recognition failed (${e.message}), so the AI suggestions are based on the frames only.`);
        }
      }
    }
    if (cues) pack.push(...(await writeSubtitleFiles(cues, outDir, base, { subtitles: want.has('subtitles'), transcript: want.has('transcript') })).map((f) => ({ ...f, name: `text/${f.name}` })));

    const frameFiles: string[] = [];
    if (want.has('frames') || want.has('ai')) {
      report(66, 'Extracting frames');
      const dir = path.join(outDir, 'frames');
      await fsp.mkdir(dir);
      const n = want.has('frames') ? p.frameCount : 3;
      for (let k = 0; k < n; k++) {
        const at = (i.duration * (k + 0.5)) / n;
        const out = path.join(dir, `${String(k + 1).padStart(2, '0')}.jpg`);
        await grabFrame(input!.path, at, out, 'jpg');
        frameFiles.push(out);
        if (want.has('frames')) pack.push({ path: out, name: `frames/${base}_${String(k + 1).padStart(2, '0')}_${at.toFixed(1)}s.jpg` });
        report(66 + (k / n) * 10, 'Extracting frames');
      }
    }

    if (want.has('ai')) {
      const provider = llmProvider();
      if (!provider) skipped.push({ item: 'AI titles, descriptions and hashtags', reason: LLM_UNAVAILABLE });
      else {
        report(78, 'Writing titles and descriptions');
        try {
          // Three frames from across the video, downsized for the model.
          const picks = frameFiles.length <= 3 ? frameFiles : [0, Math.floor(frameFiles.length / 2), frameFiles.length - 1].map((k) => frameFiles[k]!);
          const frames = await Promise.all(picks.map((f) => sharp(f).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()));
          suggestions = await suggestMetadata(provider, { fileName: input!.name, durationSeconds: i.duration, transcript: cues ? toTranscript(cues) : null, language, frames });
          aiSource = `${provider} (${llmModel(provider)})`;
          const json = path.join(outDir, 'suggestions.json');
          await fsp.writeFile(json, JSON.stringify({ ...suggestions, generatedBy: aiSource, basedOn: cues ? 'transcript and frames' : 'frames only' }, null, 2), 'utf8');
          const txt = path.join(outDir, 'suggestions.txt');
          await fsp.writeFile(txt, suggestionsText(suggestions, aiSource), 'utf8');
          pack.push({ path: txt, name: 'text/ai_suggestions.txt', mimeType: 'text/plain' }, { path: json, name: 'text/ai_suggestions.json', mimeType: 'application/json' });
        } catch (e) {
          if (!(e instanceof AppError)) throw e;
          skipped.push({ item: 'AI titles, descriptions and hashtags', reason: e.message });
        }
      }
    }

    if (!pack.length) throw new AppError(422, 'PACK_EMPTY', `Nothing could be added to the pack: ${skipped.map((s) => `${s.item}: ${s.reason}`).join(' ')}`);

    report(90, 'Creating ZIP');
    const readme = path.join(outDir, 'README.txt');
    await fsp.writeFile(readme, readmeText(input!.name, pack, skipped, aiSource), 'utf8');
    const zip = path.join(outDir, 'creator_pack.zip');
    await zipFiles([{ path: readme, name: 'README.txt' }, ...pack.map((f) => ({ path: f.path, name: f.name }))], zip);

    const thumb = pack.find((f) => f.name.endsWith('_thumbnail.jpg'));
    for (const s of skipped) warnings.push(`${s.item} skipped: ${s.reason}`);
    return {
      files: [{ path: zip, name: `${base}_creator_pack.zip`, mimeType: 'application/zip' }, ...(thumb ? [{ ...thumb, name: path.basename(thumb.name) }] : [])],
      result: { suggestions, aiSource, included: pack.map((f) => f.name), skipped, cues: p.cues ? null : cues, language },
      warnings,
    };
  },
});

function label(k: Item): string {
  return { original: 'Original video', edited: 'Edited video', thumbnail: 'Thumbnail', audio: 'Audio', subtitles: 'Subtitles', transcript: 'Transcript', frames: 'Frames', ai: 'AI suggestions' }[k];
}

function suggestionsText(s: Suggestions, source: string): string {
  return [
    `AI suggestions (drafts by ${source}; review before publishing)`,
    '',
    'TITLES',
    ...s.titles.map((t, k) => `${k + 1}. ${t}`),
    '',
    'DESCRIPTIONS',
    ...s.descriptions.flatMap((d, k) => [`${k + 1}. ${d}`, '']),
    'HASHTAGS',
    s.hashtags.join(' '),
    '',
    'NOTES',
    s.notes,
    '',
  ].join('\n');
}

function readmeText(source: string, pack: ToolOutputFile[], skipped: Array<{ item: string; reason: string }>, aiSource: string | null): string {
  return [
    `Creator Pack for "${source}"`,
    `Made with SnapGrab on ${new Date().toISOString().slice(0, 10)}.`,
    '',
    'Included:',
    ...pack.map((f) => `  - ${f.name}`),
    ...(skipped.length ? ['', 'Not included:', ...skipped.map((s) => `  - ${s.item}: ${s.reason}`)] : []),
    ...(aiSource ? ['', `The titles, descriptions and hashtags are AI drafts by ${aiSource}, based only on this video's transcript and frames. Check them before you publish.`] : []),
    '',
    `Files on the SnapGrab server are deleted after ${env.FILE_TTL_MINUTES} minutes. Only publish content you own or have permission to use.`,
    '',
  ].join('\n');
}

export type CreatorPackParams = Params;
