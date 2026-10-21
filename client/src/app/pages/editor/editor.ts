import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { formatTime } from '../../core/time';
import { JobTracker } from '../../core/job-tracker';
import type { MediaFile } from '../../core/models';
import { CompositionPreview, type PreviewSettings, type PreviewText } from '../../shared/composition-preview';
import { CropBox, type CropRect, centeredCrop } from '../../shared/crop-box';
import { JobPanel } from '../../shared/job-panel';
import { MediaSource } from '../../shared/media-source';
import { Spinner } from '../../shared/spinner';
import { Timeline, type TimeRange } from '../../shared/timeline';
import { ToolHeader, ui } from '../../shared/tool-page';

export interface Clip {
  file: MediaFile;
  start: number;
  end: number;
  cuts: TimeRange[];
}

export type Aspect = 'original' | '16:9' | '9:16' | '1:1' | '4:5';
export const ASPECT_RATIOS: Record<Aspect, number | null> = { original: null, '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };
export const ASPECT_OPTIONS: Array<{ id: Aspect; label: string; hint: string }> = [
  { id: 'original', label: 'Original', hint: 'Keep shape' },
  { id: '16:9', label: '16:9', hint: 'YouTube' },
  { id: '9:16', label: '9:16', hint: 'Shorts, Reels, TikTok' },
  { id: '1:1', label: '1:1', hint: 'Square' },
  { id: '4:5', label: '4:5', hint: 'Portrait' },
];

/** Seconds of a clip that survive trimming and cuts. */
export function keptDuration(c: Pick<Clip, 'start' | 'end' | 'cuts'>, upTo = c.end): number {
  const end = Math.min(upTo, c.end);
  const removed = c.cuts.reduce((n, x) => n + Math.max(0, Math.min(x.end, end) - Math.max(x.start, c.start)), 0);
  return Math.max(0, end - c.start - removed);
}

type Panel = 'frame' | 'adjust' | 'text' | 'clips' | 'export';

@Component({
  selector: 'app-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MediaSource, Timeline, CropBox, CompositionPreview, JobPanel, Spinner, ToolHeader],
  templateUrl: './editor.html',
})
export class Editor {
  protected readonly api = inject(ApiService);
  readonly fileId = input<string | undefined>();
  protected readonly ui = ui;
  protected readonly fmt = formatTime;
  protected readonly aspects = ASPECT_OPTIONS;
  protected readonly fonts = [
    { id: 'sans', label: 'Sans' },
    { id: 'serif', label: 'Serif' },
    { id: 'mono', label: 'Mono' },
    { id: 'arial', label: 'Arial-style' },
    { id: 'times', label: 'Times-style' },
  ];
  protected readonly transitions = [
    { id: 'none', label: 'Cut' },
    { id: 'fade', label: 'Crossfade' },
    { id: 'fadeblack', label: 'Fade through black' },
    { id: 'dissolve', label: 'Dissolve' },
    { id: 'wipeleft', label: 'Wipe' },
    { id: 'slideleft', label: 'Slide' },
    { id: 'circleopen', label: 'Circle' },
  ];
  protected readonly panels: Array<{ id: Panel; label: string }> = [
    { id: 'frame', label: 'Frame' },
    { id: 'adjust', label: 'Adjust' },
    { id: 'text', label: 'Text' },
    { id: 'clips', label: 'Clips' },
    { id: 'export', label: 'Export' },
  ];

  // ---- media ------------------------------------------------------------
  protected readonly firstSource = signal<MediaFile | null>(null);
  protected readonly addSource = signal<MediaFile | null>(null);
  protected readonly adding = signal(false);
  protected readonly clips = signal<Clip[]>([]);
  protected readonly sel = signal(0);
  protected readonly clip = computed(() => this.clips()[this.sel()] ?? null);
  protected readonly panel = signal<Panel>('frame');

  private readonly playerRef = viewChild<ElementRef<HTMLVideoElement>>('playerEl');
  protected readonly player = computed(() => this.playerRef()?.nativeElement ?? null);
  protected readonly currentTime = signal(0);
  protected readonly playing = signal(false);

  // ---- settings ---------------------------------------------------------
  protected readonly aspect = signal<Aspect>('original');
  protected readonly cropOn = signal(false);
  protected readonly crop = signal<CropRect>({ x: 0, y: 0, w: 1, h: 1 });
  protected readonly fit = signal<'fill' | 'blur' | 'black'>('fill');
  protected readonly rotate = signal<0 | 90 | 180 | 270>(0);
  protected readonly flipH = signal(false);
  protected readonly resolution = signal(0);
  protected readonly speed = signal(1);
  protected readonly brightness = signal(0);
  protected readonly contrast = signal(1);
  protected readonly saturation = signal(1);
  protected readonly fadeIn = signal(0);
  protected readonly fadeOut = signal(0);
  protected readonly texts = signal<PreviewText[]>([]);
  protected readonly transition = signal('none');
  protected readonly transitionDuration = signal(0.5);
  protected readonly mute = signal(false);
  protected readonly format = signal<'mp4' | 'webm' | 'mov' | 'mkv'>('mp4');
  protected readonly job = new JobTracker(this.api);

  protected readonly frameW = computed(() => this.clips()[0]?.file.info?.width ?? 16);
  protected readonly frameH = computed(() => this.clips()[0]?.file.info?.height ?? 9);
  /** Ratio the crop box keeps, in source pixels (an output 9:16 on a rotated video is a 16:9 crop). */
  protected readonly cropRatio = computed(() => {
    const r = ASPECT_RATIOS[this.aspect()];
    if (!r) return null;
    return this.rotate() % 180 === 90 ? 1 / r : r;
  });

  protected readonly totalDuration = computed(() => {
    const cs = this.clips();
    const kept = cs.reduce((n, c) => n + keptDuration(c), 0);
    const td = cs.length > 1 && this.transition() !== 'none' ? this.transitionDuration() * (cs.length - 1) : 0;
    return Math.max(0, kept - td) / this.speed();
  });

  /** Where the playhead lands on the exported video, so text previews appear at the right time. */
  protected readonly outputTime = computed(() => {
    const cs = this.clips();
    const i = this.sel();
    const td = this.transition() !== 'none' ? this.transitionDuration() : 0;
    let t = 0;
    for (let k = 0; k < i; k++) t += keptDuration(cs[k]!) - td;
    const c = cs[i];
    if (c) t += keptDuration(c, this.currentTime());
    return Math.max(0, t) / this.speed();
  });

  protected readonly previewSettings = computed<PreviewSettings>(() => ({
    crop: this.cropOn() ? this.crop() : null,
    rotate: this.rotate(),
    flipH: this.flipH(),
    aspect: ASPECT_RATIOS[this.aspect()],
    fit: this.fit(),
    brightness: this.brightness(),
    contrast: this.contrast(),
    saturation: this.saturation(),
    texts: this.texts(),
  }));

  constructor() {
    effect(() => {
      const f = this.firstSource();
      if (f && untracked(() => !this.clips().length)) untracked(() => this.addClip(f));
    });
    effect(() => {
      const f = this.addSource();
      if (!f) return;
      untracked(() => {
        this.addClip(f);
        this.addSource.set(null);
        this.adding.set(false);
        this.sel.set(this.clips().length - 1);
      });
    });
    // Keep the crop box in the right shape when the aspect or rotation changes.
    effect(() => {
      const ratio = this.cropRatio();
      const on = this.cropOn();
      const w = this.frameW();
      const h = this.frameH();
      if (on) untracked(() => this.crop.set(centeredCrop(ratio, w, h)));
    });
    // Smooth playhead and trim-aware playback while playing.
    let raf = 0;
    const tick = () => {
      const v = this.player();
      const c = this.clip();
      if (v && c) {
        let t = v.currentTime;
        if (!v.paused) {
          const cut = c.cuts.find((x) => t >= x.start && t < x.end - 0.05);
          if (cut) v.currentTime = t = cut.end;
          if (t >= c.end) {
            v.pause();
            v.currentTime = t = c.end;
          }
        }
        if (Math.abs(t - this.currentTime()) > 0.01) this.currentTime.set(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      cancelAnimationFrame(raf);
      this.job.cancel();
    });
  }

  private addClip(file: MediaFile): void {
    const d = file.info?.duration ?? 0;
    this.clips.update((cs) => [...cs, { file, start: 0, end: d, cuts: [] }]);
  }

  protected updateClip(patch: Partial<Clip>): void {
    const i = this.sel();
    this.clips.update((cs) => cs.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  }

  protected moveClip(i: number, dir: -1 | 1): void {
    const j = i + dir;
    this.clips.update((cs) => {
      if (j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
    if (this.sel() === i) this.sel.set(j);
  }

  protected removeClip(i: number): void {
    this.clips.update((cs) => cs.filter((_, k) => k !== i));
    this.sel.set(Math.max(0, Math.min(this.sel(), this.clips().length - 1)));
    if (!this.clips().length) this.firstSource.set(null);
  }

  protected selectClip(i: number): void {
    this.sel.set(i);
    this.currentTime.set(this.clips()[i]?.start ?? 0);
  }

  protected onLoaded(): void {
    const v = this.player();
    const c = this.clip();
    if (v && c && (v.currentTime < c.start || v.currentTime > c.end)) v.currentTime = c.start;
  }

  protected seekTo(t: number): void {
    const v = this.player();
    if (v) v.currentTime = t;
    this.currentTime.set(t);
  }

  protected togglePlay(): void {
    const v = this.player();
    const c = this.clip();
    if (!v || !c) return;
    if (v.paused) {
      if (v.currentTime >= c.end - 0.05 || v.currentTime < c.start) v.currentTime = c.start;
      void v.play();
    } else v.pause();
  }

  protected setAspect(a: Aspect): void {
    this.aspect.set(a);
    // Choosing a new shape on a landscape source usually means "frame it": show the crop box.
    if (a !== 'original' && this.fit() === 'fill') this.cropOn.set(true);
  }

  protected rotateBy(deg: 90 | -90): void {
    this.rotate.set((((this.rotate() + deg) % 360) + 360) % 360 as 0 | 90 | 180 | 270);
  }

  protected resetAdjust(): void {
    this.speed.set(1);
    this.brightness.set(0);
    this.contrast.set(1);
    this.saturation.set(1);
    this.fadeIn.set(0);
    this.fadeOut.set(0);
  }

  protected addText(): void {
    const now = this.outputTime();
    this.texts.update((t) => [
      ...t,
      { text: 'Your text', x: 0.5, y: 0.85, size: 0.07, color: '#ffffff', font: 'sans', box: false, start: Math.round(now * 10) / 10, end: Math.round(Math.min(this.totalDuration(), now + 3) * 10) / 10 },
    ]);
    this.panel.set('text');
  }

  protected updateText(i: number, patch: Partial<PreviewText>): void {
    this.texts.update((list) => list.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  }

  protected removeText(i: number): void {
    this.texts.update((list) => list.filter((_, k) => k !== i));
  }

  protected num(ev: Event): number {
    return +(ev.target as HTMLInputElement).value;
  }

  protected body(): Record<string, unknown> {
    return {
      clips: this.clips().map((c) => ({ fileId: c.file.id, start: c.start, end: c.end, cuts: c.cuts })),
      crop: this.cropOn() ? this.crop() : undefined,
      aspect: this.aspect(),
      fit: this.fit(),
      resolution: this.resolution() || undefined,
      rotate: this.rotate(),
      flipH: this.flipH(),
      speed: this.speed(),
      brightness: this.brightness(),
      contrast: this.contrast(),
      saturation: this.saturation(),
      texts: this.texts()
        .filter((t) => t.text.trim())
        .map((t) => ({ ...t, text: t.text.trim() })),
      transition: this.clips().length > 1 ? this.transition() : 'none',
      transitionDuration: this.transitionDuration(),
      fadeIn: this.fadeIn(),
      fadeOut: this.fadeOut(),
      mute: this.mute(),
      format: this.format(),
    };
  }

  protected exportVideo(): void {
    if (!this.clips().length) return;
    this.job.run(this.api.startTool('edit', this.body()));
  }
}
