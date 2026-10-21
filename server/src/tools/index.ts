import type { MediaJobType } from '../models/Job.js';
import { compressTool } from './compress.js';
import { convertTool } from './convert.js';
import { editTool } from './edit.js';
import type { ToolDef } from './types.js';

/** Every media tool the API exposes at POST /api/tools/:type. Types without an entry return 404. */
export const TOOLS: Partial<Record<MediaJobType, ToolDef>> = {
  edit: editTool as unknown as ToolDef,
  convert: convertTool as unknown as ToolDef,
  compress: compressTool as unknown as ToolDef,
};
