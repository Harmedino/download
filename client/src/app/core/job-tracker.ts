import { computed, signal } from '@angular/core';
import { Observable, Subscription, switchMap, tap } from 'rxjs';
import type { ApiService } from './api.service';
import { ApiError, toApiError } from './errors';
import type { JobView } from './models';

export type TrackerState = 'idle' | 'starting' | 'running' | 'done' | 'failed';

/**
 * Signal-based state for one long-running server job: start it, poll /api/jobs/:id,
 * expose progress, and surface the result or a friendly error.
 */
export class JobTracker {
  readonly state = signal<TrackerState>('idle');
  readonly progress = signal(0);
  readonly stage = signal<string | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly job = signal<JobView | null>(null);
  readonly busy = computed(() => this.state() === 'starting' || this.state() === 'running');
  private sub: Subscription | null = null;

  constructor(private readonly api: ApiService) {}

  run(start$: Observable<string>, onDone?: (job: JobView) => void): void {
    this.cancel();
    this.state.set('starting');
    this.progress.set(0);
    this.stage.set(null);
    this.error.set(null);
    this.job.set(null);
    this.sub = start$
      .pipe(
        tap(() => this.state.set('running')),
        switchMap((id) => this.api.pollJob(id)),
      )
      .subscribe({
        next: (j) => {
          this.job.set(j);
          this.progress.set(j.progress);
          this.stage.set(j.stage);
          if (j.status === 'done') {
            this.state.set('done');
            onDone?.(j);
          }
        },
        error: (e) => {
          this.error.set(toApiError(e));
          this.state.set('failed');
        },
      });
  }

  cancel(): void {
    this.sub?.unsubscribe();
    this.sub = null;
  }

  reset(): void {
    this.cancel();
    this.state.set('idle');
    this.progress.set(0);
    this.error.set(null);
    this.job.set(null);
  }
}

/** Triggers a browser download. The API sends Content-Disposition: attachment, so the page stays put. */
export function triggerDownload(href: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
