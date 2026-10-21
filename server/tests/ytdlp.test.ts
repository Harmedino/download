import { describe, expect, it } from 'vitest';
import { createProgressTracker, formatSelector, mapExtractorError, normalizeYtdlpInfo } from '../src/services/ytdlp.js';
import { normalizeGalleryDlJson } from '../src/services/gallerydl.js';

// Hand-written fixtures shaped like `yt-dlp -J` / `gallery-dl -j` output.
// They exercise the parsing logic only; they are not captured from real platforms.

const landscape = {
  id: 'abc123',
  title: 'Sample video',
  uploader: 'someone',
  thumbnail: 'https://i.example/thumb.jpg',
  duration: 42,
  formats: [
    { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', abr: 128, filesize: 1_000_000 },
    { format_id: '134', ext: 'mp4', vcodec: 'avc1', acodec: 'none', width: 640, height: 360, tbr: 500, filesize: 3_000_000 },
    { format_id: '136', ext: 'mp4', vcodec: 'avc1', acodec: 'none', width: 1280, height: 720, tbr: 1500, filesize: 9_000_000 },
    { format_id: '137', ext: 'mp4', vcodec: 'avc1', acodec: 'none', width: 1920, height: 1080, tbr: 3000, filesize: 20_000_000 },
  ],
};

describe('normalizeYtdlpInfo', () => {
  it('builds quality presets with size estimates (video + best audio)', () => {
    const m = normalizeYtdlpInfo(landscape);
    expect(m.kind).toBe('video');
    expect(m.portrait).toBe(false);
    expect(m.hasAudio).toBe(true);
    expect(m.formats.map((f) => f.id)).toEqual(['360p', '720p', '1080p']);
    expect(m.formats.find((f) => f.id === '720p')?.filesize).toBe(10_000_000);
    expect(m.duration).toBe(42);
    expect(m.items).toHaveLength(1);
  });

  it('does not offer presets above the source resolution, but always offers best', () => {
    const m = normalizeYtdlpInfo({
      id: 'x',
      title: 't',
      formats: [{ format_id: 'a', ext: 'mp4', vcodec: 'h264', acodec: 'aac', width: 576, height: 1024, filesize: 5 }],
    });
    expect(m.portrait).toBe(true);
    expect(m.formats.map((f) => f.id)).toEqual(['best']);
    expect(m.formats[0]?.label).toBe('Best (576p)');
  });

  it('treats portrait 1080x1920 as 1080p', () => {
    const m = normalizeYtdlpInfo({
      id: 'x',
      title: 't',
      formats: [{ format_id: 'a', ext: 'mp4', vcodec: 'h264', acodec: 'aac', width: 1080, height: 1920 }],
    });
    expect(m.formats.map((f) => f.id)).toContain('1080p');
  });

  it('maps playlists to carousels with typed items', () => {
    const m = normalizeYtdlpInfo({
      _type: 'playlist',
      id: 'post',
      title: 'Carousel',
      entries: [
        { id: '1', ext: 'mp4', duration: 5, formats: [{ vcodec: 'h264', acodec: 'aac', width: 720, height: 720, ext: 'mp4' }], thumbnail: 't1' },
        { id: '2', ext: 'jpg', thumbnail: 't2' },
      ],
    });
    expect(m.kind).toBe('carousel');
    expect(m.items.map((i) => i.type)).toEqual(['video', 'image']);
    expect(m.formats).toEqual([]);
  });
});

describe('formatSelector', () => {
  it('limits by height for landscape and width for portrait', () => {
    expect(formatSelector('720p', false)).toBe('bv*[height<=720]+ba/b[height<=720]/bv*+ba/b');
    expect(formatSelector('720p', true)).toBe('bv*[width<=720]+ba/b[width<=720]/bv*+ba/b');
    expect(formatSelector('best', false)).toBe('bv*+ba/b');
    expect(formatSelector(undefined, false)).toBe('bv*+ba/b');
  });
});

describe('mapExtractorError', () => {
  it.each([
    ['ERROR: [Instagram] abc: Requested content is not available, rate-limit reached or login required', 'PRIVATE_POST'],
    ['ERROR: [youtube] x: Private video. Sign in if you\'ve been granted access to this video', 'PRIVATE_POST'],
    ["ERROR: [youtube] x: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.", 'UPSTREAM_BLOCKED'],
    ['ERROR: Unsupported URL: https://www.reddit.com/', 'UNSUPPORTED_URL'],
    ['ERROR: [youtube] x: Video unavailable', 'MEDIA_UNAVAILABLE'],
    ["ERROR: [twitter] 1: No video could be found in this tweet", 'NO_MEDIA'],
    ['ERROR: unable to download video data: HTTP Error 429: Too Many Requests', 'UPSTREAM_RATE_LIMITED'],
    ['ERROR: [generic] Unable to download webpage: <urlopen error [Errno -2] Name or service not known>', 'UPSTREAM_UNREACHABLE'],
    ['File is larger than max-filesize (600000000 bytes > 524288000 bytes). Aborting.', 'FILE_TOO_LARGE'],
    ['ERROR: something unexpected', 'FETCH_FAILED'],
  ])('%s -> %s', (stderr, code) => {
    expect(mapExtractorError(stderr).code).toBe(code);
  });
});

describe('createProgressTracker', () => {
  it('combines video and audio stream progress into one monotonic-ish number', () => {
    const seen: number[] = [];
    const track = createProgressTracker(2, (p) => seen.push(p));
    ['[sg]  10.0%', '[sg] 100.0%', '[sg]   0.0%', '[sg]  50.0%', '[sg] 100.0%', 'noise'].forEach(track);
    expect(seen).toEqual([5, 48, 48, 71, 95]);
  });
});

describe('normalizeGalleryDlJson', () => {
  it('reads files and post metadata', () => {
    const m = normalizeGalleryDlJson([
      [2, { category: 'instagram', post_id: '99', description: 'Hello  world', username: 'me' }],
      [3, 'https://cdn.example/1.jpg', { extension: 'jpg', width: 1080, height: 1350, num: 1 }],
      [3, 'https://cdn.example/2.mp4', { extension: 'mp4', width: 1080, height: 1920, num: 2, display_url: 'https://cdn.example/2.jpg' }],
    ]);
    expect(m.extractor).toBe('gallery-dl');
    expect(m.kind).toBe('carousel');
    expect(m.title).toBe('Hello world');
    expect(m.uploader).toBe('me');
    expect(m.items.map((i) => [i.type, i.thumbnail])).toEqual([
      ['image', 'https://cdn.example/1.jpg'],
      ['video', 'https://cdn.example/2.jpg'],
    ]);
  });

  it('throws NO_MEDIA when there are no files', () => {
    expect(() => normalizeGalleryDlJson([[2, {}]])).toThrow(expect.objectContaining({ code: 'NO_MEDIA' }));
  });

  it('maps gallery-dl error messages', () => {
    expect(() => normalizeGalleryDlJson([[-1, { error: 'AuthorizationError', message: 'Login required' }]])).toThrow(
      expect.objectContaining({ code: 'PRIVATE_POST' }),
    );
  });
});
