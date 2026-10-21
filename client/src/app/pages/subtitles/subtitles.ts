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
  viewChild,
} from '@angular/core';
import { ApiService } from '../../core/api.service';
import { ConfigService } from '../../core/config.service';
import { JobTracker } from '../../core/job-tracker';
import type { MediaFile } from '../../core/models';
import {
  LANGUAGES,
  cueAt,
  downloadText,
  parseSubtitles,
  toSrt,
  toVtt,
  type Cue,
} from '../../core/subtitles';
import { formatTime, parseTime } from '../../core/time';
import { FONT_FAMILIES } from '../../shared/composition-preview';
import { JobPanel } from '../../shared/job-panel';
import { MediaSource } from '../../shared/media-source';
import { RangePlayer } from '../../shared/range-player';
import { Spinner } from '../../shared/spinner';
import { ToolHeader, ui } from '../../shared/tool-page';

export interface SubtitleStyle {
  font: string;
  size: number;
  color: string;
  outline: string;
  position: 'bottom' | 'middle' | 'top';
  margin: number;
  box: boolean;
  bold: boolean;
}

export const DEFAULT_STYLE: SubtitleStyle = {
  font: 'sans',
  size: 0.05,
  color: '#ffffff',
  outline: '#000000',
  position: 'bottom',
  margin: 0.06,
  box: false,
  bold: true,
};

@Component({
  selector: 'app-subtitles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MediaSource, RangePlayer, JobPanel, Spinner, ToolHeader],
  templateUrl: './subtitles.html',
})
export class Subtitles {
  protected readonly api = inject(ApiService);
  protected readonly config = inject(ConfigService);
  readonly fileId = input<string | undefined>();
  protected readonly ui = ui;
  protected readonly languages = LANGUAGES;
  protected readonly fonts = [
    { id: 'sans', label: 'Sans' },
    { id: 'serif', label: 'Serif' },
    { id: 'mono', label: 'Mono' },
    { id: 'arial', label: 'Arial-style' },
    { id: 'times', label: 'Times-style' },
  ];
  protected readonly positions: Array<{ id: SubtitleStyle['position']; label: string }> = [
    { id: 'top', label: 'Top' },
    { id: 'middle', label: 'Middle' },
    { id: 'bottom', label: 'Bottom' },
  ];
  protected readonly fmt = formatTime;
  private readonly rangePlayer = viewChild<RangePlayer>('rangePlayer');

  protected readonly source = signal<MediaFile | null>(null);
  protected readonly time = signal(0);
  protected readonly language = signal('auto');
  protected readonly cues = signal<Cue[]>([]);
  protected readonly detected = signal<string | null>(null);
  protected readonly importError = signal<string | null>(null);
  protected readonly style = signal<SubtitleStyle>({ ...DEFAULT_STYLE });
  protected readonly format = signal<'mp4' | 'webm'>('mp4');
  protected readonly generate = new JobTracker(this.api);
  protected readonly burn = new JobTracker(this.api);

  protected readonly active = computed(() => cueAt(this.cues(), this.time()));
  protected readonly overlayStyle = computed(() => {
    const s = this.style();
    const o = s.outline;
    const shadow = s.box
      ? 'none'
      : [
          `-1px -1px 0 ${o}`,
          `1px -1px 0 ${o}`,
          `-1px 1px 0 ${o}`,
          `1px 1px 0 ${o}`,
          `0 0 3px ${o}`,
        ].join(',');
    return {
      'font-family': FONT_FAMILIES[s.font] ?? FONT_FAMILIES['sans'],
      'font-size': `${s.size * 100}cqh`,
      'font-weight': s.bold ? '700' : '400',
      color: s.color,
      'text-shadow': shadow,
      background: s.box ? 'rgba(0,0,0,0.6)' : 'transparent',
    };
  });
  protected readonly baseName = computed(() =>
    (this.source()?.name ?? 'subtitles').replace(/\.[^.]{1,6}$/, ''),
  );

  constructor() {
    effect(() => {
      this.source();
      untracked(() => {
        this.cues.set([]);
        this.detected.set(null);
        this.generate.reset();
        this.burn.reset();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.generate.cancel();
      this.burn.cancel();
    });
  }

  protected start(): void {
    const s = this.source();
    if (!s) return;
    this.generate.run(
      this.api.startTool('subtitles', { fileId: s.id, language: this.language() }),
      (job) => {
        const r = job.result as { cues?: Cue[]; language?: string | null } | null;
        this.cues.set(r?.cues ?? []);
        this.detected.set(r?.language ?? null);
      },
    );
  }

  protected async importFile(ev: Event): Promise<void> {
    const el = ev.target as HTMLInputElement;
    const f = el.files?.[0];
    el.value = '';
    if (!f) return;
    this.importError.set(null);
    if (f.size > 2 * 1024 * 1024)
      return this.importError.set('That file is too large for a subtitle file.');
    const cues = parseSubtitles(await f.text());
    if (!cues.length)
      return this.importError.set('No subtitles found. Please choose an .srt or .vtt file.');
    this.cues.set(cues);
  }

  protected patch(i: number, p: Partial<Cue>): void {
    this.cues.update((cs) => cs.map((c, k) => (k === i ? { ...c, ...p } : c)));
  }

  protected setTime(i: number, key: 'start' | 'end', value: string): void {
    const t = parseTime(value);
    const c = this.cues()[i];
    if (t === null || !c) return;
    const next = { ...c, [key]: t };
    if (next.end <= next.start) return;
    this.patch(i, { [key]: t });
    if (key === 'start') this.cues.update((cs) => [...cs].sort((a, b) => a.start - b.start));
  }

  protected setToPlayhead(i: number, key: 'start' | 'end'): void {
    this.setTime(i, key, String(Math.round(this.time() * 1000) / 1000));
  }

  protected remove(i: number): void {
    this.cues.update((cs) => cs.filter((_, k) => k !== i));
  }

  /** Adds a 2-second cue at the playhead (or after the last one). */
  protected addCue(): void {
    const d = this.source()?.info?.duration ?? 0;
    const start = Math.min(this.time(), Math.max(0, d - 0.5));
    const cue = { start, end: Math.min(d || start + 2, start + 2), text: 'New subtitle' };
    this.cues.update((cs) => [...cs, cue].sort((a, b) => a.start - b.start));
  }

  protected seek(t: number): void {
    this.rangePlayer()?.seekTo(t + 0.01);
  }

  protected setStyle(p: Partial<SubtitleStyle>): void {
    this.style.update((s) => ({ ...s, ...p }));
  }

  protected cleanCues(): Cue[] {
    return this.cues()
      .map((c) => ({ ...c, text: c.text.trim() }))
      .filter((c) => c.text && c.end > c.start);
  }

  protected exportSrt(): void {
    downloadText(toSrt(this.cleanCues()), `${this.baseName()}.srt`, 'application/x-subrip');
  }

  protected exportVtt(): void {
    downloadText(toVtt(this.cleanCues()), `${this.baseName()}.vtt`, 'text/vtt');
  }

  protected burnIn(): void {
    const s = this.source();
    const cues = this.cleanCues();
    if (!s || !cues.length) return;
    this.burn.run(
      this.api.startTool('burn-subtitles', {
        fileId: s.id,
        cues,
        style: this.style(),
        format: this.format(),
      }),
    );
  }
}
