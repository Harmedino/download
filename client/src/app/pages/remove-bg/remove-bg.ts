import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { ApiError } from '../../core/errors';
import { formatBytes } from '../../core/format';
import { JobTracker } from '../../core/job-tracker';
import { type BgMode, canvasToBlob, composeToCanvas, loadImage, saveBlob } from '../../core/compose';
import { CompareSlider } from '../../shared/compare-slider';
import { ErrorBanner } from '../../shared/error-banner';
import { ProgressBar } from '../../shared/progress-bar';
import { RemoveBgTabs } from '../../shared/remove-bg-tabs';
import { Spinner } from '../../shared/spinner';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|avif|heic|heif|bmp|tiff)$/;
const PREVIEW_MAX_SIDE = 1400;

interface Source {
  /** URL for the "before" image (object URL for uploads, API URL for fetched files). */
  url: string;
  name: string;
  size: number | null;
  file?: File;
  fileId?: string;
}

@Component({
  selector: 'app-remove-bg',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CompareSlider, ErrorBanner, ProgressBar, RemoveBgTabs, Spinner],
  templateUrl: './remove-bg.html',
})
export class RemoveBg {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** Set by the result page ("Remove background" on a fetched image). */
  readonly fileId = input<string | undefined>();
  readonly name = input<string | undefined>();

  protected readonly source = signal<Source | null>(null);
  protected readonly ratio = signal('4 / 3');
  protected readonly dragging = signal(false);
  protected readonly localError = signal<ApiError | null>(null);
  protected readonly uploadPct = signal(0);
  protected readonly job = new JobTracker(this.api);

  protected readonly mode = signal<BgMode>('transparent');
  protected readonly color = signal('#ffffff');
  protected readonly blur = signal(40);
  protected readonly customBg = signal<{ img: HTMLImageElement; url: string } | null>(null);
  protected readonly presets = ['#ffffff', '#000000', '#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#e5e7eb'];
  protected readonly modes: Array<{ id: BgMode; label: string }> = [
    { id: 'transparent', label: 'Transparent' },
    { id: 'color', label: 'Color' },
    { id: 'blur', label: 'Blur' },
    { id: 'image', label: 'Image' },
  ];

  private readonly cutoutImg = signal<HTMLImageElement | null>(null);
  private readonly originalImg = signal<HTMLImageElement | null>(null);
  protected readonly preview = signal<string | null>(null);
  protected readonly exporting = signal(false);

  protected readonly error = computed(() => this.localError() ?? this.job.error());
  protected readonly ready = computed(() => !!this.cutoutImg() && !!this.originalImg());
  protected readonly working = computed(() => this.job.busy() || (this.job.state() === 'done' && !this.ready() && !this.localError()));
  protected readonly formatBytes = formatBytes;

  private renderToken = 0;

  constructor() {
    // Start from a fetched file when the page is opened with ?fileId=
    effect(() => {
      const id = this.fileId();
      if (id) untracked(() => this.useFetched(id, this.name() ?? 'image'));
    });

    // Re-render the live preview whenever the background options change.
    effect(() => {
      const cut = this.cutoutImg();
      const orig = this.originalImg();
      const bg = { mode: this.mode(), color: this.color(), blur: this.blur(), image: this.customBg()?.img ?? null };
      if (!cut || !orig) return;
      const token = ++this.renderToken;
      requestAnimationFrame(async () => {
        if (token !== this.renderToken) return;
        const canvas = composeToCanvas(cut, orig, bg, PREVIEW_MAX_SIDE);
        const blob = await canvasToBlob(canvas);
        if (token !== this.renderToken) return;
        this.setPreview(URL.createObjectURL(blob));
      });
    });

    this.destroyRef.onDestroy(() => {
      this.job.cancel();
      this.revokeAll();
    });
  }

  // ---- input -------------------------------------------------------------

