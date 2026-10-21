import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ApiError } from '../../core/errors';
import { formatBytes, formatDuration } from '../../core/format';
import { HistoryService } from '../../core/history.service';
import { JobTracker, triggerDownload } from '../../core/job-tracker';
import { MediaStateService } from '../../core/media-state.service';
import type { FetchResponse, JobView, MediaItem, QualityPreset } from '../../core/models';
import { PLATFORM_NAMES } from '../../core/platform';
import { AdSlot } from '../../shared/ad-slot';
import { ErrorBanner } from '../../shared/error-banner';
import { PlatformIcon } from '../../shared/platform-icon';
import { ProgressBar } from '../../shared/progress-bar';
import { Spinner } from '../../shared/spinner';

@Component({
  selector: 'app-result',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AdSlot, RouterLink, PlatformIcon, ErrorBanner, ProgressBar, Spinner],
  templateUrl: './result.html',
})
export class Result {
  private readonly api = inject(ApiService);
  private readonly mediaState = inject(MediaStateService);
  private readonly history = inject(HistoryService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  /** Bound from the `?url=` query param (withComponentInputBinding), so reloads and shared links work. */
  readonly url = input<string>('');

  protected readonly data = signal<FetchResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<ApiError | null>(null);

  protected readonly quality = signal<QualityPreset | null>(null);
  protected readonly audioOnly = signal(false);

  protected readonly main = new JobTracker(this.api);
  protected readonly zip = new JobTracker(this.api);
  /** Downloads an image to the server, then opens it in the background remover (images only). */
  protected readonly toRemoveBg = new JobTracker(this.api);
  protected readonly removeBgIndex = signal<number | null>(null);
  /** Fetches the MP3 to play in the page instead of saving it. */
  protected readonly listen = new JobTracker(this.api);
  /** Inline URL of the fetched MP3, shown in the audio player. */
  protected readonly playerSrc = signal<string | null>(null);
  private readonly itemTrackers = new Map<number, JobTracker>();

  protected readonly meta = computed(() => this.data()?.metadata ?? null);
  protected readonly platformName = computed(() => (this.data() ? PLATFORM_NAMES[this.data()!.platform] : ''));
  protected readonly isCarousel = computed(() => (this.meta()?.items.length ?? 0) > 1);
  protected readonly isVideo = computed(() => this.meta()?.kind === 'video');
  protected readonly selectedFormat = computed(() => this.meta()?.formats.find((f) => f.id === this.quality()) ?? null);
  protected readonly displaySize = computed(() => {
    if (this.audioOnly()) return '';
    return formatBytes(this.selectedFormat()?.filesize ?? this.meta()?.filesize);
  });

  protected readonly formatBytes = formatBytes;
  protected readonly formatDuration = formatDuration;

  constructor() {
    effect(() => {
      const url = this.url();
      untracked(() => this.load(url));
    });
    this.destroyRef.onDestroy(() => {
      this.main.cancel();
      this.zip.cancel();
      this.toRemoveBg.cancel();
      this.listen.cancel();
      this.itemTrackers.forEach((t) => t.cancel());
    });
  }

  private load(url: string): void {
    if (!url) {
      this.loadError.set(new ApiError('INVALID_URL', 'Missing link'));
      return;
    }
    const cached = this.mediaState.current();
    if (cached && cached.sourceUrl === url) {
      this.setData(cached);
      return;
    }
    this.loading.set(true);
    this.loadError.set(null);
    this.api
      .fetchMedia(url)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.mediaState.current.set(res);
          this.setData(res);
          this.loading.set(false);
        },
        error: (e: ApiError) => {
          this.loadError.set(e);
          this.loading.set(false);
        },
      });
  }

  private setData(res: FetchResponse): void {
    this.data.set(res);
    this.playerSrc.set(null);
    const formats = res.metadata.formats;
    // Default to 720p when available: a good balance of size and quality on phones.
    this.quality.set(formats.find((f) => f.id === '720p')?.id ?? formats.at(-1)?.id ?? null);
    // Audio-only sources such as SoundCloud have no video qualities, so default to the MP3 download.
    this.audioOnly.set(res.metadata.kind === 'video' && !formats.length && res.metadata.hasAudio && res.metadata.extractor === 'yt-dlp');
  }

  protected retryLoad(): void {
    this.mediaState.current.set(null);
    this.load(this.url());
  }

  protected tracker(index: number): JobTracker {
    let t = this.itemTrackers.get(index);
    if (!t) {
      t = new JobTracker(this.api);
      this.itemTrackers.set(index, t);
    }
    return t;
  }

  protected downloadMain(): void {
    const d = this.data();
    if (!d) return;
    const audio = this.audioOnly() && this.isVideo();
    this.main.run(
      this.api.startDownload({
        url: d.sourceUrl,
        formatId: audio ? undefined : (this.quality() ?? undefined),
        audioOnly: audio || undefined,
      }),
      (job) => {
        this.finish(job, d.metadata.thumbnail);
        if (audio) this.play(job);
      },
    );
  }

  /** Fetches the MP3 and plays it in the page, without saving it. */
  protected listenHere(): void {
    const d = this.data();
    if (!d) return;
    this.listen.run(this.api.startDownload({ url: d.sourceUrl, audioOnly: true }), (job) => this.play(job));
  }

  private play(job: JobView): void {
    const f = job.files[0];
    if (f?.mimeType.startsWith('audio/')) this.playerSrc.set(this.api.fileUrl(f.url, true));
  }

  protected downloadItem(item: MediaItem): void {
    const d = this.data();
    if (!d) return;
    this.tracker(item.index).run(this.api.startDownload({ url: d.sourceUrl, itemIndex: item.index }), (job) =>
      this.finish(job, item.thumbnail ?? d.metadata.thumbnail),
    );
  }

  protected downloadZip(): void {
    const d = this.data();
    if (!d) return;
    this.zip.run(this.api.startZip(d.sourceUrl), (job) => this.finish(job, d.metadata.thumbnail));
  }

  protected removeBackground(index: number): void {
    const d = this.data();
    if (!d) return;
    this.removeBgIndex.set(index);
    this.toRemoveBg.run(
      this.api.startDownload({ url: d.sourceUrl, itemIndex: this.isCarousel() ? index : undefined }),
      (job) => {
        const f = job.files[0];
        if (!f?.mimeType.startsWith('image/')) return;
        void this.router.navigate(['/remove-bg'], { queryParams: { fileId: f.id, name: f.name } });
      },
    );
  }

  private finish(job: JobView, thumbnail: string | null): void {
    const d = this.data();
    for (const f of job.files) {
      const href = this.api.fileUrl(f.url);
      triggerDownload(href);
      this.history.add({
        id: f.id,
        sourceUrl: d?.sourceUrl ?? '',
        platform: d?.platform ?? null,
        title: d?.metadata.title ?? f.name,
        thumbnail,
        fileName: f.name,
        fileUrl: href,
        size: f.size,
        createdAt: new Date().toISOString(),
        expiresAt: f.expiresAt,
      });
    }
  }

  protected fileHref(job: JobView | null): string | null {
    const f = job?.files[0];
    return f ? this.api.fileUrl(f.url) : null;
  }
}
