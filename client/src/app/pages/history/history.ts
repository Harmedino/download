import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { exhaustMap, timer } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ConfigService } from '../../core/config.service';
import { ApiError } from '../../core/errors';
import { formatBytes, timeAgo } from '../../core/format';
import type { JobView } from '../../core/models';
import { PLATFORM_NAMES } from '../../core/platform';
import { ErrorBanner } from '../../shared/error-banner';
import { ProgressBar } from '../../shared/progress-bar';
import { Spinner } from '../../shared/spinner';
import { ToolHeader } from '../../shared/tool-page';

const TYPE_LABELS: Record<JobView['type'], string> = {
  fetch: 'Link check',
  download: 'Download',
  'remove-bg-image': 'Remove BG',
  edit: 'Video edit',
  convert: 'Convert',
  compress: 'Compress',
  gif: 'GIF',
  frames: 'Frames',
  thumbnail: 'Thumbnail',
  shorts: 'Short',
  subtitles: 'Subtitles',
  'burn-subtitles': 'Burned subtitles',
  'creator-pack': 'Creator Pack',
};

@Component({
  selector: 'app-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorBanner, ProgressBar, RouterLink, Spinner, ToolHeader],
  template: `
    <section class="mx-auto max-w-4xl px-4 pt-8 sm:pt-12">
      <app-tool-header title="History" subtitle="Downloads and exports from this browser. They are private to you and are not listed anywhere else." />
      <div class="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
        <p>Files are deleted automatically {{ config.retentionText() }} after they are created. Job records are removed after 24 hours.</p>
        @if (jobs().length) {
          <button type="button" (click)="clearAll()" [disabled]="clearing()" class="font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400">Delete all</button>
        }
      </div>
      <div class="mt-4"><app-error-banner [error]="error()" [retryable]="true" (retry)="refresh()" /></div>

      @if (loading() && !jobs().length) {
        <div class="mt-6 flex justify-center text-zinc-400"><app-spinner /></div>
      } @else if (!jobs().length) {
        <div class="mt-10 text-center text-zinc-500 dark:text-zinc-400">
          <p>Nothing here yet.</p>
          <p class="mt-1 text-sm"><a routerLink="/" class="text-violet-600 underline dark:text-violet-300">Download something</a> or <a routerLink="/tools" class="text-violet-600 underline dark:text-violet-300">open a tool</a>.</p>
        </div>
      } @else {
        <ul class="mt-4 space-y-3">
          @for (j of jobs(); track j.id) {
            <li class="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div class="flex flex-wrap items-start gap-3">
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium" [title]="j.files[0]?.name ?? j.title ?? ''">{{ j.files[0]?.name ?? j.title ?? 'Untitled' }}</p>
                  <dl class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <div><dt class="sr-only">Tool</dt><dd>{{ typeLabel(j) }}</dd></div>
                    <div><dt class="inline">Source: </dt><dd class="inline">{{ sourceLabel(j) }}</dd></div>
                    @if (j.summary?.format) {
                      <div><dt class="inline">Format: </dt><dd class="inline">{{ j.summary!.format }}</dd></div>
                    }
                    @if (j.summary?.resolution) {
                      <div><dt class="inline">Resolution: </dt><dd class="inline">{{ j.summary!.resolution }}</dd></div>
                    }
                    @if (totalSize(j)) {
                      <div><dt class="inline">Size: </dt><dd class="inline">{{ formatBytes(totalSize(j)) }}</dd></div>
                    }
                    <div><dt class="sr-only">Date</dt><dd><time [attr.datetime]="j.createdAt" [title]="date(j.createdAt)">{{ timeAgo(j.createdAt) }}</time></dd></div>
                  </dl>
                </div>
                <span class="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium" [class]="statusClass(j)">{{ statusLabel(j) }}</span>
              </div>

              @if (j.status === 'queued' || j.status === 'processing') {
                <div class="mt-3"><app-progress-bar [value]="j.progress" [label]="j.stage ?? (j.status === 'queued' ? 'Waiting in queue' : 'Processing')" /></div>
              }
              @if (j.status === 'failed' && j.error) {
                <p class="mt-2 text-sm text-red-600 dark:text-red-400">{{ j.error.message }}</p>
              }

              <div class="mt-3 flex flex-wrap items-center gap-2">
                @for (f of j.files; track f.id) {
                  <a [href]="api.fileUrl(f.url)" class="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900" [title]="f.name">
                    <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
                    {{ j.files.length > 1 ? ext(f.name) : 'Download' }}
                  </a>
                }
                @if (j.status === 'done' && !j.files.length) {
                  <span class="text-sm text-zinc-500 dark:text-zinc-400">Files expired</span>
                }
                @if (j.retryable) {
                  <button type="button" (click)="retry(j)" [disabled]="busyId() === j.id" class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:border-violet-500 disabled:opacity-50 dark:border-zinc-700">Retry</button>
                }
                @if (j.status !== 'processing') {
                  <button type="button" (click)="remove(j)" [disabled]="busyId() === j.id" class="ml-auto rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-500 hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50 dark:text-zinc-400">
                    Delete
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class History {
  protected readonly api = inject(ApiService);
  protected readonly config = inject(ConfigService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly jobs = signal<JobView[]>([]);
  protected readonly loading = signal(true);
  protected readonly clearing = signal(false);
  protected readonly busyId = signal<string | null>(null);
  protected readonly error = signal<ApiError | null>(null);
  private readonly active = computed(() => this.jobs().some((j) => j.status === 'queued' || j.status === 'processing'));
  protected readonly formatBytes = formatBytes;
  protected readonly timeAgo = timeAgo;

  constructor() {
    this.refresh();
    // Refresh while something is running so progress moves; slow down otherwise.
    timer(3000, 3000)
      .pipe(
        exhaustMap(() => (this.active() ? this.api.history() : [])),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({ next: (jobs) => this.jobs.set(jobs) });
  }

  refresh(): void {
    this.loading.set(true);
    this.api
      .history()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (jobs) => {
          this.jobs.set(jobs);
          this.error.set(null);
          this.loading.set(false);
        },
        error: (e: ApiError) => {
          this.error.set(e);
          this.loading.set(false);
        },
      });
  }

  protected typeLabel(j: JobView): string {
    return TYPE_LABELS[j.type] ?? j.type;
  }

  protected sourceLabel(j: JobView): string {
    if (j.sourceType === 'upload') return 'Upload';
    if (j.sourceType === 'direct' || j.platform === 'direct') return 'Direct link';
    if (j.platform) return PLATFORM_NAMES[j.platform as keyof typeof PLATFORM_NAMES] ?? 'Link';
    return 'Upload';
  }

  protected statusLabel(j: JobView): string {
    return { queued: 'Queued', processing: `Processing ${j.progress}%`, done: 'Done', failed: 'Failed' }[j.status];
  }

  protected statusClass(j: JobView): string {
    return {
      queued: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
      processing: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
      done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      failed: 'bg-red-500/15 text-red-700 dark:text-red-300',
    }[j.status];
  }

  protected totalSize(j: JobView): number {
    return j.files.reduce((n, f) => n + f.size, 0);
  }

  protected ext(name: string): string {
    return name.split('.').pop()?.toUpperCase() ?? 'File';
  }

  protected date(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  protected retry(j: JobView): void {
    this.busyId.set(j.id);
    this.api.retryJob(j.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.jobs.update((list) => list.map((x) => (x.id === j.id ? { ...x, status: 'queued', progress: 0, error: null, retryable: false } : x)));
      },
      error: (e: ApiError) => {
        this.busyId.set(null);
        this.error.set(e);
      },
    });
  }

  protected remove(j: JobView): void {
    this.busyId.set(j.id);
    this.api.deleteJob(j.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.jobs.update((list) => list.filter((x) => x.id !== j.id));
      },
      error: (e: ApiError) => {
        this.busyId.set(null);
        this.error.set(e);
      },
    });
  }

  protected clearAll(): void {
    if (!confirm('Delete all finished jobs and their files from the server?')) return;
    this.clearing.set(true);
    this.api.clearHistory().subscribe({
      next: () => {
        this.clearing.set(false);
        this.refresh();
      },
      error: (e: ApiError) => {
        this.clearing.set(false);
        this.error.set(e);
      },
    });
  }
}
