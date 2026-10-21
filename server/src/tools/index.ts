import type { MediaJobType } from '../models/Job.js';
import { compressTool } from './compress.js';
import { convertTool } from './convert.js';
import { creatorPackTool } from './creatorPack.js';
import { editTool } from './edit.js';
import { framesTool } from './frames.js';
import { gifTool } from './gif.js';
import { shortsTool } from './shorts.js';
import { burnSubtitlesTool, subtitlesTool } from './subtitles.js';
import { thumbnailTool } from './thumbnail.js';
import type { ToolDef } from './types.js';

/** Every media tool the API exposes at POST /api/tools/:type. Types without an entry return 404. */
export const TOOLS: Partial<Record<MediaJobType, ToolDef>> = {
  edit: editTool as unknown as ToolDef,
  convert: convertTool as unknown as ToolDef,
  compress: compressTool as unknown as ToolDef,
  gif: gifTool as unknown as ToolDef,
  frames: framesTool as unknown as ToolDef,
  thumbnail: thumbnailTool as unknown as ToolDef,
  shorts: shortsTool as unknown as ToolDef,
  subtitles: subtitlesTool as unknown as ToolDef,
  'burn-subtitles': burnSubtitlesTool as unknown as ToolDef,
  'creator-pack': creatorPackTool as unknown as ToolDef,
};
