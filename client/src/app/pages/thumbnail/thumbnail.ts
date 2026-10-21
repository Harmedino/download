import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ApiService } from '../../core/api.service';
import { JobTracker } from '../../core/job-tracker';
import type { MediaFile } from '../../core/models';
import { FONT_FAMILIES } from '../../shared/composition-preview';
import { CropBox, centeredCrop, type CropRect } from '../../shared/crop-box';
import { JobPanel } from '../../shared/job-panel';
import { MediaSource } from '../../shared/media-source';
import { Spinner } from '../../shared/spinner';
import { ToolHeader, ui } from '../../shared/tool-page';

interface ThumbText {
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  stroke: string;
  font: string;
}

type ImageFormat = 'jpg' | 'png' | 'webp';

const SHAPES: Array<{ id: string; label: string; ratio: number | null }> = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
];

@Component({
  selector: 'app-thumbnail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MediaSource, CropBox, JobPanel, Spinner, ToolHeader],
  template: `
    <section class="mx-auto max-w-6xl px-4 pt-8 sm:pt-12">
      <app-tool-header
        title="Thumbnail editor"
        subtitle="Crop a frame or image, brighten it up and add bold text. Pick a frame with the Frame extractor or upload an image."
      />
      @if (!source()) {
        <div class="mx-auto mt-8 max-w-2xl">
          <app-media-source [(file)]="source" [accept]="['image']" [fileId]="fileId()" />
        </div>
      } @else {
        @let s = source()!;
        <div class="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div class="min-w-0 space-y-4">
            <div class="flex justify-center rounded-3xl bg-zinc-950 p-2">
              <div
                class="relative max-h-[55vh] max-w-full"
                [style.aspect-ratio]="w() + ' / ' + h()"
              >
                <img
                  #img
                  [src]="api.fileUrl(s.url, true)"
                  crossorigin="anonymous"
                  alt=""
                  class="block h-full max-h-[55vh] w-full rounded-xl"
                  (load)="loaded.set(true)"
                />
                <app-crop-box
                  [(rect)]="crop"
                  [ratio]="ratio()"
                  [frameWidth]="w()"
                  [frameHeight]="h()"
                />
              </div>
            </div>
            <div>
              <p [class]="ui.label">Preview</p>
              <div class="flex justify-center rounded-2xl bg-zinc-950 p-2">
                <canvas #canvas class="max-h-[40vh] max-w-full rounded-lg"></canvas>
              </div>
              <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                The export keeps full resolution ({{ outSize() }}).
              </p>
            </div>
          </div>

          <div class="space-y-4">
            <div [class]="ui.card">
              <div class="flex items-center justify-between gap-2">
                <p class="truncate text-sm font-medium" [title]="s.name">{{ s.name }}</p>
                <button
                  type="button"
                  class="shrink-0 text-sm underline"
                  [disabled]="job.busy()"
                  (click)="source.set(null)"
                >
                  Change
                </button>
              </div>
              <fieldset>
                <legend [class]="ui.label">Crop</legend>
                <div class="flex flex-wrap gap-2" role="radiogroup">
                  @for (sh of shapes; track sh.id) {
                    <button
                      type="button"
                      role="radio"
                      [attr.aria-checked]="shape() === sh.id"
                      (click)="setShape(sh.id)"
                      [class]="ui.chip + ' ' + (shape() === sh.id ? ui.chipOn : ui.chipOff)"
                    >
                      {{ sh.label }}
                    </button>
                  }
                  <button
                    type="button"
                    [class]="ui.chip + ' ' + ui.chipOff"
                    (click)="crop.set({ x: 0, y: 0, w: 1, h: 1 }); shape.set('free')"
                  >
                    Reset
                  </button>
                </div>
              </fieldset>
              @for (a of adjustments; track a.key) {
                <label class="block">
                  <span class="mb-1 flex justify-between text-sm font-medium"
                    >{{ a.label }}
                    <span class="text-zinc-500 tabular-nums">{{
                      adjust()[a.key].toFixed(2)
                    }}</span></span
                  >
                  <input
                    type="range"
                    class="w-full accent-violet-600"
                    [min]="a.min"
                    [max]="a.max"
                    step="0.05"
                    [value]="adjust()[a.key]"
                    (input)="setAdjust(a.key, +$any($event.target).value)"
                  />
                </label>
              }
              <label class="flex items-center gap-2 text-sm"
                ><input
                  type="checkbox"
                  class="accent-violet-600"
                  [checked]="sharpen()"
                  (change)="sharpen.set($any($event.target).checked)"
                />
                Sharpen</label
              >
            </div>

            <div [class]="ui.card">
              <div class="flex items-center justify-between">
                <p class="text-sm font-medium">Text</p>
                <button
                  type="button"
                  class="text-sm underline disabled:opacity-50"
                  [disabled]="texts().length >= 5"
                  (click)="addText()"
                >
                  Add text
                </button>
              </div>
              @for (t of texts(); track $index; let i = $index) {
                <div class="space-y-2 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
                  <div class="flex gap-2">
                    <input
                      class="h-10 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-transparent px-3 text-sm dark:border-zinc-700"
                      maxlength="120"
                      [value]="t.text"
                      (input)="patchText(i, { text: $any($event.target).value })"
                      aria-label="Text"
                    />
                    <button
                      type="button"
                      class="rounded-xl px-2 text-sm text-red-600"
                      (click)="removeText(i)"
                      aria-label="Remove text"
                    >
                      Remove
                    </button>
                  </div>
                  <div class="flex items-center gap-2">
                    <select
                      class="h-9 flex-1 rounded-lg border border-zinc-200 bg-transparent px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                      [value]="t.font"
                      (change)="patchText(i, { font: $any($event.target).value })"
                      aria-label="Font"
                    >
                      @for (f of fonts; track f.id) {
                        <option [value]="f.id" [selected]="f.id === t.font">{{ f.label }}</option>
                      }
                    </select>
                    <input
                      type="color"
                      class="h-9 w-10 rounded"
                      [value]="t.color"
                      (input)="patchText(i, { color: $any($event.target).value })"
                      aria-label="Text colour"
                    />
                    <input
                      type="color"
                      class="h-9 w-10 rounded"
                      [value]="t.stroke"
                      (input)="patchText(i, { stroke: $any($event.target).value })"
                      aria-label="Outline colour"
                    />
                  </div>
                  <label class="block text-xs"
                    >Size<input
                      type="range"
                      class="w-full accent-violet-600"
                      min="0.04"
                      max="0.3"
                      step="0.01"
                      [value]="t.size"
                      (input)="patchText(i, { size: +$any($event.target).value })"
                  /></label>
                  <div class="grid grid-cols-2 gap-2">
                    <label class="block text-xs"
                      >Left / right<input
                        type="range"
                        class="w-full accent-violet-600"
                        min="0"
                        max="1"
                        step="0.01"
                        [value]="t.x"
                        (input)="patchText(i, { x: +$any($event.target).value })"
                    /></label>
                    <label class="block text-xs"
                      >Up / down<input
                        type="range"
                        class="w-full accent-violet-600"
                        min="0"
                        max="1"
                        step="0.01"
                        [value]="t.y"
                        (input)="patchText(i, { y: +$any($event.target).value })"
                    /></label>
                  </div>
                </div>
              }
            </div>

            <div [class]="ui.card">
              <fieldset>
                <legend [class]="ui.label">Format</legend>
                <div class="flex flex-wrap gap-2" role="radiogroup">
                  @for (f of formats; track f) {
                    <button
                      type="button"
                      role="radio"
                      [attr.aria-checked]="format() === f"
                      (click)="format.set(f)"
                      [class]="ui.chip + ' ' + (format() === f ? ui.chipOn : ui.chipOff)"
                    >
                      {{ f.toUpperCase() }}
                    </button>
                  }
                </div>
              </fieldset>
              <button type="button" [class]="ui.primary" [disabled]="job.busy()" (click)="save()">
                @if (job.busy()) {
                  <app-spinner />
                }
                Save thumbnail
              </button>
            </div>
          </div>
        </div>
        <div class="mx-auto mt-6 max-w-2xl">
          <app-job-panel [tracker]="job" doneText="Your thumbnail is ready." (retry)="save()" />
        </div>
      }
    </section>
  `,
})
export class Thumbnail {
  protected readonly api = inject(ApiService);
  readonly fileId = input<string | undefined>();
  protected readonly ui = ui;
  protected readonly shapes = SHAPES;
  protected readonly formats: ImageFormat[] = ['jpg', 'png', 'webp'];
  protected readonly fonts = [
    { id: 'sans', label: 'Sans' },
    { id: 'serif', label: 'Serif' },
    { id: 'mono', label: 'Mono' },
    { id: 'arial', label: 'Arial' },
    { id: 'times', label: 'Times' },
  ];
  protected readonly adjustments = [
    { key: 'brightness' as const, label: 'Brightness', min: 0.3, max: 2 },
    { key: 'contrast' as const, label: 'Contrast', min: 0.5, max: 2 },
    { key: 'saturation' as const, label: 'Saturation', min: 0, max: 3 },
  ];
  protected readonly source = signal<MediaFile | null>(null);
  protected readonly loaded = signal(false);
  protected readonly crop = signal<CropRect>({ x: 0, y: 0, w: 1, h: 1 });
  protected readonly shape = signal('free');
  protected readonly adjust = signal({ brightness: 1, contrast: 1, saturation: 1 });
  protected readonly sharpen = signal(false);
  protected readonly texts = signal<ThumbText[]>([]);
  protected readonly format = signal<ImageFormat>('jpg');
  protected readonly job = new JobTracker(this.api);
  private readonly img = viewChild<ElementRef<HTMLImageElement>>('img');
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  protected readonly w = computed(() => this.source()?.info?.width ?? 16);
  protected readonly h = computed(() => this.source()?.info?.height ?? 9);
  protected readonly ratio = computed(
    () => SHAPES.find((s) => s.id === this.shape())?.ratio ?? null,
  );
  protected readonly outSize = computed(
    () => `${Math.round(this.crop().w * this.w())}×${Math.round(this.crop().h * this.h())}`,
  );

