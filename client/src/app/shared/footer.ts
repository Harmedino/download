import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <footer class="mt-16 border-t border-zinc-200 py-8 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      <div class="mx-auto flex max-w-5xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
        <p>
          Only download content you own or have permission to use. Public posts only; we never ask for your social media login.
        </p>
        <nav class="flex shrink-0 gap-4">
          <a routerLink="/terms" class="hover:text-zinc-900 hover:underline dark:hover:text-white">Terms</a>
        </nav>
      </div>
    </footer>
  `,
})
export class Footer {}
