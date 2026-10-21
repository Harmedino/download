import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="mx-auto max-w-md px-4 pt-20 text-center">
      <p class="animate-pop-in text-6xl font-extrabold text-violet-500">404</p>
      <h1 class="mt-3 text-2xl font-bold">Page not found</h1>
      <p class="mt-2 text-zinc-600 dark:text-zinc-400">That page doesn't exist. Paste a link on the home page to get started.</p>
      <a routerLink="/" class="mt-6 inline-flex h-11 items-center rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-6 font-semibold text-white shadow-lg shadow-fuchsia-600/20 hover:-translate-y-0.5 hover:brightness-110">
        Go home
      </a>
    </section>
  `,
})
export class NotFound {}
