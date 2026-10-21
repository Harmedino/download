import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { ApiService } from '../core/api.service';
import { ConfigService } from '../core/config.service';
import { ApiError } from '../core/errors';
import { formatBytes, formatDuration } from '../core/format';
import { JobTracker } from '../core/job-tracker';
import type { FetchResponse, MediaFile, MediaInfo, QualityPreset } from '../core/models';
import { ErrorBanner } from './error-banner';
import { ProgressBar } from './progress-bar';
import { Spinner } from './spinner';

type Kind = MediaInfo['kind'];

const ACCEPT: Record<Kind, string> = {
  video: 'video/*,.mkv,.mov',
  audio: 'audio/*',
  image: 'image/png,image/jpeg,image/webp,image/gif',
};

/**
 * The first step of every tool: upload a file or import one from a link, then show what was picked.
 * Two-way bind the result: <app-media-source [(file)]="source" />.
 */
@Component({
  selector: 'app-media-source',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorBanner, ProgressBar, Spinner],
  template: `
    @if (file(); as f) {
      <div class="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            @if (f.info?.kind === 'audio') {
              <path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
            } @else if (f.info?.kind === 'image') {
              <path d="M4 16l4-4 3 3 5-6 4 5M4 4h16v16H4z" />
            } @else {
              <path d="M4 6h11v12H4zM15 10l5-3v10l-5-3" />
            }
          </svg>
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium" [title]="f.name">{{ f.name }}</p>
          <p class="truncate text-xs text-zinc-500 dark:text-zinc-400">{{ describe(f) }}</p>
        </div>
        @if (!locked()) {
          <button type="button" (click)="clear()" class="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-violet-600 hover:bg-violet-500/10 dark:text-violet-300">
            Change
          </button>
        }
      </div>
    } @else {
      <div class="rounded-3xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
        <div class="grid grid-cols-2 gap-1 rounded-2xl bg-zinc-100 p-1 dark:bg-zinc-800" role="tablist">
          @for (t of tabs; track t.id) {
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="tab() === t.id"
              (click)="tab.set(t.id)"
              class="rounded-xl px-3 py-2 text-sm font-medium transition"
              [class]="tab() === t.id ? 'bg-white text-zinc-900 shadow dark:bg-zinc-950 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'"
            >
              {{ t.label }}
            </button>
          }
        </div>

        @if (tab() === 'upload') {
          <label
            [attr.for]="inputId"
            class="mt-2 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition"
            [class]="dragging() ? 'border-violet-500 bg-violet-500/10' : 'border-zinc-300 hover:border-violet-400 dark:border-zinc-700'"
            (dragover)="$event.preventDefault(); dragging.set(true)"
            (dragleave)="dragging.set(false)"
            (drop)="onDrop($event)"
          >
            <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
              <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
              </svg>
            </span>
            <span class="font-semibold">{{ uploading() ? 'Uploading…' : 'Drop a file or tap to upload' }}</span>
            <span class="text-xs text-zinc-500 dark:text-zinc-400">{{ acceptText() }} · up to {{ config.maxMediaUploadMb() }} MB · {{ config.maxMediaMinutes() }} min</span>
            <input [id]="inputId" type="file" [accept]="acceptAttr()" class="sr-only" (change)="onPick($event)" [disabled]="uploading()" />
          </label>
          @if (uploading()) {
            <div class="mt-3 px-1"><app-progress-bar [value]="uploadPct()" [label]="uploadPct() < 100 ? 'Uploading' : 'Checking file'" /></div>
          }
        } @else {
          <form class="mt-2 flex flex-col gap-2 sm:flex-row" (submit)="$event.preventDefault(); fetchLink()" novalidate>
            <label [attr.for]="inputId + '-url'" class="sr-only">Media link</label>
            <input
              [id]="inputId + '-url'"
              type="url"
              inputmode="url"
              autocomplete="off"
              spellcheck="false"
              placeholder="Paste a post link or a direct link to a .mp4 file"
              class="h-12 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-transparent px-3 outline-none focus:border-violet-500 dark:border-zinc-700"
              [value]="linkUrl()"
              (input)="linkUrl.set($any($event.target).value); preview.set(null)"
            />
            <button
              type="submit"
              [disabled]="!linkUrl().trim() || fetching() || importJob.busy()"
              class="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
            >
              @if (fetching()) {
                <app-spinner sizeClass="h-4 w-4" />
              }
              Check link
            </button>
          </form>
          @if (preview(); as p) {
            <div class="mt-3 flex gap-3 rounded-2xl bg-zinc-100 p-3 dark:bg-zinc-800/60">
              <div class="h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-zinc-200 dark:bg-zinc-800">
                @if (p.metadata.thumbnail) {
                  <img [src]="p.metadata.thumbnail" alt="" class="h-full w-full object-cover" referrerpolicy="no-referrer" />
                }
              </div>
              <div class="min-w-0 flex-1">
                <p class="line-clamp-2 text-sm font-medium">{{ p.metadata.title }}</p>
                <p class="text-xs text-zinc-500 dark:text-zinc-400">
                  {{ p.platform === 'direct' ? 'Direct file' : p.metadata.uploader || p.platform }}
                  @if (p.metadata.duration) {
                    · {{ formatDuration(p.metadata.duration) }}
                  }
                  @if (p.metadata.filesize) {
                    · {{ formatBytes(p.metadata.filesize) }}
                  }
                </p>
                @if (p.metadata.formats.length) {
                  <div class="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label="Quality">
                    @for (q of p.metadata.formats; track q.id) {
                      <button
                        type="button"
                        role="radio"
                        [attr.aria-checked]="quality() === q.id"
                        (click)="quality.set(q.id)"
                        class="rounded-lg border px-2 py-1 text-xs font-medium"
                        [class]="quality() === q.id ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200' : 'border-zinc-300 dark:border-zinc-700'"
                      >
                        {{ q.label }}
                      </button>
                    }
                  </div>
                }
              </div>
            </div>
            <button
              type="button"
              (click)="importLink()"
              [disabled]="importJob.busy()"
              class="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-sm font-semibold text-white disabled:opacity-60"
            >
              @if (importJob.busy()) {
                <app-spinner sizeClass="h-4 w-4" />
                Importing…
              } @else {
                Import this {{ p.metadata.kind === 'image' ? 'image' : 'video' }}
              }
            </button>
            @if (importJob.busy()) {
              <div class="mt-2"><app-progress-bar [value]="importJob.progress()" [label]="importJob.stage() ?? 'Queued'" /></div>
            }
          }
        }
        <p class="px-2 pt-2 pb-1 text-xs text-zinc-500 dark:text-zinc-400">
          Only use media you own or have permission to edit. Files are private to this browser and deleted after {{ config.retentionText() }}.
        </p>
      </div>
    }
    @if (error()) {
      <div class="mt-3"><app-error-banner [error]="error()" /></div>
    }
  `,
})
export class MediaSource {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly config = inject(ConfigService);

