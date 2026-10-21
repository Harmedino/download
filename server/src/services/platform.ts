import { AppError } from '../middleware/errors.js';

export const PLATFORMS = [
  'tiktok',
  'instagram',
  'youtube',
  'facebook',
  'twitter',
  'pinterest',
  'reddit',
  'vimeo',
  'dailymotion',
  'twitch',
  'soundcloud',
  'linkedin',
  'tumblr',
  'snapchat',
  'bluesky',
  'streamable',
  'imgur',
] as const;
export type Platform = (typeof PLATFORMS)[number];

const HOSTS: Record<Platform, Array<string | RegExp>> = {
  tiktok: ['tiktok.com'],
  instagram: ['instagram.com', 'instagr.am'],
  youtube: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
  facebook: ['facebook.com', 'fb.watch', 'fb.com'],
  twitter: ['twitter.com', 'x.com'],
  pinterest: [/^(?:.+\.)?pinterest\.(?:com|ca|de|fr|es|it|jp|ru|se|nz|ch|at|cl|pt|ie|dk|ph|co\.uk|co\.kr|com\.au|com\.mx)$/, 'pin.it'],
  reddit: ['reddit.com', 'redd.it'],
  vimeo: ['vimeo.com'],
  dailymotion: ['dailymotion.com', 'dai.ly'],
  twitch: ['twitch.tv'],
  soundcloud: ['soundcloud.com'],
  linkedin: ['linkedin.com'],
  tumblr: ['tumblr.com'],
  snapchat: ['snapchat.com'],
  bluesky: ['bsky.app'],
  streamable: ['streamable.com'],
  imgur: ['imgur.com'],
};

const MAX_URL_LENGTH = 2048;

function hostMatches(host: string, rule: string | RegExp): boolean {
  if (rule instanceof RegExp) return rule.test(host);
  return host === rule || host.endsWith(`.${rule}`);
}

export function detectPlatform(hostname: string): Platform | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  for (const p of PLATFORMS) {
    if (HOSTS[p].some((r) => hostMatches(host, r))) return p;
  }
  return null;
}

/**
 * Validates untrusted user input as a public post URL on a supported platform.
 * Only http(s) URLs on an allow-listed host pass, which also prevents SSRF to internal hosts.
 */
export function validateMediaUrl(input: unknown): { url: string; platform: Platform } {
  if (typeof input !== 'string' || !input.trim()) {
    throw new AppError(400, 'INVALID_URL', 'Please paste a link to a post.');
  }
  let raw = input.trim();
  if (raw.length > MAX_URL_LENGTH) throw new AppError(400, 'INVALID_URL', 'That link is too long.');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
  // Reject control characters and whitespace anywhere in the URL.
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) throw new AppError(400, 'INVALID_URL', "That doesn't look like a valid link.");

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AppError(400, 'INVALID_URL', "That doesn't look like a valid link.");
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AppError(400, 'INVALID_URL', 'Only http and https links are supported.');
  }
  if (parsed.username || parsed.password) throw new AppError(400, 'INVALID_URL', "That doesn't look like a valid link.");
  if (parsed.port && parsed.port !== '443' && parsed.port !== '80') {
    throw new AppError(400, 'INVALID_URL', "That doesn't look like a valid link.");
  }

  const platform = detectPlatform(parsed.hostname);
  if (!platform) {
    throw new AppError(
      400,
      'UNSUPPORTED_PLATFORM',
      'That site is not supported yet. Try a link from YouTube, TikTok, Instagram, Facebook, X/Twitter or another site listed on the home page.',
    );
  }

  parsed.protocol = 'https:';
  parsed.port = '';
  parsed.hash = '';
  return { url: parsed.toString(), platform };
}
