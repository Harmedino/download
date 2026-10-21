import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

/** Before/after comparison: drag (or use arrow keys) to reveal the result over the original. */
@Component({
  selector: 'app-compare-slider',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
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
  template: `
    <div class="relative mx-auto w-full overflow-hidden rounded-3xl bg-zinc-200 select-none dark:bg-zinc-900" [style.aspect-ratio]="ratio()">
      <img [src]="before()" alt="Original" class="absolute inset-0 h-full w-full object-contain" draggable="false" />
      @if (after(); as a) {
        <div class="checker absolute inset-0" [style.clip-path]="'inset(0 0 0 ' + pos() + '%)'">
          <img [src]="a" alt="Background removed" class="absolute inset-0 h-full w-full object-contain" draggable="false" />
        </div>
        <div class="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,.5)]" [style.left.%]="pos()">
          <span class="absolute top-1/2 left-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-zinc-900 shadow-lg">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6" /></svg>
          </span>
        </div>
        <span class="pointer-events-none absolute top-3 left-3 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white">Before</span>
        <span class="pointer-events-none absolute top-3 right-3 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white">After</span>
        <input
          type="range"
          min="0"
          max="100"
          step="0.5"
          [value]="pos()"
          (input)="pos.set(+$any($event.target).value)"
          aria-label="Compare before and after"
          class="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />
      }
    </div>
  `,
})
export class CompareSlider {
  readonly before = input.required<string>();
  readonly after = input<string | null>(null);
  /** CSS aspect-ratio, e.g. "4 / 3" */
  readonly ratio = input('1 / 1');
  protected readonly pos = signal(50);
}