  readonly file = model<MediaFile | null>(null);
  readonly accept = input<Kind[]>(['video']);
  /** Load this stored file on start (e.g. ?fileId= from the download page). */
  readonly fileId = input<string | undefined>();
  /** Hide "Change" (e.g. while a job runs on this file). */
  readonly locked = input(false);

  private static seq = 0;
  protected readonly inputId = `media-source-${++MediaSource.seq}`;
  protected readonly tabs = [
    { id: 'upload' as const, label: 'Upload' },
    { id: 'link' as const, label: 'Paste link' },
  ];
  protected readonly tab = signal<'upload' | 'link'>('upload');
  protected readonly dragging = signal(false);
  protected readonly uploading = signal(false);
  protected readonly uploadPct = signal(0);
  protected readonly linkUrl = signal('');
  protected readonly fetching = signal(false);
  protected readonly preview = signal<FetchResponse | null>(null);
  protected readonly quality = signal<QualityPreset | null>(null);
  protected readonly importJob = new JobTracker(this.api);
  protected readonly localError = signal<ApiError | null>(null);
  protected readonly error = computed(() => this.localError() ?? this.importJob.error());
  protected readonly acceptAttr = computed(() => this.accept().map((k) => ACCEPT[k]).join(','));
  protected readonly acceptText = computed(() =>
    this.accept()
      .map((k) => ({ video: 'MP4, MOV, WebM, MKV', audio: 'MP3, WAV, M4A', image: 'JPG, PNG, WebP' })[k])
      .join(' · '),
  );
  protected readonly formatBytes = formatBytes;
  protected readonly formatDuration = formatDuration;
  private uploadSub: Subscription | null = null;

