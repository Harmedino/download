import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { aiStatus, llmProvider, transcriber } from '../src/services/ai.js';
import { checkBinaries } from '../src/services/binaries.js';
import { probe } from '../src/services/ffmpeg.js';
import { assText, buildAss, buildCues, toSrt, toVtt, subtitleStyleSchema } from '../src/services/subtitles.js';
import { creatorPackTool } from '../src/tools/creatorPack.js';
import { shortsTool } from '../src/tools/shorts.js';
import { burnSubtitlesTool, subtitlesTool } from '../src/tools/subtitles.js';
import { asInput, makeClip, runTool } from './helpers/media.js';

const ID = 'a'.repeat(24);
let clip: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  await checkBinaries();
  clip = makeClip('speech.mp4', { width: 640, height: 360, seconds: 5 });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(env, { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GROQ_API_KEY: '', DEEPGRAM_API_KEY: '', TRANSCRIBE_PROVIDER: 'auto', LLM_PROVIDER: 'auto' });
});

type Call = { url: string; init: RequestInit };
function stubFetch(handler: (url: string, init: RequestInit) => unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = input instanceof Request ? await input.text() : init.body;
    calls.push({ url, init: { ...init, body: body as BodyInit } });
    const out = handler(url, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return calls;
}

const WHISPER = {
  language: 'english',
  text: 'Hello and welcome. Today we test subtitles.',
  segments: [
    { start: 0.2, end: 1.8, text: ' Hello and welcome.' },
    { start: 2.0, end: 4.1, text: ' Today we test {subtitles}.' },
  ],
  words: [
    { word: 'Hello', start: 0.2, end: 0.6 },
    { word: 'and', start: 0.6, end: 0.8 },
    { word: 'welcome.', start: 0.8, end: 1.8 },
    { word: 'Today', start: 2.0, end: 2.4 },
    { word: 'we', start: 2.4, end: 2.6 },
    { word: 'test', start: 2.6, end: 3.0 },
    { word: '{subtitles}.', start: 3.0, end: 4.1 },
  ],
};

describe('subtitle formats', () => {
  it('splits long speech into readable, non-overlapping cues', () => {
    const words = Array.from({ length: 40 }, (_, k) => ({ word: `word${k}${k % 13 === 12 ? '.' : ''}`, start: k * 0.4, end: k * 0.4 + 0.35 }));
    const cues = buildCues([{ start: 0, end: 16, text: words.map((w) => w.word).join(' '), words }]);
    expect(cues.length).toBeGreaterThan(3);
    for (const c of cues) {
      expect(c.text.length).toBeLessThanOrEqual(84);
      expect(c.end - c.start).toBeLessThanOrEqual(6.4);
    }
    for (let k = 1; k < cues.length; k++) expect(cues[k]!.start).toBeGreaterThanOrEqual(cues[k - 1]!.end);
  });

  it('estimates timings when a provider gives none', () => {
    const cues = buildCues([{ start: 10, end: 14, text: 'one two three four' }]);
    expect(cues[0]).toMatchObject({ start: 10, text: 'one two three four' });
    expect(cues).toHaveLength(1);
    expect(cues[0]!.end).toBeCloseTo(14, 1);
  });

  it('writes SRT and VTT', () => {
    const cues = [{ start: 1.5, end: 3725.25, text: 'Hi --> there' }];
    expect(toSrt(cues)).toBe('1\n00:00:01,500 --> 01:02:05,250\nHi --> there\n');
    expect(toVtt(cues)).toBe('WEBVTT\n\n00:00:01.500 --> 01:02:05.250\nHi -> there\n');
  });

  it('keeps user text out of ASS override tags', () => {
    expect(assText('a {\\pos(0,0)} b\nc')).toBe('a (∖pos(0,0)) b\\Nc');
    const ass = buildAss([{ start: 0, end: 1, text: 'x' }], subtitleStyleSchema.parse({ position: 'top', box: true, color: '#ff8000' }), 1080, 1920);
    expect(ass).toContain('PlayResY: 1920');
    expect(ass).toMatch(/Style: Default,DejaVu Sans,96,&H000080FF,.*,3,24,0,8,54,54,115,1/);
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,x');
  });
});

describe('AI provider settings', () => {
  it('reports nothing configured without keys, and never the keys themselves', () => {
    expect(aiStatus()).toEqual({ transcription: null, llm: null });
    Object.assign(env, { GROQ_API_KEY: 'gsk_secret', ANTHROPIC_API_KEY: 'sk-ant-secret' });
    expect(transcriber()).toBe('groq');
    expect(llmProvider()).toBe('anthropic');
    expect(JSON.stringify(aiStatus())).not.toContain('secret');
    Object.assign(env, { LLM_PROVIDER: 'openai' });
    expect(llmProvider()).toBeNull();
    Object.assign(env, { TRANSCRIBE_PROVIDER: 'none' });
    expect(transcriber()).toBeNull();
  });

  it('refuses subtitle jobs when no speech-to-text is configured', () => {
    expect(() => subtitlesTool.requires!({ fileId: ID, language: 'auto' })).toThrow(expect.objectContaining({ code: 'AI_UNAVAILABLE' }));
  });
});

describe('subtitle generator', () => {
  it('transcribes with OpenAI and writes SRT, VTT and a transcript', async () => {
    env.OPENAI_API_KEY = 'sk-test';
    const calls = stubFetch(() => WHISPER);
    const res = await runTool(subtitlesTool, { fileId: ID, language: 'en' }, [await asInput(clip)]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const form = calls[0]!.init.body as FormData;
    expect(form.get('language')).toBe('en');
    expect(form.getAll('timestamp_granularities[]')).toEqual(['segment', 'word']);
    expect(res.files.map((f) => path.extname(f.name))).toEqual(['.srt', '.vtt', '.txt']);
    expect(fs.readFileSync(res.files[0]!.path, 'utf8')).toContain('00:00:00,200 --> 00:00:01,800\nHello and welcome.');
    expect(res.result).toMatchObject({ language: 'english', provider: 'openai', cues: [{ start: 0.2, text: 'Hello and welcome.' }, { text: 'Today we test {subtitles}.' }] });
  });

  it('uses Deepgram utterances', async () => {
    Object.assign(env, { DEEPGRAM_API_KEY: 'dg-test', TRANSCRIBE_PROVIDER: 'deepgram' });
    const calls = stubFetch(() => ({ results: { channels: [{ detected_language: 'es' }], utterances: [{ start: 0.5, end: 2, transcript: 'Hola a todos.', words: [] }] } }));
    const res = await runTool(subtitlesTool, { fileId: ID }, [await asInput(clip)]);
    expect(calls[0]!.url).toMatch(/^https:\/\/api\.deepgram\.com\/v1\/listen\?model=nova-3&.*detect_language=true/);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Token dg-test');
    expect(res.result).toMatchObject({ language: 'es', cues: [{ start: 0.5, end: 2, text: 'Hola a todos.' }] });
  });

  it('explains a rejected key without leaking it', async () => {
    env.OPENAI_API_KEY = 'sk-bad';
    stubFetch(() => new Response('{"error":"invalid key sk-bad"}', { status: 401 }));
    const err = await runTool(subtitlesTool, { fileId: ID }, [await asInput(clip)]).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'AI_FAILED' });
    expect((err as Error).message).not.toContain('sk-bad');
  });

  it('reports silence as NO_SPEECH', async () => {
    env.GROQ_API_KEY = 'gsk';
    stubFetch(() => ({ text: '', segments: [], words: [] }));
    await expect(runTool(subtitlesTool, { fileId: ID }, [await asInput(clip)])).rejects.toMatchObject({ code: 'NO_SPEECH' });
  });
});

