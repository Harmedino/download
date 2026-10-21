import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ThemeService } from '../core/theme.service';

@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header class="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/80 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/80">
      <div class="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
        <a routerLink="/" class="mr-auto flex items-center gap-2 font-bold tracking-tight" aria-label="SnapGrab home">
          <span class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            </svg>
          </span>
          <span class="text-lg">SnapGrab</span>
        </a>
        <nav class="flex items-center gap-1 text-sm">
          @for (l of links; track l.path) {
            <a
              [routerLink]="l.path"
              routerLinkActive="bg-zinc-200/70 text-zinc-900 dark:bg-zinc-800 dark:text-white"
              [routerLinkActiveOptions]="{ exact: l.path === '/' }"
              class="rounded-lg px-2.5 py-1.5 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            >
              {{ l.label }}
            </a>
          }
        </nav>
        <button
          type="button"
          (click)="theme.toggle()"
          class="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800"
          [attr.aria-label]="theme.theme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
        >
          @if (theme.theme() === 'dark') {
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          } @else {
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
              <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
            </svg>
          }
        </button>
      </div>
    </header>
  `,
})
export class Header {
  protected readonly theme = inject(ThemeService);
  protected readonly links = [
    { path: '/', label: 'Download' },
  ];
}
