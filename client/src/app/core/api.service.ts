import { HttpClient, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, exhaustMap, filter, map, of, retry, switchMap, takeWhile, tap, throwError, timer } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiError, toApiError } from './errors';
import type { DownloadRequest, FetchResponse, JobView, MediaFile, ServerConfig, ToolType } from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl.replace(/\/$/, '');

  fetchMedia(url: string): Observable<FetchResponse> {
    return this.http.post<FetchResponse>(`${this.base}/api/fetch`, { url }).pipe(catchError((e) => throwError(() => toApiError(e))));
  }

  startDownload(req: DownloadRequest): Observable<string> {
    return this.http.post<{ jobId: string }>(`${this.base}/api/download`, req).pipe(
      map((r) => r.jobId),
      catchError((e) => throwError(() => toApiError(e))),
    );
  }

  startZip(url: string): Observable<string> {
    return this.http.post<{ jobId: string }>(`${this.base}/api/download/zip`, { url }).pipe(
      map((r) => r.jobId),
      catchError((e) => throwError(() => toApiError(e))),
    );
  }

  /** Posts a multipart form to a job-creating endpoint and returns the job id, reporting upload progress (0-100). */
  startUploadJob(path: string, form: FormData, onProgress?: (pct: number) => void): Observable<string> {
    return this.http.post<{ jobId: string }>(`${this.base}${path}`, form, { reportProgress: true, observe: 'events' }).pipe(
      tap((e) => {
        if (e.type === HttpEventType.UploadProgress && e.total) onProgress?.(Math.round((e.loaded / e.total) * 100));
      }),
      filter((e) => e.type === HttpEventType.Response),
      map((e) => (e.type === HttpEventType.Response ? e.body!.jobId : '')),
      catchError((e) => throwError(() => toApiError(e))),
    );
  }

  startJsonJob(path: string, body: unknown): Observable<string> {
    return this.http.post<{ jobId: string }>(`${this.base}${path}`, body).pipe(
      map((r) => r.jobId),
      catchError((e) => throwError(() => toApiError(e))),
    );
  }

  /** Uploads a video, audio or image for the tools. Emits upload progress (0-100), then the stored file. */
  uploadMedia(file: File): Observable<{ progress: number; file?: MediaFile }> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<MediaFile>(`${this.base}/api/media/upload`, form, { reportProgress: true, observe: 'events' }).pipe(
      filter((e) => e.type === HttpEventType.UploadProgress || e.type === HttpEventType.Response),
      map((e) =>
        e.type === HttpEventType.Response ? { progress: 100, file: e.body! } : { progress: e.total ? Math.round((e.loaded / e.total) * 100) : 0 },
      ),
      catchError((e) => throwError(() => toApiError(e))),
    );
  }

  /** A stored file with its media details (duration, size, codecs). */
  getMedia(id: string): Observable<MediaFile> {
    return this.http.get<MediaFile>(`${this.base}/api/media/${encodeURIComponent(id)}`).pipe(catchError((e) => throwError(() => toApiError(e))));
  }

  deleteMedia(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/api/media/${encodeURIComponent(id)}`).pipe(catchError((e) => throwError(() => toApiError(e))));
  }

  /** Starts a media tool job, e.g. startTool('convert', { fileId, format: 'webm' }). */
  startTool(type: ToolType, body: unknown): Observable<string> {
    return this.startJsonJob(`/api/tools/${type}`, body);
  }

  config(): Observable<ServerConfig> {
    return this.http.get<ServerConfig>(`${this.base}/api/config`).pipe(catchError((e) => throwError(() => toApiError(e))));
  }

  history(): Observable<JobView[]> {
    return this.http.get<{ jobs: JobView[] }>(`${this.base}/api/history`).pipe(
      map((r) => r.jobs),
      catchError((e) => throwError(() => toApiError(e))),
    );
  }

  clearHistory(): Observable<number> {
    return this.http.delete<{ deleted: number }>(`${this.base}/api/history`).pipe(
      map((r) => r.deleted),
      catchError((e) => throwError(() => toApiError(e))),
    );
  }

  retryJob(id: string): Observable<string> {
    return this.startJsonJob(`/api/jobs/${encodeURIComponent(id)}/retry`, {});
  }

  deleteJob(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/api/jobs/${encodeURIComponent(id)}`).pipe(catchError((e) => throwError(() => toApiError(e))));
  }

  getJob(id: string): Observable<JobView> {
    return this.http.get<JobView>(`${this.base}/api/jobs/${encodeURIComponent(id)}`);
  }

  /**
   * Polls /api/jobs/:id until the job finishes. Emits every update, completes on "done",
   * and errors with an ApiError on "failed". Brief network blips are retried.
   */
  pollJob(id: string, intervalMs = 1000): Observable<JobView> {
    return timer(0, intervalMs).pipe(
      // exhaustMap: ignore ticks while a request (or its backoff) is still in flight.
      exhaustMap(() =>
        this.getJob(id).pipe(
          // Ride out brief blips and rate limits instead of failing a long job; 404 is final.
          retry({
            count: 5,
            delay: (err: unknown) => {
              const e = toApiError(err);
              if (e.status === 404) return throwError(() => e);
              return timer(e.status === 429 ? Math.min(30, e.retryAfter ?? 10) * 1000 : 1500);
            },
          }),
        ),
      ),
      takeWhile((j) => j.status !== 'done' && j.status !== 'failed', true),
      switchMap((j) =>
        j.status === 'failed'
          ? throwError(() => new ApiError(j.error?.code ?? 'JOB_FAILED', j.error?.message ?? 'Processing failed'))
          : of(j),
      ),
      catchError((e) => throwError(() => toApiError(e))),
    );
  }

  fileUrl(pathOrId: string, inline = false): string {
    const path = pathOrId.startsWith('/') ? pathOrId : `/api/files/${pathOrId}`;
    return `${this.base}${path}${inline ? '?inline=1' : ''}`;
  }
}
