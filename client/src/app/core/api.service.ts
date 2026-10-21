import { HttpClient, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, filter, map, of, retry, switchMap, takeWhile, tap, throwError, timer } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiError, toApiError } from './errors';
import type { DownloadRequest, FetchResponse, JobView } from './models';

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

  getJob(id: string): Observable<JobView> {
    return this.http.get<JobView>(`${this.base}/api/jobs/${encodeURIComponent(id)}`);
  }

  /**
   * Polls /api/jobs/:id until the job finishes. Emits every update, completes on "done",
   * and errors with an ApiError on "failed". Brief network blips are retried.
   */
  pollJob(id: string, intervalMs = 1000): Observable<JobView> {
    return timer(0, intervalMs).pipe(
      switchMap(() => this.getJob(id).pipe(retry({ count: 3, delay: 1500 }))),
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
