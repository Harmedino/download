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
import { ConfigService } from '../../core/config.service';
import { JobTracker } from '../../core/job-tracker';
import type { MediaFile } from '../../core/models';
import type { Cue } from '../../core/subtitles';
import { formatTime } from '../../core/time';
import { CompositionPreview, type PreviewSettings } from '../../shared/composition-preview';
import { JobPanel } from '../../shared/job-panel';
import { MediaSource } from '../../shared/media-source';
import { RangePlayer } from '../../shared/range-player';
import { Spinner } from '../../shared/spinner';
import { ToolHeader, ui } from '../../shared/tool-page';

type Platform = 'shorts' | 'reels' | 'tiktok';
type CropMode = 'manual' | 'auto' | 'blur';

/** Mirrors SHORT_PLATFORMS on the server. */
const PLATFORMS: Array<{ id: Platform; label: string; maxSeconds: number }> = [
  { id: 'shorts', label: 'YouTube Shorts', maxSeconds: 180 },
  { id: 'reels', label: 'Instagram Reels', maxSeconds: 180 },
  { id: 'tiktok', label: 'TikTok', maxSeconds: 600 },
];

@Component({
  selector: 'app-shorts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MediaSource, RangePlayer, CompositionPreview, JobPanel, Spinner, ToolHeader],
  template: `
    <section class="mx-auto max-w-6xl px-4 pt-8 sm:pt-12">
      <app-tool-header
        title="Video to Shorts"
        subtitle="Turn a landscape video into a 9:16 clip for YouTube Shorts, Instagram Reels or TikTok. Pick the section, then frame it by hand or let it follow the subject."
      />
      @if (!source()) {
        <div class="mx-auto mt-8 max-w-2xl">
          <app-media-source [(file)]="source" [fileId]="fileId()" />
        </div>
      } @else {
        @let s = source()!;
        <div class="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div class="min-w-0 space-y-4">
            <app-range-player
              [file]="s"
              [(start)]="start"
              [(end)]="end"
              [(time)]="time"
              (ready)="video.set($event)"
            >
              @if (mode() === 'manual' && cropW() < 0.999) {
                <div
                  #band
                  class="absolute inset-0 touch-none"
                  (pointerdown)="dragBand($event, band)"
                >
                  <div
                    class="absolute inset-y-0 cursor-ew-resize border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
                    [style.left.%]="bandLeft() * 100"
                    [style.width.%]="cropW() * 100"
                    role="slider"
                    aria-label="Crop position. Drag left or right."
                    [attr.aria-valuenow]="centerX()"
                    tabindex="0"
                    (keydown.arrowleft)="nudge(-0.02)"
                    (keydown.arrowright)="nudge(0.02)"
                  ></div>
                </div>
              }
            </app-range-player>
            @if (tooLong()) {
              <p class="text-sm text-amber-700 dark:text-amber-300" role="alert">
                {{ platformInfo().label }} accepts up to
                {{ platformInfo().maxSeconds / 60 }} minutes. Drag the handles to pick a shorter
                section.
              </p>
            }
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
                <legend [class]="ui.label">Platform</legend>
                <div class="flex flex-wrap gap-2" role="radiogroup">
                  @for (p of platforms; track p.id) {
                    <button
                      type="button"
                      role="radio"
                      [attr.aria-checked]="platform() === p.id"
                      (click)="platform.set(p.id)"
                      [class]="ui.chip + ' ' + (platform() === p.id ? ui.chipOn : ui.chipOff)"
                    >
                      {{ p.label }}
                    </button>
                  }
                </div>
              </fieldset>
              <fieldset>
                <legend [class]="ui.label">Framing</legend>
                <div class="grid gap-2">
                  @for (m of modes; track m.id) {
                    <button
                      type="button"
                      role="radio"
                      [attr.aria-checked]="mode() === m.id"
                      (click)="mode.set(m.id)"
                      [class]="ui.chip + ' text-left ' + (mode() === m.id ? ui.chipOn : ui.chipOff)"
                    >
                      <span class="block">{{ m.label }}</span>
                      <span class="block text-xs font-normal text-zinc-500 dark:text-zinc-400">{{
                        m.hint
                      }}</span>
                    </button>
                  }
                </div>
              </fieldset>
              <label class="block">
                <span [class]="ui.label">Caption (optional)</span>
                <input
                  class="h-11 w-full rounded-xl border border-zinc-200 bg-transparent px-3 text-sm dark:border-zinc-700"
                  maxlength="200"
                  placeholder="Shown near the top"
                  [value]="caption()"
                  (input)="caption.set($any($event.target).value)"
                />
              </label>
              @if (config.transcription() && s.info?.hasAudio) {
                <label class="flex items-start gap-2 text-sm">
                  <input type="checkbox" class="mt-1 accent-violet-600" [checked]="withSubs()" (change)="withSubs.set($any($event.target).checked)" />
                  <span>Add subtitles<span class="block text-xs text-zinc-500 dark:text-zinc-400">Generated with speech recognition and burned in, centred. To edit them first, use the Subtitle Generator.</span></span>
                </label>
              }
              <label class="block">
                <span [class]="ui.label">Quality</span>
                <select
                  [class]="ui.select"
                  [value]="height()"
                  (change)="height.set(+$any($event.target).value === 1280 ? 1280 : 1920)"
                >
                  <option value="1920">1080×1920 (Full HD)</option>
                  <option value="1280">720×1280 (smaller file)</option>
                </select>
              </label>
              <button
                type="button"
                [class]="ui.primary"
                [disabled]="job.busy() || subs.busy() || tooLong() || end() <= start()"
                (click)="exportShort()"
              >
                @if (job.busy() || subs.busy()) {
                  <app-spinner />
                }
                Export {{ fmt(end() - start()) }} short
              </button>
            </div>
            <div>
              <p [class]="ui.label">Preview</p>
              <div class="mx-auto max-w-[220px]">
                <app-composition-preview
                  [video]="video()"
                  [settings]="preview()"
                  [time]="time() - start()"
                />
              </div>
              @if (mode() === 'auto') {
                <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  The preview shows the centre crop. When you export, the crop follows the busiest,
                  most detailed area of each moment (usually the person speaking). Use manual
                  framing if it picks the wrong spot.
                </p>
              }
            </div>
          </div>
        </div>
        <div class="mx-auto mt-6 max-w-2xl">
          @if (subs.state() !== 'idle' && subs.state() !== 'done') {
            <app-job-panel [tracker]="subs" [showPreview]="false" (retry)="exportShort()" />
          }
          <app-job-panel [tracker]="job" doneText="Your short is ready." (retry)="exportShort()" />
        </div>
      }
    </section>
  `,
})
export class Shorts {
  private readonly api = inject(ApiService);
  protected readonly config = inject(ConfigService);
  readonly fileId = input<string | undefined>();
  protected readonly ui = ui;
  protected readonly platforms = PLATFORMS;
  protected readonly modes: Array<{ id: CropMode; label: string; hint: string }> = [
    { id: 'manual', label: 'Manual crop', hint: 'Drag the frame on the video.' },
    {
      id: 'auto',
      label: 'Follow the subject',
      hint: 'The crop pans to keep the main subject in view.',
    },
    {
      id: 'blur',
      label: 'Fit whole video',
      hint: 'Keep everything, with a blurred background above and below.',
    },
  ];
  protected readonly source = signal<MediaFile | null>(null);
  protected readonly video = signal<HTMLVideoElement | null>(null);
  protected readonly start = signal(0);
  protected readonly end = signal(0);
  protected readonly time = signal(0);
  protected readonly platform = signal<Platform>('shorts');
  protected readonly mode = signal<CropMode>('manual');
  protected readonly centerX = signal(0.5);
  protected readonly caption = signal('');
  protected readonly height = signal<1920 | 1280>(1920);
  protected readonly withSubs = signal(false);
  protected readonly job = new JobTracker(this.api);
  /** Speech recognition for the optional subtitles, run before the render. */
  protected readonly subs = new JobTracker(this.api);
  /** Cues for the current source, so a re-export doesn't transcribe again. */
  private cues: Cue[] | null = null;
  protected readonly fmt = formatTime;

