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
    ['https://vimeo.com/76979871', 'vimeo'],
    ['https://dai.ly/x8abc', 'dailymotion'],
    ['https://clips.twitch.tv/Abc', 'twitch'],
    ['soundcloud.com/artist/track', 'soundcloud'],
    ['https://www.linkedin.com/posts/a-123-abcd', 'linkedin'],
    ['https://blog.tumblr.com/post/1', 'tumblr'],
    ['https://www.snapchat.com/spotlight/abc', 'snapchat'],
    ['https://bsky.app/profile/a.bsky.social/post/1', 'bluesky'],
    ['https://streamable.com/abc', 'streamable'],
    ['https://imgur.com/gallery/abc', 'imgur'],
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
