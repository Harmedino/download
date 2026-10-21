import fsp from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errors.js';
import { providerError, transcribeKey, transcribeModel, type TranscribeProvider } from './ai.js';
import { ffmpeg, inputArgs, probe } from './ffmpeg.js';
import { buildCues, type Cue, type Segment } from './subtitles.js';

/** Ten-minute mono chunks at 48 kbps stay well under every provider's upload limit (~3.6 MB each). */
const CHUNK_SECONDS = 600;
const REQUEST_TIMEOUT_MS = 5 * 60_000;

export interface Transcript {
  cues: Cue[];
  /** Language the provider detected or was asked for, as it reports it. */
  language: string | null;
  provider: TranscribeProvider;
  model: string;
}

/** Speech-ready audio (16 kHz mono MP3), split into chunks with their start offsets. */
export async function speechChunks(input: string, workDir: string, duration: number, onProgress?: (pct: number) => void): Promise<Array<{ path: string; offset: number }>> {
  const dir = path.join(workDir, 'speech');
  await fsp.mkdir(dir, { recursive: true });
  await ffmpeg(
    [
      ...inputArgs(input),
      '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k',
      '-f', 'segment', '-segment_time', String(CHUNK_SECONDS), '-reset_timestamps', '1',
      path.join(dir, 'chunk_%03d.mp3'),
    ],
    { duration, onProgress },
  );
  const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.mp3')).sort();
  const chunks: Array<{ path: string; offset: number }> = [];
  let offset = 0;
  // Segments cut on packet boundaries, so measure each one instead of assuming 600 s.
  for (const f of files) {
    const p = path.join(dir, f);
    chunks.push({ path: p, offset });
    offset += (await probe(p)).duration ?? CHUNK_SECONDS;
  }
  return chunks;
}

/** fetch with a timeout; network failures become a clear AI_FAILED instead of a generic job error. */
export async function postJson<T>(service: string, url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, method: 'POST', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new AppError(502, 'AI_FAILED', `We couldn't reach ${service}. Please try again later.`);
  }
  if (!res.ok) throw providerError(service, res.status);
  return (await res.json()) as T;
}

interface WhisperResponse {
  language?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
  words?: Array<{ word: string; start: number; end: number }>;
  text?: string;
}

/** OpenAI and Groq share the Whisper-style /audio/transcriptions API. */
async function whisper(provider: 'openai' | 'groq', file: string, language: string): Promise<{ segments: Segment[]; language: string | null }> {
  const base = provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.groq.com/openai/v1';
  const form = new FormData();
  form.append('file', new Blob([await fsp.readFile(file)], { type: 'audio/mpeg' }), 'audio.mp3');
  form.append('model', transcribeModel(provider));
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  form.append('timestamp_granularities[]', 'word');
  if (language !== 'auto') form.append('language', language);
  const data = await postJson<WhisperResponse>(provider === 'openai' ? 'OpenAI speech-to-text' : 'Groq speech-to-text', `${base}/audio/transcriptions`, {
    headers: { Authorization: `Bearer ${transcribeKey(provider)}` },
    body: form,
  });
  const words = data.words ?? [];
  const segments: Segment[] = (data.segments ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text,
    words: words.filter((w) => w.start >= s.start - 0.01 && w.start < s.end),
  }));
  if (!segments.length && data.text?.trim()) segments.push({ start: 0, end: words.at(-1)?.end ?? 1, text: data.text, words });
  return { segments, language: data.language ?? null };
}

interface DeepgramResponse {
  results?: {
    channels?: Array<{ detected_language?: string }>;
    utterances?: Array<{ start: number; end: number; transcript: string; words?: Array<{ word: string; punctuated_word?: string; start: number; end: number }> }>;
  };
}

async function deepgram(file: string, language: string): Promise<{ segments: Segment[]; language: string | null }> {
  const q = new URLSearchParams({ model: env.DEEPGRAM_MODEL, smart_format: 'true', punctuate: 'true', utterances: 'true' });
  if (language === 'auto') q.set('detect_language', 'true');
  else q.set('language', language);
  const data = await postJson<DeepgramResponse>('Deepgram', `https://api.deepgram.com/v1/listen?${q}`, {
    headers: { Authorization: `Token ${transcribeKey('deepgram')}`, 'Content-Type': 'audio/mpeg' },
    body: await fsp.readFile(file),
  });
  const segments = (data.results?.utterances ?? []).map((u) => ({
    start: u.start,
    end: u.end,
    text: u.transcript,
    words: u.words?.map((w) => ({ word: w.punctuated_word ?? w.word, start: w.start, end: w.end })),
  }));
  return { segments, language: language === 'auto' ? (data.results?.channels?.[0]?.detected_language ?? null) : language };
}

/**
 * Real speech recognition with the configured provider: the audio is sent in chunks, timings are
 * shifted back onto the source timeline, and the result is split into subtitle cues.
 */
export async function transcribe(
  provider: TranscribeProvider,
  o: { input: string; duration: number; workDir: string; language: string; onProgress?: (pct: number, stage: string) => void },
): Promise<Transcript> {
  o.onProgress?.(0, 'Preparing audio');
  const chunks = await speechChunks(o.input, o.workDir, o.duration, (p) => o.onProgress?.(p * 0.15, 'Preparing audio'));
  const segments: Segment[] = [];
  let language: string | null = null;
  for (const [k, c] of chunks.entries()) {
    o.onProgress?.(15 + (k / chunks.length) * 80, chunks.length > 1 ? `Recognising speech (part ${k + 1} of ${chunks.length})` : 'Recognising speech');
    const r = provider === 'deepgram' ? await deepgram(c.path, o.language) : await whisper(provider, c.path, o.language);
    language ??= r.language;
    for (const s of r.segments) {
      segments.push({ start: s.start + c.offset, end: s.end + c.offset, text: s.text, words: s.words?.map((w) => ({ ...w, start: w.start + c.offset, end: w.end + c.offset })) });
    }
  }
  await fsp.rm(path.join(o.workDir, 'speech'), { recursive: true, force: true });
  const cues = buildCues(segments);
  if (!cues.length) throw new AppError(422, 'NO_SPEECH', "We couldn't hear any speech in this file.");
  return { cues, language, provider, model: transcribeModel(provider) };
}