  protected readonly platformInfo = computed(() =>
    PLATFORMS.find((p) => p.id === this.platform())!,
  );
  protected readonly tooLong = computed(
    () => this.end() - this.start() > this.platformInfo().maxSeconds + 0.05,
  );
  /** Width of the 9:16 window as a fraction of the frame width. */
  protected readonly cropW = computed(() => {
    const i = this.source()?.info;
    return i?.width && i?.height ? Math.min(1, (i.height * 9) / 16 / i.width) : 1;
  });
  protected readonly bandLeft = computed(() =>
    Math.min(1 - this.cropW(), Math.max(0, this.centerX() - this.cropW() / 2)),
  );
  protected readonly preview = computed<PreviewSettings>(() => {
    const blur = this.mode() === 'blur';
    const caption = this.caption().trim();
    return {
      crop: blur
        ? null
        : {
            x: this.mode() === 'auto' ? (1 - this.cropW()) / 2 : this.bandLeft(),
            y: 0,
            w: this.cropW(),
            h: 1,
          },
      rotate: 0,
      flipH: false,
      aspect: 9 / 16,
      fit: blur ? 'blur' : 'fill',
      brightness: 0,
      contrast: 1,
      saturation: 1,
      texts: caption
        ? [
            {
              text: caption,
              x: 0.5,
              y: 0.12,
              size: 0.045,
              color: '#ffffff',
              font: 'sans',
              box: true,
            },
          ]
        : [],
    };
  });

