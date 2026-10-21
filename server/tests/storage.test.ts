import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { isInsideTempDir, listOutputFiles, safeFileName, sweepTempDir, zipFiles } from '../src/services/storage.js';

describe('storage helpers', () => {
  it('safeFileName strips unsafe characters', () => {
    expect(safeFileName('a/b\\c:"d"?*<x>|', 'MP4')).toBe('a b c d x.mp4');
    expect(safeFileName('   ', '.png')).toBe('snapgrab.png');
    expect(safeFileName('x'.repeat(300), 'zip').length).toBe(104);
  });

  it('isInsideTempDir blocks traversal', () => {
    expect(isInsideTempDir(path.join(env.TEMP_DIR, 'jobs/a/file.mp4'))).toBe(true);
    expect(isInsideTempDir(path.join(env.TEMP_DIR, '../escape.txt'))).toBe(false);
    expect(isInsideTempDir('/etc/passwd')).toBe(false);
    expect(isInsideTempDir(env.TEMP_DIR)).toBe(false);
  });

  it('lists finished files, zips them, and sweeps old entries', async () => {
    const dir = path.join(env.TEMP_DIR, 'jobs', 'test-job');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'b.mp4'), 'video');
    await fs.writeFile(path.join(dir, 'a.jpg'), 'image');
    await fs.writeFile(path.join(dir, 'c.mp4.part'), 'partial');
    const files = await listOutputFiles(dir);
    expect(files.map((f) => path.basename(f))).toEqual(['a.jpg', 'b.mp4']);

    const zip = path.join(dir, 'out.zip');
    await zipFiles(files.map((p, i) => ({ path: p, name: `${i}${path.extname(p)}` })), zip);
    const head = (await fs.readFile(zip)).subarray(0, 2).toString();
    expect(head).toBe('PK');

    expect(await sweepTempDir(60_000, Date.now() + 120_000)).toBeGreaterThanOrEqual(1);
    await expect(fs.stat(dir)).rejects.toThrow();
  });
});

describe('API routes without a database', () => {
  it('returns 503 DB_UNAVAILABLE instead of hanging', async () => {
    const res = await request(createApp()).post('/api/fetch').send({ url: 'https://youtu.be/x' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DB_UNAVAILABLE');
  });
});
