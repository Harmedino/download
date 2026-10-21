import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-remove-bg-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="mx-auto mt-6 flex w-fit gap-1 rounded-2xl bg-zinc-200/70 p-1 text-sm font-medium dark:bg-zinc-900" aria-label="Background remover type">
      @for (t of tabs; track t.path) {
        <a
          [routerLink]="t.path"
          routerLinkActive="bg-white text-zinc-900 shadow dark:bg-zinc-800 dark:text-white"
          [routerLinkActiveOptions]="{ exact: true }"
          #rla="routerLinkActive"
          [attr.aria-current]="rla.isActive ? 'page' : null"
          class="rounded-xl px-5 py-2 text-zinc-600 dark:text-zinc-400"
        >
          {{ t.label }}
        </a>
      }
    </nav>
  `,
})
export class RemoveBgTabs {
  protected readonly tabs = [
    { path: '/remove-bg', label: 'Image' },
    { path: '/remove-bg/video', label: 'Video' },
  ];
}
