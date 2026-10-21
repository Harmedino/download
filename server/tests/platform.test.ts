import { describe, expect, it } from 'vitest';
import { detectPlatform, validateMediaUrl } from '../src/services/platform.js';

describe('detectPlatform', () => {
  it.each([
    ['www.tiktok.com', 'tiktok'],
    ['vm.tiktok.com', 'tiktok'],
    ['www.instagram.com', 'instagram'],
    ['youtu.be', 'youtube'],
    ['m.youtube.com', 'youtube'],
    ['fb.watch', 'facebook'],
    ['web.facebook.com', 'facebook'],
    ['x.com', 'twitter'],
    ['mobile.twitter.com', 'twitter'],
    ['pin.it', 'pinterest'],
    ['www.pinterest.co.uk', 'pinterest'],
    ['old.reddit.com', 'reddit'],
    ['v.redd.it', 'reddit'],
    ['vimeo.com', 'vimeo'],
    ['player.vimeo.com', 'vimeo'],
    ['www.dailymotion.com', 'dailymotion'],
    ['dai.ly', 'dailymotion'],
    ['clips.twitch.tv', 'twitch'],
    ['m.twitch.tv', 'twitch'],
    ['soundcloud.com', 'soundcloud'],
    ['on.soundcloud.com', 'soundcloud'],
    ['www.linkedin.com', 'linkedin'],
    ['someblog.tumblr.com', 'tumblr'],
    ['www.snapchat.com', 'snapchat'],
    ['bsky.app', 'bluesky'],
    ['streamable.com', 'streamable'],
    ['i.imgur.com', 'imgur'],
  ])('%s -> %s', (host, platform) => {
    expect(detectPlatform(host)).toBe(platform);
  });

  it.each(['example.com', 'notyoutube.com', 'youtube.com.evil.io', 'reddit.co', 'vimeo.com.evil.io', 'notimgur.com', 'twitch.tv.example', 'localhost', '127.0.0.1'])('rejects %s', (host) => {
    expect(detectPlatform(host)).toBeNull();
  });
});

describe('validateMediaUrl', () => {
  it('normalizes scheme-less links and strips the hash', () => {
    expect(validateMediaUrl('youtube.com/watch?v=abc#t=10')).toEqual({ url: 'https://youtube.com/watch?v=abc', platform: 'youtube' });
  });

  it('upgrades http to https', () => {
    expect(validateMediaUrl('http://www.reddit.com/r/pics/comments/x').url).toMatch(/^https:/);
  });

  it.each([
    ['', 'INVALID_URL'],
    ['   ', 'INVALID_URL'],
    ['javascript:alert(1)', 'INVALID_URL'],
    ['file:///etc/passwd', 'INVALID_URL'],
    ['https://user:pass@youtube.com/watch?v=1', 'INVALID_URL'],
    ['https://youtube.com:8443/watch?v=1', 'INVALID_URL'],
    ['https://youtube.com/watch?v=1 ; rm -rf /', 'INVALID_URL'],
    ['https://youtube.com/\nwatch', 'INVALID_URL'],
    ['https://example.com/video.mp4', 'UNSUPPORTED_PLATFORM'],
    ['http://169.254.169.254/latest/meta-data', 'UNSUPPORTED_PLATFORM'],
  ])('rejects %j with %s', (input, code) => {
    expect(() => validateMediaUrl(input)).toThrow(expect.objectContaining({ code }));
  });

  it('rejects non-strings', () => {
    expect(() => validateMediaUrl(42)).toThrow(expect.objectContaining({ code: 'INVALID_URL' }));
  });
});
