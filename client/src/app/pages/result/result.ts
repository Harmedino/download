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
import { ConfigService } from '../../core/config.service';
import { TOOL_LINKS, type ToolLink } from '../../core/tools';
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
  private readonly config = inject(ConfigService);

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
  /** Fetches the selected video or MP3 to play in the page instead of saving it. */
  protected readonly listen = new JobTracker(this.api);
  /** Inline URL of the fetched file, shown in the page's video or audio player. */
  protected readonly playerSrc = signal<string | null>(null);
  /** Whether playerSrc is audio (MP3) rather than video. */
  protected readonly playerIsAudio = signal(false);
  private readonly itemTrackers = new Map<number, JobTracker>();

  protected readonly meta = computed(() => this.data()?.metadata ?? null);
  protected readonly platformName = computed(() => {
    const p = this.data()?.platform;
    if (!p) return '';
    return p === 'direct' ? 'Direct link' : PLATFORM_NAMES[p];
  });
  protected readonly platformIcon = computed(() => {
    const p = this.data()?.platform;
    return p && p !== 'direct' ? p : null;
  });
  /** Video tools this post can be opened in (single videos only). */
  protected readonly editTools = computed(() => {
    const m = this.meta();
    // Audio-only sources (SoundCloud) report no video formats; direct links have none until imported.
    const isVideo = m?.kind === 'video' && (m.formats.length > 0 || this.data()?.platform === 'direct');
    return isVideo ? TOOL_LINKS.filter((t) => t.tool && t.tool !== 'thumbnail' && this.config.has(t.tool)) : [];
  });
  /** Downloads the video to the server, then opens it in a tool. */
  protected readonly toTool = new JobTracker(this.api);
  protected readonly toolTarget = signal<string | null>(null);
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
      this.toTool.cancel();
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

  private mainRequest(url: string) {
    const audio = this.audioOnly();
    return { url, formatId: audio ? undefined : (this.quality() ?? undefined), audioOnly: audio || undefined };
  }

  protected downloadMain(): void {
    const d = this.data();
    if (!d) return;
    this.main.run(this.api.startDownload(this.mainRequest(d.sourceUrl)), (job) => {
      this.finish(job, d.metadata.thumbnail);
      if (this.isVideo()) this.play(job);
    });
  }

  /** Fetches the selected video quality or MP3 and plays it in the page, without saving it. */
  protected playHere(): void {
    const d = this.data();
    if (!d || !this.isVideo() || this.listen.busy()) return;
    this.listen.run(this.api.startDownload(this.mainRequest(d.sourceUrl)), (job) => this.play(job));
  }

  private play(job: JobView): void {
    const f = job.files[0];
    if (!f || !/^(audio|video)\//.test(f.mimeType)) return;
    this.playerIsAudio.set(f.mimeType.startsWith('audio/'));
    this.playerSrc.set(this.api.fileUrl(f.url, true));
  }

  protected selectQuality(id: QualityPreset | null, audio: boolean): void {
    if (id) this.quality.set(id);
    this.audioOnly.set(audio);
    this.playerSrc.set(null);
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

  protected openInTool(t: ToolLink): void {
    const d = this.data();
    if (!d) return;
    this.toolTarget.set(t.path);
    this.toTool.run(this.api.startDownload({ url: d.sourceUrl, formatId: this.quality() ?? undefined }), (job) => {
      const f = job.files[0];
      if (f) void this.router.navigate([t.path], { queryParams: { fileId: f.id } });
    });
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
