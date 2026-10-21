import type { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../environments/environment';

const KEY = 'snapgrab.clientId.v1';
let cached: string | null = null;

function randomId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A random id that ties this browser to its jobs (history, retry, delete). It is not an account:
 * clearing site data starts a fresh, empty history. Never sent anywhere except our API.
 */
export function clientId(): string {
  if (cached) return cached;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && /^[A-Za-z0-9_-]{16,128}$/.test(saved)) return (cached = saved);
    cached = randomId();
    localStorage.setItem(KEY, cached);
  } catch {
    // Storage disabled: keep the id for this tab only.
    cached ??= randomId();
  }
  return cached;
}

export const clientIdInterceptor: HttpInterceptorFn = (req, next) => {
  const base = environment.apiBaseUrl.replace(/\/$/, '');
  if (!req.url.startsWith(`${base}/api/`)) return next(req);
  return next(req.clone({ setHeaders: { 'X-Client-Id': clientId() } }));
};
