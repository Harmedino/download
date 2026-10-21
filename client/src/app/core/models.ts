export type Platform =
  | 'tiktok'
  | 'instagram'
  | 'youtube'
  | 'facebook'
  | 'twitter'
  | 'pinterest'
  | 'reddit'
  | 'vimeo'
  | 'dailymotion'
  | 'twitch'
  | 'soundcloud'
  | 'linkedin'
  | 'tumblr'
  | 'snapchat'
  | 'bluesky'
  | 'streamable'
  | 'imgur';
export type QualityPreset = '360p' | '720p' | '1080p' | 'best';

export interface FormatOption {
  id: QualityPreset;
  label: string;
  height: number | null;
  ext: string;
  filesize: number | null;
}

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
  extractor: 'yt-dlp' | 'gallery-dl' | 'direct';
  kind: 'video' | 'image' | 'carousel';
  id: string | null;
  title: string;
  uploader: string | null;
  thumbnail: string | null;
  duration: number | null;
  filesize: number | null;
  formats: FormatOption[];
  hasAudio: boolean;
  portrait: boolean;
  items: MediaItem[];
}

export interface FetchResponse {
  platform: Platform | 'direct';
  sourceUrl: string;
  cached: boolean;
  metadata: MediaMetadata;
}

export interface MediaInfo {
  kind: 'video' | 'audio' | 'image';
  format: string;
  duration: number | null;
  size: number | null;
  bitRate: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
}

export interface JobFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url: string;
  expiresAt: string;
  /** ffprobe details, for files uploaded or probed through /api/media. */
  info?: MediaInfo | null;
}

/** A file ready to be used as tool input (an upload, or an imported link). */
export type MediaFile = JobFile;

export type ToolType = 'edit' | 'convert' | 'compress' | 'gif' | 'frames' | 'thumbnail' | 'shorts' | 'subtitles' | 'burn-subtitles' | 'creator-pack';

export interface ServerConfig {
  fileTtlMinutes: number;
  maxUploadMb: number;
  maxMediaUploadMb: number;
  maxMediaMinutes: number;
  maxDownloadMb: number;
  jobTimeoutMinutes: number;
  directUrls: boolean;
  tools: ToolType[];
}

export type JobStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface JobView {
  id: string;
  type: 'fetch' | 'download' | 'remove-bg-image' | ToolType;
  status: JobStatus;
  progress: number;
  stage: string | null;
  platform: Platform | 'direct' | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  files: JobFile[];
  updatedAt?: string;
  title?: string | null;
  sourceType?: 'upload' | 'link' | 'direct' | null;
  sourceUrl?: string | null;
  summary?: { format?: string | null; resolution?: string | null } | null;
  result?: unknown;
  warnings?: string[];
  retryable?: boolean;
}

export interface DownloadRequest {
  url: string;
  formatId?: QualityPreset;
  itemIndex?: number;
  audioOnly?: boolean;
}

export interface HistoryEntry {
  id: string;
  sourceUrl: string;
  platform: Platform | 'direct' | null;
  title: string;
  thumbnail: string | null;
  fileName: string;
  fileUrl: string;
  size: number;
  createdAt: string;
  expiresAt: string;
}
