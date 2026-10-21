import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ApiService } from '../core/api.service';
import { formatTime } from '../core/time';
import type { MediaFile } from '../core/models';
import { Timeline } from './timeline';

/**
 * A video player with a play button and a range timeline, for tools that work on one section of one
 * video (shorts, GIFs, frames). Playback stays inside the range. Overlays (a crop box, a marker) go
 * in the projected content, which sits over the video at its exact aspect ratio.
 */
@Component({
  selector: 'app-range-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Timeline],
  template: `
    @let f = file();
    <div class="space-y-4">
      <div class="flex justify-center rounded-3xl bg-zinc-950 p-2">
        <div
          class="relative max-h-[55vh] max-w-full"
          [style.aspect-ratio]="(f.info?.width ?? 16) + ' / ' + (f.info?.height ?? 9)"
        >
          <video
            #videoEl
            [src]="api.fileUrl(f.url, true)"
            crossorigin="anonymous"
            playsinline
            preload="auto"
            class="block h-full max-h-[55vh] w-full rounded-xl"
            (loadedmetadata)="ready.emit(videoEl)"
            (play)="playing.set(true)"
            (pause)="playing.set(false)"
            (click)="toggle()"
          ></video>
          <ng-content />
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          (click)="toggle()"
          class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
          [attr.aria-label]="playing() ? 'Pause' : 'Play'"
        >
          @if (playing()) {
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="currentColor" aria-hidden="true">
              <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
            </svg>
          } @else {
            <svg viewBox="0 0 24 24" class="ml-0.5 h-5 w-5" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          }
        </button>
        <span class="text-sm text-zinc-500 tabular-nums dark:text-zinc-400">{{ fmt(time()) }}</span>
        @if (showRange()) {
          <span class="ml-auto text-xs text-zinc-500 tabular-nums dark:text-zinc-400"
            >Selected {{ fmt(end() - start()) }}</span
          >
        }
      </div>
      @if (showRange()) {
        <app-timeline
          [duration]="duration()"
          [current]="time()"
          [(start)]="start"
          [(end)]="end"
          [allowCuts]="false"
          (seek)="seekTo($event)"
        />
      } @else {
        <app-timeline
          [duration]="duration()"
          [current]="time()"
          [start]="0"
          [end]="duration()"
          [allowCuts]="false"
          [seekOnly]="true"
          (seek)="seekTo($event)"
        />
      }
    </div>
  `,
})
export class RangePlayer {
  protected readonly api = inject(ApiService);
  readonly file = input.required<MediaFile>();
  readonly start = model(0);
  readonly end = model(0);
  /** false: the timeline only seeks (e.g. picking one frame). */
  readonly showRange = input(true);
  /** Current playback position, in seconds. */
  readonly time = model(0);
  readonly ready = output<HTMLVideoElement>();
  protected readonly playing = signal(false);
  protected readonly duration = computed(() => this.file().info?.duration ?? 0);
  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('videoEl');
  protected readonly fmt = formatTime;

  constructor() {
    let raf = 0;
    const tick = () => {
      const v = this.videoRef()?.nativeElement;
      if (v) {
        let t = v.currentTime;
        if (!v.paused && this.showRange() && t >= this.end()) {
          v.pause();
          v.currentTime = t = this.end();
        }
        if (Math.abs(t - this.time()) > 0.01) this.time.set(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(raf));
  }

  seekTo(t: number): void {
    const v = this.videoRef()?.nativeElement;
    if (v) v.currentTime = t;
    this.time.set(t);
  }

  protected toggle(): void {
    const v = this.videoRef()?.nativeElement;
    if (!v) return;
    if (v.paused) {
      if (this.showRange() && (v.currentTime >= this.end() - 0.05 || v.currentTime < this.start()))
        v.currentTime = this.start();
      void v.play();
    } else v.pause();
  }
}
