import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ApiError, friendly, toApiError, waitText } from './errors';

describe('error helpers', () => {
  it('reads Retry-After from the body or the header', () => {
    const fromBody = toApiError(
      new HttpErrorResponse({ status: 429, error: { error: { code: 'RATE_LIMITED', message: 'Video is limited to 4 per hour.', details: { retryAfterSeconds: 3600 } } } }),
    );
    expect(fromBody.retryAfter).toBe(3600);
    const fromHeader = toApiError(new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '30' }) }));
    expect(fromHeader.code).toBe('RATE_LIMITED');
    expect(fromHeader.retryAfter).toBe(30);
  });

  it('shows the specific server message plus the wait for rate limits', () => {
    const t = friendly(new ApiError('RATE_LIMITED', 'Video is limited to 4 per hour.', 429, 3600));
    expect(t?.title).toBe('Slow down a little');
    expect(t?.hint).toBe('Video is limited to 4 per hour. You can try again in about 60 minutes.');
  });

  it('uses generic copy for client-side errors with placeholder messages', () => {
    expect(friendly(new ApiError('VIDEO_TOO_LONG', 'Too long'))?.hint).toContain('60 seconds');
  });

  it('treats gateway errors as temporarily unavailable', () => {
    expect(toApiError(new HttpErrorResponse({ status: 502 })).code).toBe('DB_UNAVAILABLE');
  });

  it('formats waits', () => {
    expect(waitText(30)).toBe('30 seconds');
    expect(waitText(600)).toBe('10 minutes');
  });
});
