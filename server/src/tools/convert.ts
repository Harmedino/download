import path from 'node:path';
import { z } from 'zod';
import { AppError } from '../middleware/errors.js';
import { AUDIO_CONTAINERS, VIDEO_CONTAINERS, audioEncodeArgs, ffmpeg, inputArgs, videoEncodeArgs, type AudioContainer, type VideoContainer } from '../services/ffmpeg.js';
import { fileId, resolution, scaleToShortSide } from './common.js';
import { baseName, defineTool, resolutionOf } from './types.js';

const FORMATS = [...VIDEO_CONTAINERS, ...AUDIO_CONTAINERS] as const;

const schema = z.object({
  fileId,
  format: z.enum(FORMATS as unknown as [string, ...string[]]),
  /** Target short side ("720p"); never upscales. */
  resolution: resolution.optional(),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]).optional(),
});

/** Codecs each container can hold as-is, for a fast stream copy when nothing else changes. */
const COPYABLE: Record<VideoContainer, { video: RegExp; audio: RegExp }> = {
  mp4: { video: /^(h264|hevc|av1)$/, audio: /^(aac|mp3|alac)$/ },
  mov: { video: /^(h264|hevc|prores)$/, audio: /^(aac|mp3|alac|pcm_s16le)$/ },
  mkv: { video: /.*/, audio: /.*/ },
  webm: { video: /^(vp8|vp9|av1)$/, audio: /^(opus|vorbis)$/ },
};

export const convertTool = defineTool({
  schema,
  accepts: ['video', 'audio'],
  fileIds: (p) => [p.fileId],
  validate(p, [input]) {
    if ((VIDEO_CONTAINERS as string[]).includes(p.format) && input!.info.kind !== 'video') {
      throw new AppError(400, 'INVALID_REQUEST', 'This file has no video, so it can only be converted to MP3, M4A or WAV.');
    }
  },
  summary(p, [input]) {
    const i = input!.info;
    const out = i.width && i.height && !(AUDIO_CONTAINERS as string[]).includes(p.format) ? scaleToShortSide(i.width, i.height, p.resolution) : null;
    return { format: p.format.toUpperCase(), resolution: out ? resolutionOf(out.width, out.height) : 'Audio' };
  },
  async run({ inputs: [input], params: p, outDir, report }) {
    const i = input!.info;
    const out = path.join(outDir, `output.${p.format}`);
    const name = `${baseName(input!.name)}.${p.format}`;
    report(0, 'Converting');
    const onProgress = (pct: number) => report(pct, 'Converting');

    if ((AUDIO_CONTAINERS as string[]).includes(p.format)) {
      if (!i.hasAudio) throw new AppError(400, 'AUDIO_UNAVAILABLE', 'This video has no audio track.');
      await ffmpeg([...inputArgs(input!.path), '-map', '0:a:0', ...audioEncodeArgs(p.format as AudioContainer), out], { duration: i.duration, onProgress });
      return { files: [{ path: out, name }] };
    }

    const container = p.format as VideoContainer;
    const size = scaleToShortSide(i.width!, i.height!, p.resolution);
    const resized = size.width !== i.width || size.height !== i.height;
    const copy = COPYABLE[container];
    const canCopy = !resized && !p.fps && copy.video.test(i.videoCodec ?? '') && (!i.hasAudio || copy.audio.test(i.audioCodec ?? ''));
    const map = ['-map', '0:v:0', ...(i.hasAudio ? ['-map', '0:a:0'] : [])];
    const args = canCopy
      ? [...inputArgs(input!.path), ...map, '-c', 'copy', ...(container === 'mp4' || container === 'mov' ? ['-movflags', '+faststart'] : []), out]
      : [
          ...inputArgs(input!.path),
          ...map,
          '-vf', [`scale=${size.width}:${size.height}:flags=lanczos`, 'setsar=1', ...(p.fps ? [`fps=${p.fps}`] : [])].join(','),
          ...videoEncodeArgs(container, { hasAudio: i.hasAudio }),
          out,
        ];
    await ffmpeg(args, { duration: i.duration, onProgress });
    return { files: [{ path: out, name }] };
  },
});
