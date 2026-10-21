import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { ConfigService } from '../core/config.service';
import { ThemeService } from '../core/theme.service';
import { TOOL_LINKS } from '../core/tools';

@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header style="view-transition-name: site-header" class="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/80 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/80">
      <div class="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
        <a routerLink="/" class="mr-auto flex items-center gap-2 font-bold tracking-tight" aria-label="SnapGrab home">
          <span class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            </svg>
          </span>
          <span class="text-lg">SnapGrab</span>
        </a>
        <nav class="relative flex items-center gap-1 text-sm">
          @for (l of links.slice(0, 1); track l.path) {
            <a
              [routerLink]="l.path"
              routerLinkActive="bg-zinc-200/70 text-zinc-900 dark:bg-zinc-800 dark:text-white"
              [routerLinkActiveOptions]="{ exact: l.path === '/' }"
              class="rounded-lg px-2 py-1.5 whitespace-nowrap text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            >
              {{ l.label }}
            </a>
          }
          <button
            type="button"
            (click)="menuOpen.set(!menuOpen())"
            [attr.aria-expanded]="menuOpen()"
            aria-haspopup="true"
            aria-controls="tools-menu"
            class="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 whitespace-nowrap text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            [class]="menuOpen() ? 'bg-zinc-200/70 dark:bg-zinc-800' : ''"
          >
            Tools
            <svg viewBox="0 0 24 24" class="h-4 w-4 transition" [class.rotate-180]="menuOpen()" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          @if (menuOpen()) {
            <div
              id="tools-menu"
              class="absolute top-full right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
              (keydown.escape)="menuOpen.set(false)"
            >
              @for (t of tools(); track t.path) {
                <a [routerLink]="t.path" class="flex items-start gap-3 rounded-xl p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800" (click)="menuOpen.set(false)">
                  <span class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-300">
                    <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="t.icon" /></svg>
                  </span>
                  <span class="min-w-0">
                    <span class="block font-medium text-zinc-900 dark:text-white">{{ t.label }}</span>
                    <span class="block text-xs text-zinc-500 dark:text-zinc-400">{{ t.description }}</span>
                  </span>
                </a>
              }
              <a routerLink="/tools" (click)="menuOpen.set(false)" class="mt-1 block rounded-xl px-2 py-2 text-center text-xs font-medium text-violet-600 hover:bg-violet-500/10 dark:text-violet-300">All tools</a>
            </div>
          }
          @for (l of links.slice(1); track l.path) {
            <a
              [routerLink]="l.path"
              routerLinkActive="bg-zinc-200/70 text-zinc-900 dark:bg-zinc-800 dark:text-white"
              [routerLinkActiveOptions]="{ exact: l.path === '/' }"
              class="rounded-lg px-2 py-1.5 whitespace-nowrap text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
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
  private readonly config = inject(ConfigService);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly menuOpen = signal(false);
  protected readonly links = [
    { path: '/', label: 'Download' },
    { path: '/history', label: 'History' },
  ];
  protected readonly tools = computed(() => TOOL_LINKS.filter((t) => t.path !== '/' && (!t.tool || this.config.has(t.tool))));

  constructor() {
    inject(Router)
      .events.pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.menuOpen.set(false));
    // Close the menu on any click outside the header.
    const onDocClick = (e: MouseEvent) => {
      if (this.menuOpen() && !this.host.nativeElement.contains(e.target as Node)) this.menuOpen.set(false);
    };
    document.addEventListener('click', onDocClick);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('click', onDocClick));
  }
}
