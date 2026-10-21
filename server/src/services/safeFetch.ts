import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { AppError } from '../middleware/errors.js';

/**
 * Fetching user-supplied URLs (direct media links) without letting them reach our own network.
 * Every hop, redirects included, must resolve only to public unicast addresses, and the socket
 * connects to the exact address we checked, so DNS rebinding can't swap in a private one.
 */

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embeds an IPv4 address)
] as const) {
  blocked.addSubnet(addr, prefix, 'ipv6');
}
const globalV6 = new net.BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return !blocked.check(ip, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return isPublicAddress(mapped[1]!);
    return globalV6.check(ip, 'ipv6') && !blocked.check(ip, 'ipv6');
  }
  return false;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'HEAD';
  /** Tests point this at a local server; production always uses isPublicAddress. */
  isAllowedAddress?: (ip: string) => boolean;
  /** Ports links may use. Defaults to the standard web ports only. */
  allowedPorts?: string[];
}

const blockedErr = () =>
  new AppError(400, 'URL_NOT_ALLOWED', "That link points to a private or local network address, which SnapGrab won't fetch.");

/** Checks scheme, credentials and port. Returns the parsed URL. */
export function checkPublicUrl(input: string, allowedPorts = ['80', '443']): URL {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new AppError(400, 'INVALID_URL', "That doesn't look like a valid link.");
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new AppError(400, 'INVALID_URL', 'Only http and https links are supported.');
  if (u.username || u.password) throw new AppError(400, 'INVALID_URL', "Links with a username or password aren't supported.");
  if (u.port && !allowedPorts.includes(u.port)) throw blockedErr();
  return u;
}

function lookupFor(isAllowed: (ip: string) => boolean): net.LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err, '', 4);
      const list = addresses as dns.LookupAddress[];
      // Refuse the host if any of its addresses is private: we can't control which one a retry would use.
      if (!list.length || list.some((a) => !isAllowed(a.address))) return callback(blockedErr() as unknown as NodeJS.ErrnoException, '', 4);
      const pick = list[0]!;
      if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, [pick]);
      callback(null, pick.address, pick.family);
    });
  };
}

export interface SafeResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  url: string;
  body: http.IncomingMessage;
}

/** One request with manual, re-validated redirects. The caller must consume or destroy `body`. */
export async function safeRequest(input: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const isAllowed = opts.isAllowedAddress ?? isPublicAddress;
  const maxRedirects = opts.maxRedirects ?? 5;
  let url = checkPublicUrl(input, opts.allowedPorts);
  for (let hop = 0; ; hop++) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    // Node skips `lookup` for IP literals, so check those directly.
    if (net.isIP(host) && !isAllowed(host)) throw blockedErr();
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(
        url,
        {
          method: opts.method ?? 'GET',
          lookup: lookupFor(isAllowed),
          timeout: opts.timeoutMs ?? 20_000,
          headers: { 'user-agent': 'SnapGrab/1.0 (+media import)', accept: '*/*', ...opts.headers },
        },
        resolve,
      );
      req.on('timeout', () => req.destroy(new AppError(504, 'UPSTREAM_TIMEOUT', 'The site took too long to respond.')));
      req.on('error', reject);
      req.end();
    }).catch((err: unknown) => {
      if (err instanceof AppError) throw err;
      throw new AppError(502, 'UPSTREAM_UNREACHABLE', "We couldn't reach that site. Check the link and try again.");
    });

    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if (hop >= maxRedirects) throw new AppError(502, 'TOO_MANY_REDIRECTS', 'That link redirects too many times.');
      url = checkPublicUrl(new URL(res.headers.location, url).toString(), opts.allowedPorts);
      continue;
    }
    return { status, headers: res.headers, url: url.toString(), body: res };
  }
}

export interface RemoteFileInfo {
  url: string;
  contentType: string;
  size: number | null;
  fileName: string;
}

function fileNameFrom(url: string, disposition: string | undefined): string {
  const m = disposition && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  if (m?.[1]) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(last) || 'media';
  } catch {
    return last || 'media';
  }
}

/** Looks at a remote file's headers without downloading it (falls back to a 1-byte range GET). */
export async function inspectRemoteFile(url: string, opts: SafeFetchOptions = {}): Promise<RemoteFileInfo> {
  let res = await safeRequest(url, { ...opts, method: 'HEAD' });
  res.body.resume();
  if (res.status === 405 || res.status === 403 || res.status === 501 || !res.headers['content-type']) {
    res = await safeRequest(url, { ...opts, method: 'GET', headers: { range: 'bytes=0-0' } });
    res.body.destroy();
  }
  if (res.status === 401 || res.status === 403) {
    throw new AppError(403, 'PRIVATE_POST', 'That file needs a login or permission to download, so SnapGrab can’t fetch it.');
  }
  if (res.status === 404 || res.status === 410) throw new AppError(404, 'MEDIA_UNAVAILABLE', 'That file was not found. It may have been moved or deleted.');
  if (res.status >= 400) throw new AppError(502, 'UPSTREAM_UNREACHABLE', `The site answered with an error (${res.status}).`);
  const contentType = String(res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  const range = /\/(\d+)$/.exec(String(res.headers['content-range'] ?? ''));
  const length = range ? Number(range[1]) : res.status === 200 ? Number(res.headers['content-length']) : NaN;
  return {
    url: res.url,
    contentType,
    size: Number.isFinite(length) && length > 0 ? length : null,
    fileName: fileNameFrom(res.url, res.headers['content-disposition'] as string | undefined),
  };
}

/** Streams a remote file to disk, aborting once it passes `maxBytes`. */
export async function downloadToFile(
  url: string,
  dest: string,
  o: SafeFetchOptions & { maxBytes: number; onProgress?: (pct: number) => void },
): Promise<{ contentType: string; bytes: number }> {
  const res = await safeRequest(url, { ...o, method: 'GET', timeoutMs: o.timeoutMs ?? 60_000 });
  if (res.status !== 200) {
    res.body.resume();
    if (res.status === 401 || res.status === 403) throw new AppError(403, 'PRIVATE_POST', 'That file needs a login or permission to download.');
    throw new AppError(502, 'UPSTREAM_UNREACHABLE', `The site answered with an error (${res.status}).`);
  }
  const declared = Number(res.headers['content-length']);
  const tooBig = () => new AppError(413, 'FILE_TOO_LARGE', `That file is larger than the ${Math.round(o.maxBytes / 1024 / 1024)} MB limit.`);
  if (Number.isFinite(declared) && declared > o.maxBytes) {
    res.body.destroy();
    throw tooBig();
  }
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > o.maxBytes) return cb(tooBig());
      if (declared > 0) o.onProgress?.((bytes / declared) * 100);
      cb(null, chunk);
    },
  });
  await pipeline(res.body, counter, fs.createWriteStream(dest)).catch((err: unknown) => {
    if (err instanceof AppError) throw err;
    throw new AppError(502, 'UPSTREAM_UNREACHABLE', 'The download was interrupted. Please try again.');
  });
  return { contentType: String(res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase(), bytes };
}
