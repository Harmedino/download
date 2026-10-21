import { detectPlatform, looksLikeUrl } from './platform';

describe('detectPlatform', () => {
  it.each([
    ['https://www.tiktok.com/@a/video/1', 'tiktok'],
    ['instagram.com/p/abc', 'instagram'],
    ['https://youtu.be/x', 'youtube'],
    ['https://fb.watch/x', 'facebook'],
    ['https://x.com/a/status/1', 'twitter'],
    ['https://pin.it/abc', 'pinterest'],
    ['https://www.pinterest.co.uk/pin/1', 'pinterest'],
    ['https://old.reddit.com/r/a', 'reddit'],
  ])('%s -> %s', (url, platform) => {
    expect(detectPlatform(url)).toBe(platform);
  });

  it('returns null for unknown or empty input', () => {
    expect(detectPlatform('')).toBeNull();
    expect(detectPlatform('https://example.com')).toBeNull();
    expect(detectPlatform('https://youtube.com.evil.io')).toBeNull();
    expect(detectPlatform('not a url')).toBeNull();
  });

  it('looksLikeUrl accepts links with and without scheme', () => {
    expect(looksLikeUrl('https://youtu.be/x')).toBe(true);
    expect(looksLikeUrl('tiktok.com/@a/video/1')).toBe(true);
    expect(looksLikeUrl('hello world')).toBe(false);
  });
});
