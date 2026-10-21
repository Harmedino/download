import { ChangeDetectionStrategy, Component, ElementRef, computed, input, model, output, viewChild } from '@angular/core';
import { formatTime, parseTime } from '../core/time';

export interface TimeRange {
  start: number;
  end: number;
}

type Drag = { kind: 'start' } | { kind: 'end' } | { kind: 'cut-start'; index: number } | { kind: 'cut-end'; index: number } | { kind: 'seek' };

/**
 * Trimming timeline: drag the two outer handles to trim, add cut sections to remove from the middle,
 * click anywhere to seek. All times are seconds in the source clip.
 */
@Component({
  selector: 'app-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="select-none">
      <div
        #bar
        class="relative h-14 cursor-pointer touch-none rounded-xl bg-zinc-200 dark:bg-zinc-800"
        (pointerdown)="down($event, { kind: 'seek' })"
        role="slider"
        aria-label="Playback position"
        [attr.aria-valuemin]="0"
        [attr.aria-valuemax]="duration()"
        [attr.aria-valuenow]="current()"
        tabindex="0"
        (keydown.arrowleft)="seek.emit(clampT(current() - 1))"
        (keydown.arrowright)="seek.emit(clampT(current() + 1))"
      >
        <!-- Kept range -->
        <div class="absolute inset-y-0 rounded-lg bg-violet-500/25 ring-2 ring-violet-500" [style.left.%]="pct(start())" [style.width.%]="pct(end()) - pct(start())"></div>
        @if (allowCuts()) {
          @for (c of cuts(); track $index; let i = $index) {
            <div
              class="absolute inset-y-1 rounded ring-1 ring-red-500"
              style="background: repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.55) 0 6px, rgba(239, 68, 68, 0.25) 6px 12px)"
              [style.left.%]="pct(c.start)"
              [style.width.%]="pct(c.end) - pct(c.start)"
              [title]="'Cut ' + (i + 1)"
            >
              <span class="absolute inset-y-0 -left-1.5 w-3 cursor-ew-resize rounded bg-red-500" (pointerdown)="down($event, { kind: 'cut-start', index: i })" aria-hidden="true"></span>
              <span class="absolute inset-y-0 -right-1.5 w-3 cursor-ew-resize rounded bg-red-500" (pointerdown)="down($event, { kind: 'cut-end', index: i })" aria-hidden="true"></span>
            </div>
          }
        }
        <!-- Trim handles -->
        <span
          class="absolute inset-y-0 z-10 -ml-2 flex w-4 cursor-ew-resize items-center justify-center rounded-l-lg bg-violet-600"
          [style.left.%]="pct(start())"
          (pointerdown)="down($event, { kind: 'start' })"
          aria-hidden="true"
          ><span class="h-5 w-0.5 bg-white/80"></span
        ></span>
        <span
          class="absolute inset-y-0 z-10 -ml-2 flex w-4 cursor-ew-resize items-center justify-center rounded-r-lg bg-violet-600"
          [style.left.%]="pct(end())"
          (pointerdown)="down($event, { kind: 'end' })"
          aria-hidden="true"
          ><span class="h-5 w-0.5 bg-white/80"></span
        ></span>
        <!-- Playhead -->
        <span class="pointer-events-none absolute -top-1 -bottom-1 z-20 w-0.5 bg-zinc-900 dark:bg-white" [style.left.%]="pct(current())"></span>
      </div>

      <div class="mt-3 flex flex-wrap items-end gap-3 text-sm">
        <label class="block">
          <span class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Start</span>
          <input class="h-9 w-24 rounded-lg border border-zinc-200 bg-transparent px-2 tabular-nums dark:border-zinc-700" [value]="fmt(start())" (change)="setStart($any($event.target).value)" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">End</span>
          <input class="h-9 w-24 rounded-lg border border-zinc-200 bg-transparent px-2 tabular-nums dark:border-zinc-700" [value]="fmt(end())" (change)="setEnd($any($event.target).value)" />
        </label>
        <button type="button" class="h-9 rounded-lg border border-zinc-300 px-3 font-medium hover:border-violet-500 dark:border-zinc-700" (click)="start.set(clampT(Math.min(current(), end() - 0.1)))">Start here</button>
        <button type="button" class="h-9 rounded-lg border border-zinc-300 px-3 font-medium hover:border-violet-500 dark:border-zinc-700" (click)="end.set(clampT(Math.max(current(), start() + 0.1)))">End here</button>
        @if (allowCuts()) {
          <button type="button" class="h-9 rounded-lg border border-red-400 px-3 font-medium text-red-600 hover:bg-red-500/10 dark:text-red-300" (click)="addCut()">Cut a section</button>
        }
        <span class="ml-auto text-xs text-zinc-500 tabular-nums dark:text-zinc-400">{{ fmt(current()) }} / {{ fmt(duration()) }} · keeps {{ fmt(kept()) }}</span>
      </div>

      @if (allowCuts() && cuts().length) {
        <ul class="mt-3 space-y-2">
          @for (c of cuts(); track $index; let i = $index) {
            <li class="flex flex-wrap items-center gap-2 text-sm">
              <span class="w-14 text-xs font-medium text-red-600 dark:text-red-300">Cut {{ i + 1 }}</span>
              <input class="h-8 w-20 rounded-lg border border-zinc-200 bg-transparent px-2 tabular-nums dark:border-zinc-700" [value]="fmt(c.start)" (change)="setCut(i, 'start', $any($event.target).value)" aria-label="Cut start" />
              <span aria-hidden="true">–</span>
              <input class="h-8 w-20 rounded-lg border border-zinc-200 bg-transparent px-2 tabular-nums dark:border-zinc-700" [value]="fmt(c.end)" (change)="setCut(i, 'end', $any($event.target).value)" aria-label="Cut end" />
              <button type="button" class="rounded-lg px-2 py-1 text-xs text-zinc-500 hover:text-red-600" (click)="removeCut(i)">Remove</button>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class Timeline {
  readonly duration = input.required<number>();
  readonly current = input(0);
  readonly start = model(0);
  readonly end = model(0);
  readonly cuts = model<TimeRange[]>([]);
  readonly allowCuts = input(true);
  readonly seek = output<number>();
  private readonly bar = viewChild.required<ElementRef<HTMLDivElement>>('bar');
  protected readonly Math = Math;
  protected readonly fmt = formatTime;

  protected readonly kept = computed(() => {
    const removed = this.cuts().reduce((n, c) => n + Math.max(0, Math.min(c.end, this.end()) - Math.max(c.start, this.start())), 0);
    return Math.max(0, this.end() - this.start() - removed);
  });

  protected pct(t: number): number {
    const d = this.duration();
    return d > 0 ? (Math.max(0, Math.min(t, d)) / d) * 100 : 0;
  }

  protected clampT(t: number): number {
    return Math.max(0, Math.min(this.duration(), Math.round(t * 100) / 100));
  }

  private timeAt(clientX: number): number {
    const r = this.bar().nativeElement.getBoundingClientRect();
    return this.clampT(((clientX - r.left) / r.width) * this.duration());
  }

  protected down(ev: PointerEvent, drag: Drag): void {
    ev.stopPropagation();
    ev.preventDefault();
    const el = ev.currentTarget as HTMLElement;
    el.setPointerCapture?.(ev.pointerId);
    const move = (e: PointerEvent) => this.apply(drag, this.timeAt(e.clientX));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    this.apply(drag, this.timeAt(ev.clientX));
  }

  private apply(drag: Drag, t: number): void {
    if (drag.kind === 'seek') return this.seek.emit(t);
    if (drag.kind === 'start') {
      this.start.set(Math.min(t, this.end() - 0.1));
      return this.seek.emit(this.start());
    }
    if (drag.kind === 'end') {
      this.end.set(Math.max(t, this.start() + 0.1));
      return this.seek.emit(this.end());
    }
    const cuts = [...this.cuts()];
    const c = { ...cuts[drag.index]! };
    if (drag.kind === 'cut-start') c.start = Math.min(t, c.end - 0.1);
    else c.end = Math.max(t, c.start + 0.1);
    cuts[drag.index] = c;
    this.cuts.set(cuts);
    this.seek.emit(t);
  }

  protected setStart(v: string): void {
    const t = parseTime(v);
    if (t !== null) this.start.set(this.clampT(Math.min(t, this.end() - 0.1)));
  }

  protected setEnd(v: string): void {
    const t = parseTime(v);
    if (t !== null) this.end.set(this.clampT(Math.max(t, this.start() + 0.1)));
  }

  protected addCut(): void {
    const len = Math.min(2, (this.end() - this.start()) / 4);
    const from = Math.max(this.start(), Math.min(this.current(), this.end() - len));
    this.cuts.set([...this.cuts(), { start: this.clampT(from), end: this.clampT(from + len) }]);
  }

  protected setCut(i: number, key: 'start' | 'end', v: string): void {
    const t = parseTime(v);
    if (t === null) return;
    const cuts = [...this.cuts()];
    const c = { ...cuts[i]!, [key]: this.clampT(t) };
    if (c.end - c.start < 0.1) return;
    cuts[i] = c;
    this.cuts.set(cuts);
  }

  protected removeCut(i: number): void {
    this.cuts.set(this.cuts().filter((_, k) => k !== i));
  }
}
