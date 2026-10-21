import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { ApiError } from '../../core/errors';
import { formatBytes, formatDuration } from '../../core/format';
import { JobTracker, triggerDownload } from '../../core/job-tracker';
import { ErrorBanner } from '../../shared/error-banner';
import { ProgressBar } from '../../shared/progress-bar';
import { RemoveBgTabs } from '../../shared/remove-bg-tabs';
import { Spinner } from '../../shared/spinner';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_SECONDS = 60;
const VIDEO_TYPES = /^video\/(mp4|webm|quicktime|x-matroska|x-m4v|3gpp|ogg)$/;

interface Source {
  url: string;
  name: string;
  size: number | null;
  duration: number | null;
  file?: File;
  fileId?: string;
}

/** Reads a video's duration in the browser so over-long clips are rejected before uploading. */
function readDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => resolve(v.duration);
    v.onerror = () => reject(new Error('unreadable'));
    v.src = url;
  });
}

@Component({
  selector: 'app-remove-bg-video',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorBanner, ProgressBar, RemoveBgTabs, Spinner],
  templateUrl: './remove-bg-video.html',
  styles: `
    .checker {
      background-color: #fff;
      background-image:
        linear-gradient(45deg, #d4d4d8 25%, transparent 25%), linear-gradient(-45deg, #d4d4d8 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #d4d4d8 75%), linear-gradient(-45deg, transparent 75%, #d4d4d8 75%);
      background-size: 20px 20px;
      background-position: 0 0, 0 10px, 10px -10px, -10px 0;
    }
  `,
})
export class RemoveBgVideo {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** Set by the result page ("Remove background" on a fetched video). */
  readonly fileId = input<string | undefined>();
  readonly name = input<string | undefined>();

  protected readonly source = signal<Source | null>(null);
  protected readonly background = signal<'transparent' | 'color'>('transparent');
  protected readonly color = signal('#00b140');
  protected readonly presets = ['#00b140', '#ffffff', '#000000', '#3b82f6', '#f43f5e', '#f59e0b'];
  protected readonly dragging = signal(false);
  protected readonly localError = signal<ApiError | null>(null);
  protected readonly uploadPct = signal(0);
  protected readonly job = new JobTracker(this.api);
  /** Wall-clock start of server processing, used for the time estimate. */
  private readonly startedAt = signal<number | null>(null);
  private readonly now = signal(Date.now());

  protected readonly error = computed(() => this.localError() ?? this.job.error());
  protected readonly result = computed(() => this.job.job()?.files[0] ?? null);
  protected readonly resultUrl = computed(() => (this.result() ? this.api.fileUrl(this.result()!.url, true) : null));
  protected readonly isUploading = computed(() => this.job.state() === 'starting' && !!this.source()?.file);
  protected readonly eta = computed(() => {
    const start = this.startedAt();
    const pct = this.job.progress();
    if (!start || pct < 8 || pct >= 99) return null;
    const elapsed = (this.now() - start) / 1000;
    const remaining = (elapsed / pct) * (100 - pct);
    return remaining > 5 ? remaining : null;
  });

  protected readonly formatBytes = formatBytes;
  protected readonly formatDuration = formatDuration;
  protected readonly maxSeconds = MAX_SECONDS;

  constructor() {
    effect(() => {
      const id = this.fileId();
      if (id) untracked(() => this.useFetched(id, this.name() ?? 'video'));
    });
    effect(() => {
      if (this.job.state() === 'running' && this.startedAt() === null) this.startedAt.set(Date.now());
    });
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => {
      clearInterval(tick);
      this.job.cancel();
      this.revoke();
    });
  }

  protected onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragging.set(false);
    const file = ev.dataTransfer?.files?.[0];
    if (file) void this.useUpload(file);
  }

  protected onPick(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (file) void this.useUpload(file);
  }

  private async useUpload(file: File): Promise<void> {
    this.reset();
    if (!VIDEO_TYPES.test(file.type)) return this.localError.set(new ApiError('UNSUPPORTED_FILE', 'Unsupported'));
    if (file.size > MAX_UPLOAD_BYTES) return this.localError.set(new ApiError('UPLOAD_TOO_LARGE', 'Too large'));
    const url = URL.createObjectURL(file);
    let duration: number | null = null;
    try {
      duration = await readDuration(url);
    } catch {
      // Some containers (e.g. MKV) can't be previewed in every browser; the server will check.
    }
    if (duration !== null && duration > MAX_SECONDS + 0.5) {
      URL.revokeObjectURL(url);
      return this.localError.set(new ApiError('VIDEO_TOO_LONG', 'Too long'));
    }
    this.source.set({ url, name: file.name, size: file.size, duration, file });
  }

  private useFetched(fileId: string, name: string): void {
    this.reset();
    const url = this.api.fileUrl(fileId, true);
    this.source.set({ url, name, size: null, duration: null, fileId });
    readDuration(url)
      .then((d) => {
        this.source.update((s) => (s ? { ...s, duration: d } : s));
        if (d > MAX_SECONDS + 0.5) this.localError.set(new ApiError('VIDEO_TOO_LONG', 'Too long'));
      })
      .catch(() => undefined);
  }

  protected start(): void {
    const s = this.source();
    if (!s || this.job.busy()) return;
    this.localError.set(null);
    this.startedAt.set(null);
    const color = this.background() === 'color' ? this.color() : undefined;
    if (s.file) {
      const form = new FormData();
      form.append('file', s.file, s.name);
      form.append('background', this.background());
      if (color) form.append('color', color);
      this.uploadPct.set(0);
      this.job.run(this.api.startUploadJob('/api/remove-bg/video', form, (p) => this.uploadPct.set(p)));
    } else if (s.fileId) {
      this.job.run(this.api.startJsonJob('/api/remove-bg/video', { fileId: s.fileId, background: this.background(), color }));
    }
  }

  protected download(): void {
    const f = this.result();
    if (f) triggerDownload(this.api.fileUrl(f.url));
  }

  protected startOver(): void {
    this.reset();
  }

  protected formatEta(seconds: number): string {
    if (seconds < 60) return `about ${Math.ceil(seconds / 5) * 5} s left`;
    return `about ${Math.ceil(seconds / 60)} min left`;
  }

  private reset(): void {
    this.job.reset();
    this.localError.set(null);
    this.startedAt.set(null);
    this.revoke();
    this.source.set(null);
  }

  private revoke(): void {
    const s = this.source();
    if (s?.file) URL.revokeObjectURL(s.url);
  }
}
