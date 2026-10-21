import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiService } from './api.service';
import { ApiError } from './errors';
import type { JobView } from './models';

const job = (status: JobView['status'], progress: number, error: JobView['error'] = null): JobView => ({
  id: 'j1', type: 'download', status, progress, stage: null, platform: 'youtube', error, createdAt: '', files: [],
});

describe('ApiService', () => {
  let api: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  it('maps API error bodies to ApiError', () => {
    let err: ApiError | undefined;
    api.fetchMedia('https://youtu.be/x').subscribe({ error: (e) => (err = e) });
    http.expectOne((r) => r.url.endsWith('/api/fetch')).flush({ error: { code: 'PRIVATE_POST', message: 'private' } }, { status: 403, statusText: 'Forbidden' });
    expect(err).toBeInstanceOf(ApiError);
    expect(err?.code).toBe('PRIVATE_POST');
  });

  it('pollJob emits until done, then completes', async () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    let completed = false;
    api.pollJob('j1', 100).subscribe({ next: (j) => seen.push(j.progress), complete: () => (completed = true) });
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne((r) => r.url.endsWith('/api/jobs/j1')).flush(job('processing', 40));
    await vi.advanceTimersByTimeAsync(100);
    http.expectOne((r) => r.url.endsWith('/api/jobs/j1')).flush(job('done', 100));
    expect(seen).toEqual([40, 100]);
    expect(completed).toBe(true);
    vi.useRealTimers();
  });

  it('pollJob backs off on 429 instead of failing the job', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    let error: unknown;
    api.pollJob('j1', 100).subscribe({ next: (j) => seen.push(j.status), error: (e) => (error = e) });
    await vi.advanceTimersByTimeAsync(0);
    http
      .expectOne((r) => r.url.endsWith('/api/jobs/j1'))
      .flush({ error: { code: 'RATE_LIMITED', message: 'slow', details: { retryAfterSeconds: 5 } } }, { status: 429, statusText: 'Too Many' });
    // While backing off, interval ticks must not fire extra requests.
    await vi.advanceTimersByTimeAsync(4000);
    http.expectNone((r) => r.url.endsWith('/api/jobs/j1'));
    await vi.advanceTimersByTimeAsync(1000);
    http.expectOne((r) => r.url.endsWith('/api/jobs/j1')).flush(job('done', 100));
    expect(seen).toEqual(['done']);
    expect(error).toBeUndefined();
    vi.useRealTimers();
  });

  it('pollJob gives up immediately when the job is gone (404)', async () => {
    vi.useFakeTimers();
    let err: ApiError | undefined;
    api.pollJob('j1', 100).subscribe({ error: (e) => (err = e) });
    await vi.advanceTimersByTimeAsync(0);
    http
      .expectOne((r) => r.url.endsWith('/api/jobs/j1'))
      .flush({ error: { code: 'JOB_NOT_FOUND', message: 'gone' } }, { status: 404, statusText: 'Not Found' });
    expect(err?.code).toBe('JOB_NOT_FOUND');
    vi.useRealTimers();
  });

  it('pollJob errors with the job error code on failure', async () => {
    vi.useFakeTimers();
    let err: ApiError | undefined;
    api.pollJob('j1', 100).subscribe({ error: (e) => (err = e) });
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne((r) => r.url.endsWith('/api/jobs/j1')).flush(job('failed', 50, { code: 'FILE_TOO_LARGE', message: 'big' }));
    expect(err?.code).toBe('FILE_TOO_LARGE');
    vi.useRealTimers();
  });
});
