import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full">
      @if (label()) {
        <div class="mb-1 flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span class="truncate">{{ label() }}</span>
          <span class="tabular-nums">{{ value() }}%</span>
        </div>
      }
      <div
        class="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-valuenow]="value()"
        [attr.aria-label]="label() || 'Progress'"
      >
        <div
          class="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-[width] duration-500 ease-out"
          [style.width.%]="value() < 3 ? 3 : value()"
        ></div>
      </div>
    </div>
  `,
})
export class ProgressBar {
  readonly value = input(0);
  readonly label = input<string | null>(null);
}
