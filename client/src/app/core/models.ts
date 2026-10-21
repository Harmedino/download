export type Platform = 'tiktok' | 'instagram' | 'youtube' | 'facebook' | 'twitter' | 'pinterest' | 'reddit';
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
  extractor: 'yt-dlp' | 'gallery-dl';
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
  platform: Platform;
  sourceUrl: string;
  cached: boolean;
  metadata: MediaMetadata;
}

export interface JobFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url: string;
  expiresAt: string;
}

export type JobStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface JobView {
  id: string;
  type: 'fetch' | 'download' | 'remove-bg-image' | 'remove-bg-video';
  status: JobStatus;
  progress: number;
  stage: string | null;
  platform: Platform | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  files: JobFile[];
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
  platform: Platform | null;
  title: string;
  thumbnail: string | null;
  fileName: string;
  fileUrl: string;
  size: number;
  createdAt: string;
  expiresAt: string;
}
