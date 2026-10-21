import { spawn } from 'node:child_process';
import { env } from '../config/env.js';

export type BinaryName = 'yt-dlp' | 'gallery-dl' | 'ffmpeg' | 'ffprobe';

export interface BinaryStatus {
  name: BinaryName;
  path: string;
  available: boolean;
  version?: string;
  error?: string;
  installHint: string;
}

const BINARIES: Record<BinaryName, { path: () => string; args: string[]; installHint: string }> = {
  'yt-dlp': {
    path: () => env.YTDLP_PATH,
    args: ['--version'],
    installHint: 'Install yt-dlp: `pip install -U yt-dlp` or download from https://github.com/yt-dlp/yt-dlp/releases, then set YTDLP_PATH if it is not on PATH.',
  },
  'gallery-dl': {
    path: () => env.GALLERYDL_PATH,
    args: ['--version'],
    installHint: 'Install gallery-dl: `pip install -U gallery-dl`, then set GALLERYDL_PATH if it is not on PATH.',
  },
  ffmpeg: {
    path: () => env.FFMPEG_PATH,
    args: ['-version'],
    installHint: 'Install ffmpeg (e.g. `apt install ffmpeg` or `brew install ffmpeg`), then set FFMPEG_PATH if it is not on PATH.',
  },
  ffprobe: {
    path: () => env.FFPROBE_PATH,
    args: ['-version'],
    installHint: 'ffprobe ships with ffmpeg. Install ffmpeg, then set FFPROBE_PATH if it is not on PATH.',
  },
};

const cache = new Map<BinaryName, BinaryStatus>();

function probe(name: BinaryName): Promise<BinaryStatus> {
  const def = BINARIES[name];
  const bin = def.path();
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (s: BinaryStatus) => {
      if (!settled) {
        settled = true;
        resolve(s);
      }
    };
    try {
      const child = spawn(bin, def.args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 });
      child.stdout.on('data', (d) => (out += d));
      child.on('error', (err) => done({ name, path: bin, available: false, error: err.message, installHint: def.installHint }));
      child.on('close', (code) => {
        if (code === 0) {
          done({ name, path: bin, available: true, version: out.split('\n')[0]?.trim(), installHint: def.installHint });
        } else {
          done({ name, path: bin, available: false, error: `exited with code ${code}`, installHint: def.installHint });
        }
      });
    } catch (err) {
      done({ name, path: bin, available: false, error: (err as Error).message, installHint: def.installHint });
    }
  });
}

export async function checkBinaries(): Promise<BinaryStatus[]> {
  const results = await Promise.all((Object.keys(BINARIES) as BinaryName[]).map(probe));
  for (const r of results) cache.set(r.name, r);
  return results;
}

export function binaryStatus(name: BinaryName): BinaryStatus | undefined {
  return cache.get(name);
}

export class MissingBinaryError extends Error {
  readonly status = 503;
  readonly code = 'BINARY_MISSING';
  constructor(public readonly binary: BinaryName) {
    super(`${binary} is not installed on the server. ${BINARIES[binary].installHint}`);
  }
}

/** Throws a clear error if a required binary was not found at startup. */
export function requireBinary(name: BinaryName): string {
  const s = cache.get(name);
  if (!s?.available) throw new MissingBinaryError(name);
  return s.path;
}
