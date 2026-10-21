import { HttpErrorResponse } from '@angular/common/http';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
    /** Seconds the server asked us to wait (429 / 503), when known. */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

interface FriendlyText {
  title: string;
  hint?: string;
}

/** Friendly copy for the error codes the API returns. Falls back to the server's message. */
const FRIENDLY: Record<string, FriendlyText> = {
  INVALID_URL: { title: "That link doesn't look right", hint: 'Copy the full link from the share button of the post and paste it again.' },
  UNSUPPORTED_PLATFORM: { title: 'This site is not supported', hint: 'Try a link from TikTok, Instagram, YouTube, Facebook, X/Twitter, Pinterest or Reddit.' },
  UNSUPPORTED_URL: { title: 'No media found at this link', hint: 'Make sure the link opens a single post or video, not a profile or feed.' },
  PRIVATE_POST: { title: 'This post is private', hint: 'Only public posts can be downloaded. We never ask for your social media login.' },
  MEDIA_UNAVAILABLE: { title: 'This post is unavailable', hint: 'It may have been deleted or restricted in your region.' },
  NO_MEDIA: { title: 'Nothing to download here', hint: "We couldn't find a video or image in this post." },
  FILE_TOO_LARGE: { title: 'File too large', hint: 'Try a lower quality, or a shorter clip.' },
  UPLOAD_TOO_LARGE: { title: 'File too large', hint: 'Uploads are limited to 50 MB.' },
  UNSUPPORTED_FILE: { title: 'Unsupported file type', hint: 'Images: JPG, PNG or WebP. Videos: MP4, WebM or MOV.' },
  INVALID_IMAGE: { title: "We couldn't open that image", hint: 'The file may be damaged. Try a JPG, PNG or WebP.' },
  INVALID_UPLOAD: { title: 'Upload failed', hint: 'Please try the upload again.' },
  INVALID_REQUEST: { title: 'Something is missing', hint: 'Check your choices and try again.' },
  FORMAT_UNAVAILABLE: { title: 'Quality not available', hint: 'Pick one of the listed qualities.' },
  AUDIO_UNAVAILABLE: { title: 'No audio track', hint: 'Audio-only download works for videos only.' },
  VIDEO_TOO_LONG: { title: 'Video too long', hint: 'Background removal works on clips up to 60 seconds.' },
  UPSTREAM_RATE_LIMITED: { title: 'The platform is busy', hint: 'They are limiting requests right now. Try again in a few minutes.' },
  RATE_LIMITED: { title: 'Slow down a little', hint: "You've made a lot of requests. Please wait a minute and try again." },
  UPSTREAM_UNREACHABLE: { title: "Couldn't reach the platform", hint: 'Please try again shortly.' },
  UPSTREAM_TIMEOUT: { title: 'That took too long', hint: 'The platform was slow to respond. Please try again.' },
  FILE_EXPIRED: { title: 'This file has expired', hint: 'Files are kept for 1 hour. Fetch the link again to re-download.' },
  JOB_NOT_FOUND: { title: 'This job has expired', hint: 'Please start again.' },
  JOB_FAILED: { title: 'Processing failed', hint: 'Something went wrong on our side. Please try again.' },
  BINARY_MISSING: { title: 'Server is missing a tool', hint: 'The server is not fully set up yet. Please contact the site owner.' },
  DB_UNAVAILABLE: { title: 'Service temporarily unavailable', hint: 'Please try again in a moment.' },
  NETWORK: { title: "Can't reach SnapGrab", hint: 'Check your internet connection, or the server may be down.' },
  OFFLINE: { title: "You're offline", hint: 'Reconnect to the internet and try again.' },
  SERVER_BUSY: { title: 'SnapGrab is busy right now', hint: 'Lots of people are processing files. Please try again in a few minutes.' },
  INVALID_VIDEO: { title: "We couldn't open that video", hint: 'The file may be damaged. Try an MP4, WebM or MOV.' },
  NOT_A_CAROUSEL: { title: 'Nothing to zip', hint: 'This post has a single item; use the normal download.' },
  INVALID_ITEM: { title: 'That item is no longer in the post', hint: 'Fetch the link again and retry.' },
  BODY_TOO_LARGE: { title: 'Request too large', hint: 'Please try again with a shorter link.' },
  INVALID_JSON: { title: 'Something went wrong', hint: 'Please refresh the page and try again.' },
};

/** Codes where the server's own message is more specific than our generic copy. */
const USE_SERVER_HINT = new Set(['RATE_LIMITED', 'SERVER_BUSY', 'VIDEO_TOO_LONG', 'FILE_TOO_LARGE']);

export function waitText(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  return `${Math.round(seconds / 60)} minutes`;
}

export function friendly(err: ApiError | null | undefined): FriendlyText | null {
  if (!err) return null;
  const base = FRIENDLY[err.code] ?? { title: 'Something went wrong', hint: err.message };
  // Client-side errors carry placeholder messages; only server messages (status > 0) are worth showing.
  let hint = USE_SERVER_HINT.has(err.code) && err.status > 0 && err.message ? err.message : base.hint;
  if (err.retryAfter && (err.code === 'RATE_LIMITED' || err.code === 'SERVER_BUSY')) {
    hint = `${hint ?? ''} You can try again in about ${waitText(err.retryAfter)}.`.trim();
  }
  return { title: base.title, hint };
}

function retryAfterOf(err: HttpErrorResponse): number | null {
  const fromBody = err.error?.error?.details?.retryAfterSeconds;
  if (typeof fromBody === 'number') return fromBody;
  const header = Number(err.headers?.get('Retry-After'));
  return Number.isFinite(header) && header > 0 ? header : null;
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      return new ApiError(offline ? 'OFFLINE' : 'NETWORK', "Can't reach the server.", 0);
    }
    const body = err.error?.error;
    const retry = retryAfterOf(err);
    if (body?.code) return new ApiError(body.code, body.message ?? err.message, err.status, retry);
    // Proxies (e.g. Render's edge) can reject uploads before they reach the API.
    if (err.status === 413) return new ApiError('UPLOAD_TOO_LARGE', 'File too large', 413);
    if (err.status === 429) return new ApiError('RATE_LIMITED', '', 429, retry);
    if (err.status === 502 || err.status === 503 || err.status === 504) return new ApiError('DB_UNAVAILABLE', '', err.status, retry);
    return new ApiError('HTTP_' + err.status, err.message, err.status);
  }
  return new ApiError('UNKNOWN', (err as Error)?.message ?? 'Unknown error');
}
