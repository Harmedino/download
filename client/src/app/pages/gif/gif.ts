import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { ApiService } from '../../core/api.service';
import { JobTracker } from '../../core/job-tracker';
import type { MediaFile } from '../../core/models';
import { formatTime } from '../../core/time';
import { CropBox, type CropRect } from '../../shared/crop-box';
import { JobPanel } from '../../shared/job-panel';
import { MediaSource } from '../../shared/media-source';
import { RangePlayer } from '../../shared/range-player';
import { Spinner } from '../../shared/spinner';
import { ToolHeader, ui } from '../../shared/tool-page';

/** Mirrors MAX_SECONDS in the server's GIF tool. */
const MAX_SECONDS = 30;

@Component({
  selector: 'app-gif',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MediaSource, RangePlayer, CropBox, JobPanel, Spinner, ToolHeader],
  template: `
    <section class="mx-auto max-w-6xl px-4 pt-8 sm:pt-12">
      <app-tool-header
        title="GIF maker"
        subtitle="Turn a moment of a video into a looping GIF or animated WebP. Up to 30 seconds."
      />
      @if (!source()) {
        <div class="mx-auto mt-8 max-w-2xl">
          <app-media-source [(file)]="source" [fileId]="fileId()" />
        </div>
      } @else {
        @let s = source()!;
        <div class="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div class="min-w-0 space-y-4">
            <app-range-player [file]="s" [(start)]="start" [(end)]="end">
              @if (cropOn()) {
                <app-crop-box
                  [(rect)]="crop"
                  [frameWidth]="s.info?.width ?? 16"
                  [frameHeight]="s.info?.height ?? 9"
                />
              }
            </app-range-player>
            @if (outSeconds() > maxSeconds + 0.05) {
              <p class="text-sm text-amber-700 dark:text-amber-300" role="alert">
                GIFs are limited to {{ maxSeconds }} seconds; only the first
                {{ maxSeconds }} seconds of the animation will be used. Drag the end handle to
                choose.
              </p>
            }
          </div>
          <div [class]="ui.card + ' self-start'">
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
              <legend [class]="ui.label">Format</legend>
              <div class="flex flex-wrap gap-2" role="radiogroup">
                @for (f of formatsList; track f.id) {
                  <button
                    type="button"
                    role="radio"
                    [attr.aria-checked]="format() === f.id"
                    (click)="format.set(f.id)"
                    [class]="ui.chip + ' ' + (format() === f.id ? ui.chipOn : ui.chipOff)"
                  >
                    {{ f.label }}
                  </button>
                }
              </div>
            </fieldset>
            <div class="grid grid-cols-2 gap-3">
              <label class="block">
                <span [class]="ui.label">Width</span>
                <select
                  [class]="ui.select"
                  [value]="width()"
                  (change)="width.set(+$any($event.target).value)"
                >
                  @for (w of [240, 320, 480, 640, 800, 1080]; track w) {
                    <option [value]="w">{{ w }}px</option>
                  }
                </select>
              </label>
              <label class="block">
                <span [class]="ui.label">Frame rate</span>
                <select
                  [class]="ui.select"
                  [value]="fps()"
                  (change)="fps.set(+$any($event.target).value)"
                >
                  @for (f of [8, 10, 12, 15, 20, 25, 30]; track f) {
                    <option [value]="f">{{ f }} fps</option>
                  }
                </select>
              </label>
            </div>
            <label class="block">
              <span class="mb-1 flex justify-between text-sm font-medium"
                >Speed <span class="text-zinc-500 tabular-nums">{{ speed() }}×</span></span
              >
              <input
                type="range"
                class="w-full accent-violet-600"
                min="0.25"
                max="4"
                step="0.25"
                [value]="speed()"
                (input)="speed.set(+$any($event.target).value)"
              />
            </label>
            <label class="flex items-center gap-2 text-sm"
              ><input
                type="checkbox"
                class="accent-violet-600"
                [checked]="cropOn()"
                (change)="cropOn.set($any($event.target).checked)"
              />
              Crop</label
            >
            <p class="text-xs text-zinc-500 dark:text-zinc-400">
              {{ fmt(Math.min(outSeconds(), maxSeconds)) }} animation. Smaller widths and frame
              rates make much smaller files.
            </p>
            <button
              type="button"
              [class]="ui.primary"
              [disabled]="job.busy() || end() <= start()"
              (click)="make()"
            >
              @if (job.busy()) {
                <app-spinner />
              }
              Make {{ format() === 'gif' ? 'GIF' : 'WebP' }}
            </button>
          </div>
        </div>
        <div class="mx-auto mt-6 max-w-2xl space-y-3">
          <app-job-panel
            [tracker]="job"
            doneText="Your animation is ready."
            [showPreview]="false"
            (retry)="make()"
          />
          @if (job.state() === 'done' && job.job()?.files?.[0]; as f) {
            <img
              [src]="api.fileUrl(f.url, true)"
              alt="Your animation"
              class="mx-auto max-h-[50vh] rounded-xl"
            />
          }
        </div>
      }
    </section>
  `,
})
export class Gif {
  protected readonly api = inject(ApiService);
  readonly fileId = input<string | undefined>();
  protected readonly ui = ui;
  protected readonly Math = Math;
  protected readonly maxSeconds = MAX_SECONDS;
  protected readonly formatsList = [
    { id: 'gif' as const, label: 'GIF' },
    { id: 'webp' as const, label: 'Animated WebP' },
  ];
  protected readonly source = signal<MediaFile | null>(null);
  protected readonly start = signal(0);
  protected readonly end = signal(0);
  protected readonly format = signal<'gif' | 'webp'>('gif');
  protected readonly width = signal(480);
  protected readonly fps = signal(12);
  protected readonly speed = signal(1);
  protected readonly cropOn = signal(false);
  protected readonly crop = signal<CropRect>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  protected readonly job = new JobTracker(this.api);
  protected readonly fmt = formatTime;
  protected readonly outSeconds = computed(() => (this.end() - this.start()) / this.speed());

  constructor() {
    effect(() => {
      const s = this.source();
      untracked(() => {
        const d = s?.info?.duration ?? 0;
        this.start.set(0);
        this.end.set(Math.min(d, 5));
        this.job.reset();
      });
    });
    inject(DestroyRef).onDestroy(() => this.job.cancel());
  }

  protected make(): void {
    const s = this.source();
    if (!s) return;
    this.job.run(
      this.api.startTool('gif', {
        fileId: s.id,
        start: this.start(),
        end: this.end(),
        fps: this.fps(),
        width: this.width(),
        speed: this.speed(),
        crop: this.cropOn() ? this.crop() : undefined,
        format: this.format(),
      }),
    );
  }
}