  protected onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragging.set(false);
    const file = ev.dataTransfer?.files?.[0];
    if (file) this.useUpload(file);
  }

  protected onPick(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (file) this.useUpload(file);
  }

  private useUpload(file: File): void {
    if (!IMAGE_TYPES.test(file.type)) {
      this.localError.set(new ApiError('UNSUPPORTED_FILE', 'Please upload a JPG, PNG or WebP image.'));
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      this.localError.set(new ApiError('UPLOAD_TOO_LARGE', 'Too large'));
      return;
    }
    this.reset();
    const url = URL.createObjectURL(file);
    this.setSource({ url, name: file.name, size: file.size, file });
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('background', 'transparent');
    this.uploadPct.set(0);
    this.job.run(this.api.startUploadJob('/api/remove-bg/image', form, (p) => this.uploadPct.set(p)), (j) => this.onDone(j.files));
  }

  private useFetched(fileId: string, name: string): void {
    this.reset();
    this.setSource({ url: this.api.fileUrl(fileId, true), name, size: null, fileId });
    this.uploadPct.set(100);
    this.job.run(this.api.startJsonJob('/api/remove-bg/image', { fileId, background: 'transparent' }), (j) => this.onDone(j.files));
  }

  private setSource(s: Source): void {
    this.source.set(s);
    loadImage(s.url)
      .then((img) => {
        this.ratio.set(`${img.naturalWidth} / ${img.naturalHeight}`);
        this.originalImg.set(img);
      })
      .catch(() => this.localError.set(new ApiError('INVALID_IMAGE', "We couldn't open that image.")));
  }

  private async onDone(files: Array<{ url: string; name: string }>): Promise<void> {
    // The transparent cutout is always the last file; backgrounds are composited in the browser.
    const cut = files.at(-1);
    if (!cut) return;
    try {
      this.cutoutImg.set(await loadImage(this.api.fileUrl(cut.url, true)));
    } catch {
      this.localError.set(new ApiError('FILE_EXPIRED', 'Result expired'));
    }
  }

  // ---- background options -----------------------------------------------

  protected async onPickBackground(ev: Event): Promise<void> {
    const el = ev.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    if (!IMAGE_TYPES.test(file.type)) {
      this.localError.set(new ApiError('UNSUPPORTED_FILE', 'Please choose a JPG, PNG or WebP image.'));
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const prev = this.customBg();
      if (prev) URL.revokeObjectURL(prev.url);
      this.customBg.set({ img, url });
      this.mode.set('image');
    } catch {
      URL.revokeObjectURL(url);
      this.localError.set(new ApiError('INVALID_IMAGE', "We couldn't open that image."));
    }
  }

  protected async download(): Promise<void> {
    const cut = this.cutoutImg();
    const orig = this.originalImg();
    if (!cut || !orig) return;
    this.exporting.set(true);
    try {
      const canvas = composeToCanvas(cut, orig, { mode: this.mode(), color: this.color(), blur: this.blur(), image: this.customBg()?.img ?? null });
      const base = (this.source()?.name ?? 'image').replace(/\.[^.]+$/, '').slice(0, 80) || 'image';
      saveBlob(await canvasToBlob(canvas), `${base}_${this.mode()}_snapgrab.png`);
    } finally {
      this.exporting.set(false);
    }
  }

  protected startOver(): void {
    this.reset();
    this.source.set(null);
  }

  // ---- housekeeping ------------------------------------------------------

  private reset(): void {
    this.job.reset();
    this.localError.set(null);
    this.cutoutImg.set(null);
    this.originalImg.set(null);
    this.setPreview(null);
    const s = this.source();
    if (s?.file) URL.revokeObjectURL(s.url);
  }

  private setPreview(url: string | null): void {
    const prev = this.preview();
    if (prev) URL.revokeObjectURL(prev);
    this.preview.set(url);
  }

  private revokeAll(): void {
    this.setPreview(null);
    const s = this.source();
    if (s?.file) URL.revokeObjectURL(s.url);
    const bg = this.customBg();
    if (bg) URL.revokeObjectURL(bg.url);
  }
}
