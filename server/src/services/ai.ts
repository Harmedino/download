import { env } from '../config/env.js';
import { AppError } from '../middleware/errors.js';

export type TranscribeProvider = 'openai' | 'groq' | 'deepgram';
export type LlmProvider = 'anthropic' | 'openai' | 'groq';

const has = (key: string | undefined) => !!key && key.trim().length > 0;

const TRANSCRIBE_KEYS: Record<TranscribeProvider, () => string | undefined> = {
  openai: () => env.OPENAI_API_KEY,
  groq: () => env.GROQ_API_KEY,
  deepgram: () => env.DEEPGRAM_API_KEY,
};
const LLM_KEYS: Record<LlmProvider, () => string | undefined> = {
  anthropic: () => env.ANTHROPIC_API_KEY,
  openai: () => env.OPENAI_API_KEY,
  groq: () => env.GROQ_API_KEY,
};

/** The speech-to-text provider in use, or null when none is configured. */
export function transcriber(): TranscribeProvider | null {
  const p = env.TRANSCRIBE_PROVIDER;
  if (p === 'none') return null;
  if (p !== 'auto') return has(TRANSCRIBE_KEYS[p]()) ? p : null;
  return (['openai', 'groq', 'deepgram'] as const).find((k) => has(TRANSCRIBE_KEYS[k]())) ?? null;
}

/** The text model provider in use, or null when none is configured. */
export function llmProvider(): LlmProvider | null {
  const p = env.LLM_PROVIDER;
  if (p === 'none') return null;
  if (p !== 'auto') return has(LLM_KEYS[p]()) ? p : null;
  return (['anthropic', 'openai', 'groq'] as const).find((k) => has(LLM_KEYS[k]())) ?? null;
}

export function transcribeKey(p: TranscribeProvider): string {
  return TRANSCRIBE_KEYS[p]()!.trim();
}

export function llmKey(p: LlmProvider): string {
  return LLM_KEYS[p]()!.trim();
}

/** Model names for the status line and the Creator Pack README. */
export function transcribeModel(p: TranscribeProvider): string {
  return { openai: env.OPENAI_TRANSCRIBE_MODEL, groq: env.GROQ_TRANSCRIBE_MODEL, deepgram: env.DEEPGRAM_MODEL }[p];
}

export function llmModel(p: LlmProvider): string {
  return { anthropic: env.ANTHROPIC_MODEL, openai: env.OPENAI_LLM_MODEL, groq: env.GROQ_LLM_MODEL }[p];
}

export const TRANSCRIBE_UNAVAILABLE = 'Speech-to-text is not set up on this server, so subtitles and transcripts are unavailable. The site owner can enable it with an OpenAI, Groq or Deepgram API key.';
export const LLM_UNAVAILABLE = 'AI titles, descriptions and hashtags are not set up on this server. The site owner can enable them with an Anthropic, OpenAI or Groq API key.';

export function requireTranscriber(): TranscribeProvider {
  const p = transcriber();
  if (!p) throw new AppError(503, 'AI_UNAVAILABLE', TRANSCRIBE_UNAVAILABLE);
  return p;
}

/** What /api/config reports: which AI features work, never the keys. */
export function aiStatus(): { transcription: { provider: TranscribeProvider; model: string } | null; llm: { provider: LlmProvider; model: string } | null } {
  const t = transcriber();
  const l = llmProvider();
  return { transcription: t ? { provider: t, model: transcribeModel(t) } : null, llm: l ? { provider: l, model: llmModel(l) } : null };
}

/** Turns a provider's HTTP failure into a message for the user, without echoing anything secret. */
export function providerError(service: string, status: number): AppError {
  if (status === 401 || status === 403) return new AppError(502, 'AI_FAILED', `${service} rejected this server's API key. The site owner needs to check it.`);
  if (status === 429) return new AppError(503, 'AI_RATE_LIMITED', `${service} is busy or this server's quota is used up. Please try again later.`);
  if (status === 413) return new AppError(413, 'AI_FAILED', `${service} could not accept that much audio.`);
  return new AppError(502, 'AI_FAILED', `${service} could not process this file (HTTP ${status}). Please try again later.`);
}