describe('burning in subtitles', () => {
  it('renders styled subtitles onto the video', async () => {
    const res = await runTool(
      burnSubtitlesTool,
      { fileId: ID, cues: [{ start: 0, end: 2, text: 'Hello {\\b1} world' }, { start: 2, end: 4, text: 'Line two' }], style: { position: 'top', box: true, size: 0.08 } },
      [await asInput(clip)],
    );
    expect(await probe(res.files[0]!.path)).toMatchObject({ width: 640, height: 360, hasAudio: true });
    expect(fs.readFileSync(path.join(res.outDir, 'subs.ass'), 'utf8')).toContain('Hello (∖b1) world');
  });

  it('adds subtitles to a short, shifted to the clip start', async () => {
    const res = await runTool(shortsTool, { fileId: ID, start: 1, end: 4, height: 1280, subtitles: { cues: [{ start: 0, end: 1.5, text: 'early' }, { start: 2, end: 3, text: 'middle' }, { start: 4.5, end: 5, text: 'late' }] } }, [await asInput(clip)]);
    expect(await probe(res.files[0]!.path)).toMatchObject({ width: 720, height: 1280 });
    const ass = fs.readFileSync(path.join(res.outDir, 'subs.ass'), 'utf8');
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:00.50,Default,,0,0,0,,early');
    expect(ass).toContain('Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,middle');
    expect(ass).not.toContain('late');
  });
});

