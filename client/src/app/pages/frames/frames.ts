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
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { JobTracker } from '../../core/job-tracker';
import type { MediaFile } from '../../core/models';
import { formatTime } from '../../core/time';
import { JobPanel } from '../../shared/job-panel';
import { MediaSource } from '../../shared/media-source';
import { RangePlayer } from '../../shared/range-player';
import { Spinner } from '../../shared/spinner';
import { ToolHeader, ui } from '../../shared/tool-page';

type Mode = 'single' | 'interval' | 'contact';
type ImageFormat = 'jpg' | 'png' | 'webp';

@Component({
  selector: 'app-frames',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MediaSource, RangePlayer, JobPanel, Spinner, ToolHeader, RouterLink],
  template: `
    <section class="mx-auto max-w-6xl px-4 pt-8 sm:pt-12">
      <app-tool-header
        title="Frame extractor"
        subtitle="Save still frames at full resolution, grab a frame every few seconds, or build a contact sheet. Turn any frame into a thumbnail."
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
              #rangePlayer
              [file]="s"
              [(start)]="start"
              [(end)]="end"
              [(time)]="time"
              [showRange]="mode() !== 'single'"
            />
            @if (mode() === 'single') {
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
                  [disabled]="times().length >= 20"
                  (click)="addTime()"
                >
                  Add frame at {{ fmt(time()) }}
                </button>
                @for (t of times(); track t) {
                  <span
                    class="inline-flex items-center gap-1 rounded-full bg-violet-500/10 py-1 pr-1 pl-3 text-sm text-violet-700 tabular-nums dark:text-violet-200"
                  >
                    <button
                      type="button"
                      class="underline-offset-2 hover:underline"
                      (click)="player()?.seekTo(t)"
                    >
                      {{ fmt(t) }}
                    </button>
                    <button
                      type="button"
                      class="rounded-full px-1.5 hover:bg-violet-500/20"
                      (click)="removeTime(t)"
                      [attr.aria-label]="'Remove frame at ' + fmt(t)"
                    >
                      ×
                    </button>
                  </span>
                }
              </div>
              <p class="text-xs text-zinc-500 dark:text-zinc-400">
                Play or click the timeline to find a moment, then add it. Use the arrow keys on the
                timeline to step through.
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
                <legend [class]="ui.label">What to extract</legend>
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
              @if (mode() === 'interval') {
                <label class="block">
                  <span [class]="ui.label">One frame every</span>
                  <select
                    [class]="ui.select"
                    [value]="every()"
                    (change)="every.set(+$any($event.target).value)"
                  >
                    @for (e of intervals; track e) {
                      <option [value]="e" [selected]="e === every()">{{ e }} second{{ e === 1 ? '' : 's' }}</option>
                    }
                  </select>
                </label>
                <p class="text-xs text-zinc-500 dark:text-zinc-400">
                  ≈ {{ intervalCount() }} frame{{ intervalCount() === 1 ? '' : 's' }} from the
                  selected range (up to 100), plus a ZIP of all of them.
                </p>
              }
              @if (mode() === 'contact') {
                <div class="grid grid-cols-2 gap-3">
                  <label class="block">
                    <span [class]="ui.label">Columns</span>
                    <select
                      [class]="ui.select"
                      [value]="columns()"
                      (change)="columns.set(+$any($event.target).value)"
                    >
                      @for (n of [2, 3, 4, 5, 6, 8]; track n) {
                        <option [value]="n" [selected]="n === columns()">{{ n }}</option>
                      }
                    </select>
                  </label>
                  <label class="block">
                    <span [class]="ui.label">Rows</span>
                    <select
                      [class]="ui.select"
                      [value]="rows()"
                      (change)="rows.set(+$any($event.target).value)"
                    >
                      @for (n of [1, 2, 3, 4, 5, 6, 8, 10]; track n) {
                        <option [value]="n" [selected]="n === rows()">{{ n }}</option>
                      }
                    </select>
                  </label>
                </div>
                <p class="text-xs text-zinc-500 dark:text-zinc-400">
                  {{ columns() * rows() }} evenly spaced frames from the selected range, in one
                  image.
                </p>
              }
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
              @if (mode() !== 'contact' && s.info?.width) {
                <p class="text-xs text-zinc-500 dark:text-zinc-400">
                  Frames keep the original {{ s.info!.width }}×{{ s.info!.height }} resolution.
                </p>
              }
              <button
                type="button"
                [class]="ui.primary"
                [disabled]="job.busy() || !canStart()"
                (click)="extract()"
              >
                @if (job.busy()) {
                  <app-spinner />
                }
                {{
                  mode() === 'single'
                    ? 'Extract ' +
                      (times().length || '') +
                      ' frame' +
                      (times().length === 1 ? '' : 's')
                    : mode() === 'interval'
                      ? 'Extract frames'
                      : 'Build contact sheet'
                }}
              </button>
            </div>
          </div>
        </div>
        <div class="mx-auto mt-6 max-w-2xl space-y-3">
          <app-job-panel [tracker]="job" doneText="Your frames are ready." (retry)="extract()" />
          @if (images().length) {
            <div [class]="ui.card">
              <p class="text-sm font-medium">Make a thumbnail</p>
              <p class="text-xs text-zinc-500 dark:text-zinc-400">
                Open a frame in the thumbnail editor to crop it, enhance it and add text.
              </p>
              <div class="flex flex-wrap gap-2">
                @for (f of images(); track f.id) {
                  <a
                    [routerLink]="'/thumbnail'"
                    [queryParams]="{ fileId: f.id }"
                    class="group relative block w-28 overflow-hidden rounded-xl ring-1 ring-zinc-200 hover:ring-violet-500 dark:ring-zinc-700"
                  >
                    <img
                      [src]="api.fileUrl(f.url, true)"
                      [alt]="'Edit ' + f.name"
                      class="aspect-video w-full object-cover"
                      loading="lazy"
                    />
                    <span class="block truncate px-2 py-1 text-xs">Edit</span>
                  </a>
                }
              </div>
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class Frames {
  protected readonly api = inject(ApiService);
  readonly fileId = input<string | undefined>();
  protected readonly ui = ui;
  protected readonly modes: Array<{ id: Mode; label: string; hint: string }> = [
    { id: 'single', label: 'Pick frames', hint: 'Choose exact moments on the timeline.' },
    { id: 'interval', label: 'Every few seconds', hint: 'Evenly spaced frames from a range.' },
    { id: 'contact', label: 'Contact sheet', hint: 'A grid of frames in one image.' },
  ];
  protected readonly formats: ImageFormat[] = ['jpg', 'png', 'webp'];
  protected readonly intervals = [0.5, 1, 2, 5, 10, 30, 60];
  protected readonly player = viewChild<RangePlayer>('rangePlayer');
  protected readonly source = signal<MediaFile | null>(null);
  protected readonly start = signal(0);
  protected readonly end = signal(0);
  protected readonly time = signal(0);
  protected readonly mode = signal<Mode>('single');
  protected readonly times = signal<number[]>([]);
  protected readonly every = signal(5);
  protected readonly columns = signal(4);
  protected readonly rows = signal(4);
  protected readonly format = signal<ImageFormat>('jpg');
  protected readonly job = new JobTracker(this.api);
  protected readonly fmt = formatTime;
  protected readonly intervalCount = computed(() =>
    Math.min(100, Math.floor((this.end() - this.start()) / this.every()) + 1),
  );
  protected readonly canStart = computed(() =>
    this.mode() === 'single' ? this.times().length > 0 : this.end() > this.start(),
  );
  /** Single frames the thumbnail editor can open (not the ZIP or a contact sheet). */
  protected readonly images = computed(() => {
    const j = this.job.job();
    if (this.job.state() !== 'done' || !j) return [];
    return j.files
      .filter((f) => f.mimeType.startsWith('image/') && !/contact_sheet/.test(f.name))
      .slice(0, 20);
  });

  constructor() {
    effect(() => {
      const s = this.source();
      untracked(() => {
        this.start.set(0);
        this.end.set(s?.info?.duration ?? 0);
        this.times.set([]);
        this.job.reset();
      });
    });
    inject(DestroyRef).onDestroy(() => this.job.cancel());
  }

  protected addTime(): void {
    const t = Math.round(this.time() * 100) / 100;
    this.times.update((ts) => (ts.includes(t) ? ts : [...ts, t].sort((a, b) => a - b)));
  }

  protected removeTime(t: number): void {
    this.times.update((ts) => ts.filter((x) => x !== t));
  }

  protected extract(): void {
    const s = this.source();
    if (!s || !this.canStart()) return;
    const base = { fileId: s.id, format: this.format() };
    const body =
      this.mode() === 'single'
        ? { ...base, mode: 'single', times: this.times() }
        : this.mode() === 'interval'
          ? {
              ...base,
              mode: 'interval',
              start: this.start(),
              end: this.end(),
              every: this.every(),
              max: 100,
            }
          : {
              ...base,
              mode: 'contact',
              start: this.start(),
              end: this.end(),
              columns: this.columns(),
              rows: this.rows(),
            };
    this.job.run(this.api.startTool('frames', body));
  }
}
