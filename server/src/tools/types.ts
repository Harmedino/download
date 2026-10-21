import type { z } from 'zod';
import type { JobDoc } from '../models/Job.js';
import type { MediaInfo } from '../services/ffmpeg.js';

export interface ToolInput {
  id: string;
  path: string;
  name: string;
  info: MediaInfo;
}

export interface ToolContext<P> {
  job: JobDoc;
  jobId: string;
  /** Empty directory for this job's outputs (and scratch files). */
  outDir: string;
  inputs: ToolInput[];
  params: P;
  /** 0-100 within the job, plus an optional stage label for the UI. */
  report: (pct: number, stage?: string) => void;
}

export interface ToolOutputFile {
  path: string;
  /** Download name; made header-safe when registered. */
  name: string;
  mimeType?: string;
}

export interface ToolResult {
  files: ToolOutputFile[];
  /** JSON the client needs besides files (subtitle cues, suggestions, ...). */
  result?: unknown;
  warnings?: string[];
}

export interface Summary {
  format: string;
  resolution: string;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  schema: S;
  /** Kinds of media each input may be. */
  accepts: Array<MediaInfo['kind']>;
  /** The file ids the job reads, in order. */
  fileIds(p: z.infer<S>): string[];
  /** Extra checks once inputs are probed; throw AppError to reject the request. */
  validate?(p: z.infer<S>, inputs: ToolInput[]): void;
  /** Throws when a required external service (speech-to-text, LLM) isn't configured. */
  requires?(p: z.infer<S>): void;
  summary(p: z.infer<S>, inputs: ToolInput[]): Summary;
  run(ctx: ToolContext<z.infer<S>>): Promise<ToolResult>;
}

export function defineTool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

/** "My clip.mp4" -> "My clip" */
export function baseName(name: string): string {
  return name.replace(/\.[^.]{1,6}$/, '').slice(0, 80) || 'snapgrab';
}

export function resolutionOf(w: number | null | undefined, h: number | null | undefined): string {
  return w && h ? `${w}x${h}` : 'Original';
}