const listZip = (zip: string) => execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n').sort();
const readZip = (zip: string, name: string) => execFileSync('unzip', ['-p', zip, name], { encoding: 'utf8' });

describe('creator pack', () => {
  it('packs what it can and explains what it skipped when no AI is configured', async () => {
    const res = await runTool(creatorPackTool, { fileId: ID, items: ['original', 'thumbnail', 'audio', 'subtitles', 'transcript', 'frames', 'ai'], frameCount: 3 }, [await asInput(clip, 'talk.mp4')]);
    const zip = res.files[0]!.path;
    expect(listZip(zip)).toEqual(['README.txt', 'audio/talk.mp3', 'frames/talk_01_0.8s.jpg', 'frames/talk_02_2.5s.jpg', 'frames/talk_03_4.2s.jpg', 'talk_thumbnail.jpg', 'video/talk.mp4']);
    const readme = readZip(zip, 'README.txt');
    expect(readme).toMatch(/Not included:[\s\S]*Subtitles: Speech-to-text is not set up/);
    expect(readme).toContain('AI titles, descriptions and hashtags: AI titles, descriptions and hashtags are not set up');
    expect(res.warnings!.length).toBeGreaterThanOrEqual(3);
    expect(res.result).toMatchObject({ suggestions: null });
  });

  it('adds subtitles, a transcript and grounded AI suggestions from Anthropic', async () => {
    Object.assign(env, { OPENAI_API_KEY: 'sk-openai', ANTHROPIC_API_KEY: 'sk-ant-test' });
    const suggestions = { titles: ['Testing subtitles', 'A quick hello'], descriptions: ['We say hello and test subtitles.'], hashtags: ['subtitles', '#test', '#test'], notes: 'Based on the transcript and frames.' };
    const calls = stubFetch((url) => {
      if (url.includes('openai.com')) return WHISPER;
      return { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(suggestions) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } };
    });
    const res = await runTool(creatorPackTool, { fileId: ID, items: ['subtitles', 'transcript', 'ai'] }, [await asInput(clip, 'talk.mp4')]);
    const msg = calls.find((c) => c.url.startsWith('https://api.anthropic.com/v1/messages'))!;
    const body = JSON.parse(String(msg.init.body));
    expect(body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'medium', format: { type: 'json_schema' } } });
    expect(body.messages[0].content.filter((c: { type: string }) => c.type === 'image')).toHaveLength(3);
    expect(body.messages[0].content.at(-1).text).toContain('Hello and welcome.');
    expect(listZip(res.files[0]!.path)).toEqual(['README.txt', 'text/ai_suggestions.json', 'text/ai_suggestions.txt', 'text/talk.srt', 'text/talk.vtt', 'text/talk_transcript.txt']);
    expect(res.result).toMatchObject({ aiSource: 'anthropic (claude-opus-5-5)', suggestions: { hashtags: ['#subtitles', '#test'] } });
  });

  it('uses supplied cues instead of transcribing again', async () => {
    const calls = stubFetch(() => {
      throw new Error('no network expected');
    });
    const res = await runTool(creatorPackTool, { fileId: ID, items: ['subtitles'], cues: [{ start: 0, end: 1, text: 'Edited line' }] }, [await asInput(clip, 'talk.mp4')]);
    expect(calls).toHaveLength(0);
    expect(readZip(res.files[0]!.path, 'text/talk.srt')).toContain('Edited line');
  });

  it('fails clearly when nothing could be packed', async () => {
    await expect(runTool(creatorPackTool, { fileId: ID, items: ['subtitles'] }, [await asInput(clip, 'talk.mp4')])).rejects.toMatchObject({ code: 'PACK_EMPTY' });
  });
});
