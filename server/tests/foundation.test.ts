import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashClientId } from '../src/middleware/owner.js';
import { checkBinaries } from '../src/services/binaries.js';
import { parseProbe, probe, progressFromLine, validateMedia } from '../src/services/ffmpeg.js';
import { downloadToFile, inspectRemoteFile, isPublicAddress, safeRequest } from '../src/services/safeFetch.js';
import { directMetadata, resolveSource } from '../src/services/sources.js';
import { mapExtractorError } from '../src/services/ytdlp.js';
import { compressTool, planTarget } from '../src/tools/compress.js';
import { convertTool } from '../src/tools/convert.js';
import { FIXTURES, asInput, makeClip, runTool } from './helpers/media.js';

let clip: string;

beforeAll(async () => {
  await checkBinaries();
  clip = makeClip('clip.mp4', { width: 640, height: 360, seconds: 3 });
});

describe('SSRF protection', () => {
  it('only treats global unicast addresses as public', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '2001:db8::1', '2002:7f00:1::1', 'not-an-ip']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it('refuses IP-literal, metadata and odd-port URLs before connecting', async () => {
    for (const url of ['http://127.0.0.1/x.mp4', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/a.mp4', 'http://10.0.0.5/a.mp4']) {
      await expect(safeRequest(url), url).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' });
    }
    await expect(safeRequest('https://example.com:8443/a.mp4')).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' });
    await expect(safeRequest('file:///etc/passwd')).rejects.toMatchObject({ code: 'INVALID_URL' });
    await expect(safeRequest('http://user:pw@example.com/a.mp4')).rejects.toMatchObject({ code: 'INVALID_URL' });
  });

  it('refuses hostnames that resolve to private addresses', async () => {
    await expect(safeRequest('http://localhost/a.mp4')).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' });
  });

  describe('against a local server', () => {
    let server: http.Server;
    let base: string;
    // Only the test server's loopback address is "public" here; everything else uses the real rules.
    const allowLoopback = { isAllowedAddress: (ip: string) => ip === '127.0.0.1' || isPublicAddress(ip), allowedPorts: [] as string[] };

    beforeAll(async () => {
      const mp4 = await fsp.readFile(clip);
      server = http.createServer((req, res) => {
        if (req.url === '/clip.mp4') {
          res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': mp4.length });
          return res.end(req.method === 'HEAD' ? undefined : mp4);
        }
        if (req.url === '/page') {
          res.writeHead(200, { 'content-type': 'text/html' });
          return res.end('<html></html>');
        }
        if (req.url === '/to-metadata') {
          res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
          return res.end();
        }
        if (req.url === '/to-clip') {
          res.writeHead(301, { location: '/clip.mp4' });
          return res.end();
        }
        if (req.url === '/loop') {
          res.writeHead(302, { location: '/loop' });
          return res.end();
        }
        if (req.url === '/huge') {
          res.writeHead(200, { 'content-type': 'video/mp4' });
          // No content-length: the size limit has to be enforced while streaming.
          const chunk = Buffer.alloc(64 * 1024);
          let sent = 0;
          const pump = () => {
            while (sent < 4 * 1024 * 1024) {
              sent += chunk.length;
              if (!res.write(chunk)) return res.once('drain', pump);
            }
            res.end();
          };
          return pump();
        }
        res.writeHead(404).end();
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      // A hostname (not an IP literal) so the DNS check path is exercised.
      const port = String((server.address() as AddressInfo).port);
      allowLoopback.allowedPorts.push(port);
      base = `http://127.0.0.1:${port}`;
    });
    afterAll(() => server.close());

    const at = (p: string) => base + p;

    it('blocks a redirect to the cloud metadata address', async () => {
      await expect(safeRequest(at('/to-metadata'), allowLoopback)).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' });
    });

    it('follows safe redirects, stops redirect loops, and reads file headers', async () => {
      const info = await inspectRemoteFile(at('/to-clip'), allowLoopback);
      expect(info.contentType).toBe('video/mp4');
      expect(info.fileName).toBe('clip.mp4');
      expect(info.size).toBeGreaterThan(1000);
      await expect(safeRequest(at('/loop'), allowLoopback)).rejects.toMatchObject({ code: 'TOO_MANY_REDIRECTS' });
    });

    it('stops streaming once a download passes the size limit', async () => {
      const dest = path.join(FIXTURES, 'huge.bin');
      await expect(downloadToFile(at('/huge'), dest, { ...allowLoopback, maxBytes: 1024 * 1024 })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    });

    it('imports a direct media link and validates it with ffprobe', async () => {
      const meta = await directMetadata(at('/clip.mp4'), allowLoopback);
      expect(meta).toMatchObject({ extractor: 'direct', kind: 'video', title: 'clip', filesize: expect.any(Number) });
      const dest = path.join(FIXTURES, 'imported.mp4');
      await downloadToFile(at('/clip.mp4'), dest, { ...allowLoopback, maxBytes: 50 * 1024 * 1024 });
      const info = await validateMedia(dest);
      expect(info).toMatchObject({ kind: 'video', width: 640, height: 360, hasAudio: true });
    });

    it('explains that a web page on an unsupported site is not a media file', async () => {
      await expect(directMetadata(at('/page'), allowLoopback)).rejects.toMatchObject({ code: 'UNSUPPORTED_SOURCE' });
    });
  });
});

describe('link detection', () => {
  it('routes supported platforms to their extractor and other links to the direct-file importer', () => {
    expect(resolveSource('https://youtu.be/dQw4w9WgXcQ')).toMatchObject({ platform: 'youtube' });
    expect(resolveSource('https://cdn.example.com/videos/clip.mp4#t=3')).toEqual({ url: 'https://cdn.example.com/videos/clip.mp4', platform: 'direct' });
  });

  it('refuses DRM and subscription services with a clear reason', () => {
    for (const url of ['https://www.netflix.com/watch/123', 'https://open.spotify.com/track/abc', 'https://www.disneyplus.com/video/x', 'https://www.primevideo.com/detail/x']) {
      expect(() => resolveSource(url), url).toThrowError(expect.objectContaining({ code: 'PROTECTED_CONTENT' }));
    }
  });

  it('rejects non-http schemes and private ports', () => {
    expect(() => resolveSource('file:///etc/passwd')).toThrowError(expect.objectContaining({ code: 'INVALID_URL' }));
    expect(() => resolveSource('ftp://example.com/a.mp4')).toThrowError(expect.objectContaining({ code: 'INVALID_URL' }));
    expect(() => resolveSource('http://example.com:6379/')).toThrowError(expect.objectContaining({ code: 'INVALID_URL' }));
  });

  it('maps DRM errors from yt-dlp to PROTECTED_CONTENT', () => {
    expect(mapExtractorError('ERROR: [youtube] abc: This video is DRM protected').code).toBe('PROTECTED_CONTENT');
  });
});

describe('media validation', () => {
  it('reads duration, size and audio from a real file', async () => {
    const info = await probe(clip);
    expect(info).toMatchObject({ kind: 'video', width: 640, height: 360, hasAudio: true, videoCodec: 'h264', audioCodec: 'aac', fps: 25 });
    expect(info.duration).toBeCloseTo(3, 0);
  });

  it('applies rotation metadata to the display size', () => {
    const info = parseProbe({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '5.0' },
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30/1', side_data_list: [{ rotation: -90 }] }],
    });
    expect(info).toMatchObject({ width: 1080, height: 1920, fps: 30, hasAudio: false });
  });

  it('rejects playlists disguised as videos, so ffmpeg never reads other files', async () => {
    const evil = path.join(FIXTURES, 'evil.mp4');
    await fsp.writeFile(evil, '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:10.0,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n');
    await expect(validateMedia(evil)).rejects.toMatchObject({ code: 'INVALID_VIDEO' });
    const concat = path.join(FIXTURES, 'evil.mkv');
    await fsp.writeFile(concat, "ffconcat version 1.0\nfile '/etc/passwd'\n");
    await expect(validateMedia(concat)).rejects.toMatchObject({ code: 'INVALID_VIDEO' });
  });

  it('rejects files that are not media', async () => {
    const txt = path.join(FIXTURES, 'notes.mp4');
    await fsp.writeFile(txt, 'hello world');
    await expect(validateMedia(txt)).rejects.toMatchObject({ code: 'INVALID_VIDEO' });
  });

  it('parses ffmpeg progress lines', () => {
    expect(progressFromLine('out_time_us=1500000', 3)).toBe(50);
    expect(progressFromLine('out_time_ms=6000000', 3)).toBe(100);
    expect(progressFromLine('frame=12', 3)).toBeNull();
  });
});

describe('convert', () => {
  it('converts MP4 to WebM at a lower resolution', async () => {
    const res = await runTool(convertTool, { fileId: 'a'.repeat(24), format: 'webm', resolution: 360 }, [await asInput(clip)]);
    const info = await probe(res.files[0]!.path);
    expect(info).toMatchObject({ videoCodec: 'vp9', audioCodec: 'opus', width: 640, height: 360 });
    expect(res.files[0]!.name).toBe('clip.webm');
  });

  it('remuxes without re-encoding when nothing changes', async () => {
    const res = await runTool(convertTool, { fileId: 'a'.repeat(24), format: 'mov' }, [await asInput(clip)]);
    expect((await probe(res.files[0]!.path)).videoCodec).toBe('h264');
  });

  it('extracts audio to MP3', async () => {
    const res = await runTool(convertTool, { fileId: 'a'.repeat(24), format: 'mp3' }, [await asInput(clip)]);
    expect(await probe(res.files[0]!.path)).toMatchObject({ kind: 'audio', audioCodec: 'mp3' });
  });

  it('refuses a video format for audio-only input', async () => {
    const audio = path.join(FIXTURES, 'tone.mp3');
    if (!fs.existsSync(audio)) await runTool(convertTool, { fileId: 'a'.repeat(24), format: 'mp3' }, [await asInput(clip)]).then((r) => fsp.copyFile(r.files[0]!.path, audio));
    await expect(runTool(convertTool, { fileId: 'a'.repeat(24), format: 'mp4' }, [await asInput(audio)])).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('compress', () => {
  it('makes a smaller file at the "small" level', async () => {
    const big = makeClip('big.mp4', { width: 1280, height: 720, seconds: 3 });
    const input = await asInput(big);
    const res = await runTool(compressTool, { fileId: 'a'.repeat(24), level: 'small', resolution: 480 }, [input]);
    const out = await probe(res.files[0]!.path);
    expect(out).toMatchObject({ width: 854, height: 480, videoCodec: 'h264' });
  });

  it('plans bitrate and resolution for a size target, and explains impossible targets', () => {
    const plan = planTarget(10, 60, 1920, 1080, true);
    expect(plan.videoBitrate).toBeGreaterThan(1_000_000);
    expect(plan.videoBitrate).toBeLessThan(1_400_000);
    expect(plan.size).toEqual({ width: 1280, height: 720 });
    expect(() => planTarget(1, 600, 1920, 1080, true)).toThrowError(expect.objectContaining({ code: 'TARGET_TOO_SMALL' }));
  });
});

describe('API', () => {
  it('advertises limits and available tools', async () => {
    const res = await request(createApp()).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fileTtlMinutes: expect.any(Number), maxMediaUploadMb: expect.any(Number) });
    expect(res.body.tools).toEqual(expect.arrayContaining(['convert', 'compress']));
  });

  it('allows the X-Client-Id header and DELETE in CORS preflight', async () => {
    const res = await request(createApp())
      .options('/api/history')
      .set('Origin', 'http://localhost:4200')
      .set('Access-Control-Request-Method', 'DELETE')
      .set('Access-Control-Request-Headers', 'x-client-id');
    expect(res.headers['access-control-allow-methods']).toContain('DELETE');
    expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain('x-client-id');
  });

  it('stores only a hash of the client id', () => {
    expect(hashClientId('abc')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashClientId('abc')).not.toContain('abc');
  });
});
