import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ConfigService } from '../core/config.service';
import { formatBytes } from '../core/format';
import type { JobTracker } from '../core/job-tracker';
import type { JobFile } from '../core/models';
import { ErrorBanner } from './error-banner';
import { ProgressBar } from './progress-bar';

/** Progress, errors (with retry) and the finished files of one tool job. */
@Component({
  selector: 'app-job-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorBanner, ProgressBar, RouterLink],
  template: `
    @let t = tracker();
    @if (t.busy()) {
      <app-progress-bar [value]="t.progress()" [label]="t.state() === 'starting' ? 'Starting' : (t.stage() ?? 'Waiting in queue')" />
      <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">You can leave this page; the job keeps running and shows up in <a routerLink="/history" class="underline">History</a>.</p>
    }
    <app-error-banner [error]="t.error()" [retryable]="true" (retry)="retry.emit()" />
    @if (t.state() === 'done' && t.job(); as job) {
      <div class="space-y-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4" role="status">
        <p class="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{{ doneText() }}</p>
        @if (previewFile(); as v) {
          <video [src]="api.fileUrl(v.url, true)" controls playsinline preload="metadata" class="max-h-[60vh] w-full rounded-xl bg-black"></video>
        }
        <ul class="space-y-2">
          @for (f of job.files; track f.id) {
            <li class="flex items-center gap-3 rounded-xl bg-white p-2 dark:bg-zinc-900">
              @if (f.mimeType.startsWith('image/')) {
                <img [src]="api.fileUrl(f.url, true)" alt="" class="h-12 w-12 shrink-0 rounded-lg object-cover" loading="lazy" />
              }
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium" [title]="f.name">{{ f.name }}</p>
                <p class="text-xs text-zinc-500 dark:text-zinc-400">{{ formatBytes(f.size) }}</p>
              </div>
              <a [href]="api.fileUrl(f.url)" class="shrink-0 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900">
                Download
              </a>
            </li>
          }
        </ul>
        @for (w of job.warnings ?? []; track w) {
          <p class="text-xs text-amber-700 dark:text-amber-300">{{ w }}</p>
        }
        <p class="text-xs text-zinc-500 dark:text-zinc-400">Files are deleted from our server after {{ config.retentionText() }}.</p>
      </div>
    }
  `,
})
export class JobPanel {
  protected readonly api = inject(ApiService);
  protected readonly config = inject(ConfigService);
  readonly tracker = input.required<JobTracker>();
  readonly doneText = input('Done! Your file is ready.');
  /** Show a player for the first video output. */
  readonly showPreview = input(true);
  readonly retry = output<void>();
  protected readonly formatBytes = formatBytes;
  protected readonly previewFile = computed<JobFile | null>(() =>
    this.showPreview() ? (this.tracker().job()?.files.find((f) => /^video\/(mp4|webm)$/.test(f.mimeType)) ?? null) : null,
  );
}
