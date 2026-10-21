import type { SourcePlatform } from './sources.js';

export type Extractor = 'yt-dlp' | 'gallery-dl' | 'direct';

/** A quality preset the client can request. The server maps it to a yt-dlp format selector. */
export interface FormatOption {
  id: QualityPreset;
  label: string;
  height: number | null;
  ext: string;
  /** Best-effort size estimate in bytes (null when the platform doesn't report it). */
  filesize: number | null;
}

export type QualityPreset = '360p' | '720p' | '1080p' | 'best';

export interface MediaItem {
  index: number;
  type: 'video' | 'image';
  title: string | null;
  thumbnail: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  ext: string | null;
}

export interface MediaMetadata {
  extractor: Extractor;
  kind: 'video' | 'image' | 'carousel';
  id: string | null;
  title: string;
  uploader: string | null;
  thumbnail: string | null;
  duration: number | null;
  filesize: number | null;
  formats: FormatOption[];
  hasAudio: boolean;
  /** Taller than wide; quality presets then refer to width (the short side). */
  portrait: boolean;
  items: MediaItem[];
}

export interface FetchResult {
  platform: SourcePlatform;
  sourceUrl: string;
  metadata: MediaMetadata;
}