  constructor() {
    effect(() => {
      const s = this.source();
      untracked(() => {
        const d = s?.info?.duration ?? 0;
        this.start.set(0);
        this.end.set(Math.min(d, PLATFORMS.find((p) => p.id === this.platform())!.maxSeconds));
        this.centerX.set(0.5);
        this.video.set(null);
        this.job.reset();
        this.subs.reset();
        this.cues = null;
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.job.cancel();
      this.subs.cancel();
    });
  }

  protected dragBand(ev: PointerEvent, el: HTMLElement): void {
    ev.preventDefault();
    el.setPointerCapture?.(ev.pointerId);
    const box = el.getBoundingClientRect();
    const set = (e: PointerEvent) =>
      this.centerX.set(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)));
    set(ev);
    const up = () => {
      el.removeEventListener('pointermove', set);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', set);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  protected nudge(d: number): void {
    const half = this.cropW() / 2;
    this.centerX.set(Math.min(1 - half, Math.max(half, this.bandLeft() + half + d)));
  }

  protected exportShort(): void {
    const s = this.source();
    if (!s) return;
    if (this.withSubs() && !this.cues) {
      this.job.reset();
      this.subs.run(this.api.startTool('subtitles', { fileId: s.id }), (j) => {
        this.cues = (j.result as { cues?: Cue[] } | null)?.cues ?? [];
        this.exportShort();
      });
      return;
    }
    const cues = this.withSubs() ? (this.cues ?? []).filter((c) => c.end > this.start() && c.start < this.end()) : [];
    const caption = this.caption().trim();
    this.job.run(
      this.api.startTool('shorts', {
        fileId: s.id,
        platform: this.platform(),
        start: this.start(),
        end: this.end(),
        cropMode: this.mode(),
        centerX: this.bandLeft() + this.cropW() / 2,
        height: this.height(),
        texts: caption
          ? [
              {
                text: caption,
                x: 0.5,
                y: 0.12,
                size: 0.045,
                color: '#ffffff',
                font: 'sans',
                box: true,
              },
            ]
          : [],
        subtitles: cues.length ? { cues, style: { position: 'middle', size: 0.04 } } : undefined,
      }),
    );
  }
}
