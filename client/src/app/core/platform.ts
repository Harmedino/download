import type { Platform } from './models';

const RULES: Array<[Platform, RegExp]> = [
  ['tiktok', /(^|\.)tiktok\.com$/],
  ['instagram', /(^|\.)(instagram\.com|instagr\.am)$/],
  ['youtube', /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/],
  ['facebook', /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/],
  ['twitter', /(^|\.)(twitter\.com|x\.com)$/],
  ['pinterest', /(^|\.)(pinterest\.[a-z.]{2,6}|pin\.it)$/],
  ['reddit', /(^|\.)(reddit\.com|redd\.it)$/],
];

export const PLATFORM_NAMES: Record<Platform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
  facebook: 'Facebook',
  twitter: 'X / Twitter',
  pinterest: 'Pinterest',
  reddit: 'Reddit',
};

/** Client-side mirror of the server allowlist, used only for the live platform icon. */
export function detectPlatform(input: string): Platform | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    return RULES.find(([, re]) => re.test(host))?.[0] ?? null;
  } catch {
    return null;
  }
}

export function looksLikeUrl(input: string): boolean {
  return /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(input.trim());
}
