import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { AppError } from '../middleware/errors.js';
import { llmKey, llmModel, providerError, type LlmProvider } from './ai.js';
import { postJson } from './transcribe.js';

export const suggestionsSchema = z.object({
  titles: z.array(z.string()),
  descriptions: z.array(z.string()),
  hashtags: z.array(z.string()),
  /** What the suggestions are based on, and anything the model could not tell from the material. */
  notes: z.string(),
});
export type Suggestions = z.infer<typeof suggestionsSchema>;

export interface SuggestionInput {
  /** The file name, as a hint only. */
  fileName: string;
  durationSeconds: number;
  /** The transcript, or null when there was none (no speech-to-text, or no speech). */
  transcript: string | null;
  language: string | null;
  /** A few JPEG frames from across the video. */
  frames: Buffer[];
}

const SYSTEM = `You write publishing metadata (titles, descriptions, hashtags) for a creator's own video.
You are given the video's transcript (when available) and a few still frames from it.

Ground everything in that material:
- Only describe what the transcript says or the frames clearly show. Do not invent people, places, brands, events, numbers, quotes or claims.
- Never promise anything the video does not deliver; no misleading or clickbait titles.
- If the material is thin (no transcript, or no speech), keep the suggestions general and say so in "notes".
- Write in the same language as the transcript; if there is no transcript, use English.

Return 5 titles (under 70 characters), 2 descriptions (2-4 sentences each, no hashtags inside), and 10-15 relevant hashtags (each starting with #, no spaces).
In "notes", say in one or two sentences what you based the suggestions on and what you could not tell.`;

function userText(i: SuggestionInput): string {
  const minutes = Math.max(1, Math.round(i.durationSeconds / 60));
  return [
    `File name (a hint only, may be meaningless): ${i.fileName}`,
    `Length: about ${minutes} minute${minutes === 1 ? '' : 's'}`,
    i.transcript ? `Transcript${i.language ? ` (language: ${i.language})` : ''}:\n<transcript>\n${i.transcript}\n</transcript>` : 'Transcript: not available.',
    `${i.frames.length} frame${i.frames.length === 1 ? '' : 's'} from across the video ${i.frames.length ? 'are attached' : 'are not available'}.`,
  ].join('\n\n');
}

/** Trims to the promised shape: models occasionally return extra items or hashtags without "#". */
function tidy(s: Suggestions): Suggestions {
  const tags = [...new Set(s.hashtags.map((h) => '#' + h.replace(/^#+/, '').replace(/\s+/g, '')).filter((h) => h.length > 1))];
  return {
    titles: s.titles.map((t) => t.trim()).filter(Boolean).slice(0, 5),
    descriptions: s.descriptions.map((d) => d.trim()).filter(Boolean).slice(0, 2),
    hashtags: tags.slice(0, 15),
    notes: s.notes.trim(),
  };
}

async function anthropic(i: SuggestionInput): Promise<Suggestions> {
  const client = new Anthropic({ apiKey: llmKey('anthropic'), timeout: 5 * 60_000, maxRetries: 2 });
  try {
    const res = await client.beta.messages.parse({
      model: llmModel('anthropic'),
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: zodOutputFormat(suggestionsSchema) },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...i.frames.map((f) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: f.toString('base64') } })),
            { type: 'text' as const, text: userText(i) },
          ],
        },
      ],
    });
    if (res.stop_reason === 'refusal') throw new AppError(422, 'AI_FAILED', 'The AI service declined to write suggestions for this video.');
    if (!res.parsed_output) throw new AppError(502, 'AI_FAILED', 'The AI service returned suggestions we could not read. Please try again.');
    return res.parsed_output;
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e instanceof Anthropic.APIError && typeof e.status === 'number') throw providerError('Anthropic', e.status);
    throw new AppError(502, 'AI_FAILED', "We couldn't reach Anthropic. Please try again later.");
  }
}

/** OpenAI and Groq share the chat completions API. Groq's default model has no vision, so it gets text only. */
async function chatCompletions(provider: 'openai' | 'groq', i: SuggestionInput): Promise<Suggestions> {
  const base = provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.groq.com/openai/v1';
  const service = provider === 'openai' ? 'OpenAI' : 'Groq';
  const input = provider === 'groq' ? { ...i, frames: [] } : i;
  const content =
    provider === 'openai'
      ? [...i.frames.map((f) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${f.toString('base64')}` } })), { type: 'text', text: userText(input) }]
      : userText(input);
  const data = await postJson<{ choices?: Array<{ message?: { content?: string } }> }>(service, `${base}/chat/completions`, {
    headers: { Authorization: `Bearer ${llmKey(provider)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: llmModel(provider),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${SYSTEM}\n\nRespond with a JSON object with keys "titles", "descriptions", "hashtags" (arrays of strings) and "notes" (a string).` },
        { role: 'user', content },
      ],
    }),
  });
  try {
    return suggestionsSchema.parse(JSON.parse(data.choices?.[0]?.message?.content ?? ''));
  } catch {
    throw new AppError(502, 'AI_FAILED', `${service} returned suggestions we could not read. Please try again.`);
  }
}

/** Titles, descriptions and hashtags from the configured text model, grounded in the transcript and frames. */
export async function suggestMetadata(provider: LlmProvider, input: SuggestionInput): Promise<Suggestions> {
  const raw = provider === 'anthropic' ? await anthropic(input) : await chatCompletions(provider, input);
  return tidy(raw);
}