  constructor() {
    effect(() => {
      const id = this.fileId();
      if (id) untracked(() => this.loadStored(id));
    });
    this.destroyRef.onDestroy(() => {
      this.importJob.cancel();
      this.uploadSub?.unsubscribe();
    });
  }

  protected describe(f: MediaFile): string {
    const i = f.info;
    return [
      i?.width && i?.height ? `${i.width}×${i.height}` : '',
      i?.duration ? formatDuration(i.duration) : '',
      i?.fps ? `${i.fps} fps` : '',
      i && i.kind === 'video' && !i.hasAudio ? 'no audio' : '',
      formatBytes(f.size),
    ]
      .filter(Boolean)
      .join(' · ');
  }

  protected clear(): void {
    this.file.set(null);
    this.preview.set(null);
    this.importJob.reset();
    this.localError.set(null);
  }

  protected onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragging.set(false);
    const f = ev.dataTransfer?.files?.[0];
    if (f) this.upload(f);
  }

  protected onPick(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const f = el.files?.[0];
    el.value = '';
    if (f) this.upload(f);
  }

  private upload(f: File): void {
    this.localError.set(null);
    if (f.size > this.config.maxMediaUploadMb() * 1024 * 1024) {
      this.localError.set(new ApiError('UPLOAD_TOO_LARGE', `Files must be ${this.config.maxMediaUploadMb()} MB or smaller.`, 413));
      return;
    }
    this.uploading.set(true);
    this.uploadPct.set(0);
    this.uploadSub?.unsubscribe();
    this.uploadSub = this.api.uploadMedia(f).subscribe({
      next: (e) => {
        this.uploadPct.set(e.progress);
        if (e.file) this.accepted(e.file);
      },
      error: (e: ApiError) => {
        this.uploading.set(false);
        this.localError.set(e);
      },
      complete: () => this.uploading.set(false),
    });
  }

  protected fetchLink(): void {
    const url = this.linkUrl().trim();
    if (!url) return;
    this.fetching.set(true);
    this.localError.set(null);
    this.importJob.reset();
    this.api
      .fetchMedia(url)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.fetching.set(false);
          const firstAllowed = res.metadata.items.find((i) => this.accept().includes(i.type));
          if (!firstAllowed && res.metadata.kind !== 'video') {
            this.localError.set(new ApiError('UNSUPPORTED_FILE', `This link has no ${this.accept().join(' or ')} to import.`, 415));
            return;
          }
          this.preview.set(res);
          const formats = res.metadata.formats;
          this.quality.set(formats.find((f) => f.id === '1080p')?.id ?? formats.at(-1)?.id ?? null);
        },
        error: (e: ApiError) => {
          this.fetching.set(false);
          this.localError.set(e);
        },
      });
  }

  protected importLink(): void {
    const p = this.preview();
    if (!p) return;
    const multi = p.metadata.items.length > 1;
    const item = p.metadata.items.find((i) => this.accept().includes(i.type));
    this.importJob.run(
      this.api.startDownload({ url: p.sourceUrl, formatId: this.quality() ?? undefined, itemIndex: multi ? item?.index : undefined }),
      (job) => {
        const f = job.files[0];
        if (f) this.loadStored(f.id);
      },
    );
  }

  private loadStored(id: string): void {
    this.localError.set(null);
    this.api
      .getMedia(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (f) => this.accepted(f), error: (e: ApiError) => this.localError.set(e) });
  }

  private accepted(f: MediaFile): void {
    const kind = f.info?.kind;
    if (kind && !this.accept().includes(kind)) {
      this.localError.set(new ApiError('UNSUPPORTED_FILE', `This tool needs ${this.accept().join(' or ')}; that file is ${kind}.`, 415));
      return;
    }
    this.file.set(f);
  }
}
