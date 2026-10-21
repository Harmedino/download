import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { checkBinaries } from '../src/services/binaries.js';

describe('GET /api/health', () => {
  beforeAll(async () => {
    await checkBinaries();
  });

  it('reports mongo state and binary availability', async () => {
    const res = await request(createApp()).get('/api/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('mongo');
    expect(res.body.binaries).toHaveProperty('yt-dlp');
    expect(res.body.binaries).toHaveProperty('ffmpeg');
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await request(createApp()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('allows the configured client origin', async () => {
    const res = await request(createApp()).get('/api/health').set('Origin', 'http://localhost:4200');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4200');
  });

  it('restricts CORS to the client origin', async () => {
    const res = await request(createApp()).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
});
