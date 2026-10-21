import type { ToolType } from './models';

export interface ToolLink {
  path: string;
  label: string;
  description: string;
  /** Server tool this page needs; null for pages that work without one. */
  tool: ToolType | null;
  /** 24x24 stroke icon path. */
  icon: string;
}

/** The tools menu and the tools page. Only pages that exist are listed here. */
export const TOOL_LINKS: ToolLink[] = [
  { path: '/', label: 'Link Downloader', description: 'Paste a link to preview and download public videos, audio and images.', tool: null, icon: 'M12 4v11M7 10l5 5 5-5M5 20h14' },
  { path: '/editor', label: 'Video Editor', description: 'Trim, cut, merge, crop, resize, rotate, change speed, add text and adjust colour.', tool: 'edit', icon: 'M6 3v12a3 3 0 1 0 3 3V7l12-4v12a3 3 0 1 1-3-3' },
  { path: '/convert', label: 'Video Converter', description: 'Change format (MP4, WebM, MOV, MKV, MP3, M4A, WAV), resolution and frame rate.', tool: 'convert', icon: 'M4 7h13l-3-3M20 17H7l3 3' },
  { path: '/compress', label: 'Video Compressor', description: 'Shrink a video by quality level or to a target file size.', tool: 'compress', icon: 'M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5' },
  { path: '/remove-bg', label: 'Remove BG', description: 'Remove the background from an image.', tool: null, icon: 'M4 16l4-4 3 3 5-6 4 5M4 4h16v16H4z' },
];
