import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { probe } from '../../src/services/ffmpeg.js';
import type { ToolContext, ToolInput, ToolResult } from '../../src/tools/types.js';
import type { ToolDef } from '../../src/tools/types.js';

export const FIXTURES = path.resolve('tmp/test/fixtures');

/** Generates a small test clip with ffmpeg's built-in sources (cached between runs). */
export function makeClip(name: string, o: { width?: number; height?: number; seconds?: number; audio?: boolean; rotate?: number } = {}): string {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const out = path.join(FIXTURES, name);
  if (fs.existsSync(out)) return out;
  const { width = 320, height = 180, seconds = 3, audio = true } = o;
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}:d=${seconds}:r=25`];
  if (audio) args.push('-f', 'lavfi', '-i', `sine=f=440:d=${seconds}`);
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
  if (audio) args.push('-c:a', 'aac', '-shortest');
  if (o.rotate) args.push('-metadata:s:v:0', `rotate=${o.rotate}`);
  args.push(out);
  execFileSync('ffmpeg', args);
  return out;
}

export async function asInput(file: string, name = path.basename(file)): Promise<ToolInput> {
  return { id: '0'.repeat(24), path: file, name, info: await probe(file) };
}

/** Runs a tool the way the media processor does, in a fresh output directory. */
export async function runTool<P>(tool: ToolDef, params: P, inputs: ToolInput[]): Promise<ToolResult & { outDir: string }> {
  const outDir = path.resolve('tmp/test/out', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fsp.mkdir(outDir, { recursive: true });
  const parsed = tool.schema.parse(params);
  tool.validate?.(parsed, inputs);
  const ctx = { job: {} as never, jobId: 'test', outDir, inputs, params: parsed, report: () => undefined } as ToolContext<unknown>;
  const res = await tool.run(ctx);
  return { ...res, outDir };
}