  constructor() {
    effect(() => {
      this.source();
      untracked(() => {
        this.loaded.set(false);
        this.crop.set({ x: 0, y: 0, w: 1, h: 1 });
        this.shape.set('free');
        this.job.reset();
      });
    });
    // Redraw the preview whenever anything changes. sharp's modulate and linear contrast match CSS filters closely.
    effect(() => {
      const el = this.img()?.nativeElement;
      const cv = this.canvas()?.nativeElement;
      if (!el || !cv || !this.loaded()) return;
      const c = this.crop();
      const a = this.adjust();
      const texts = this.texts();
      const sw = c.w * el.naturalWidth;
      const sh = c.h * el.naturalHeight;
      const scale = Math.min(1, 960 / Math.max(sw, sh));
      cv.width = Math.max(1, Math.round(sw * scale));
      cv.height = Math.max(1, Math.round(sh * scale));
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.filter = `brightness(${a.brightness}) contrast(${a.contrast}) saturate(${a.saturation})`;
      ctx.drawImage(
        el,
        c.x * el.naturalWidth,
        c.y * el.naturalHeight,
        sw,
        sh,
        0,
        0,
        cv.width,
        cv.height,
      );
      ctx.filter = 'none';
      for (const t of texts) {
        if (!t.text.trim()) continue;
        const size = Math.round(cv.height * t.size);
        ctx.font = `bold ${size}px ${FONT_FAMILIES[t.font] ?? FONT_FAMILIES['sans']}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(1, Math.round(size * 0.08));
        ctx.strokeStyle = t.stroke;
        ctx.strokeText(t.text, t.x * cv.width, t.y * cv.height);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x * cv.width, t.y * cv.height);
      }
    });
    inject(DestroyRef).onDestroy(() => this.job.cancel());
  }

  protected setShape(id: string): void {
    this.shape.set(id);
    const c = this.crop();
    this.crop.set(centeredCrop(this.ratio(), this.w(), this.h(), c.x + c.w / 2, c.y + c.h / 2));
  }

  protected setAdjust(key: 'brightness' | 'contrast' | 'saturation', v: number): void {
    this.adjust.update((a) => ({ ...a, [key]: v }));
  }

  protected addText(): void {
    this.texts.update((ts) => [
      ...ts,
      {
        text: 'Your title',
        x: 0.5,
        y: ts.length ? 0.8 : 0.2,
        size: 0.12,
        color: '#ffffff',
        stroke: '#000000',
        font: 'sans',
      },
    ]);
  }

  protected patchText(i: number, patch: Partial<ThumbText>): void {
    this.texts.update((ts) => ts.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  }

  protected removeText(i: number): void {
    this.texts.update((ts) => ts.filter((_, k) => k !== i));
  }

  protected save(): void {
    const s = this.source();
    if (!s) return;
    const c = this.crop();
    const full = c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1;
    this.job.run(
      this.api.startTool('thumbnail', {
        fileId: s.id,
        crop: full ? undefined : c,
        ...this.adjust(),
        sharpen: this.sharpen(),
        texts: this.texts()
          .filter((t) => t.text.trim())
          .map((t) => ({ ...t, text: t.text.trim() })),
        format: this.format(),
      }),
    );
  }
}
