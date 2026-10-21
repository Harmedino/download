import { spawn } from 'node:child_process';

export interface RunOptions {
  timeoutMs?: number;
  cwd?: string;
  /** Called for every complete line on stdout/stderr (used for progress parsing). */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
  /** Upper bound on buffered stdout, protects against runaway output. */
  maxStdoutBytes?: number;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Runs a binary with an argument array. Never uses a shell, so user input
 * cannot be interpreted as shell syntax.
 */
export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const { timeoutMs = 120_000, maxStdoutBytes = 50 * 1024 * 1024 } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const partial = { stdout: '', stderr: '' };

    const feed = (stream: 'stdout' | 'stderr', chunk: string) => {
      if (!opts.onLine) return;
      const text = partial[stream] + chunk;
      const lines = text.split(/\r?\n|\r/);
      partial[stream] = lines.pop() ?? '';
      for (const l of lines) if (l) opts.onLine(l, stream);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      if (stdout.length < maxStdoutBytes) stdout += d;
      feed('stdout', d);
    });
    child.stderr.on('data', (d: string) => {
      if (stderr.length < 1024 * 1024) stderr += d;
      feed('stderr', d);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (opts.onLine) {
        if (partial.stdout) opts.onLine(partial.stdout, 'stdout');
        if (partial.stderr) opts.onLine(partial.stderr, 'stderr');
      }
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}
