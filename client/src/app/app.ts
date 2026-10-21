import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme.service';
import { Footer } from './shared/footer';
import { Header } from './shared/header';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Header, Footer],
  host: { class: 'flex min-h-dvh flex-col' },
  template: `
    <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-violet-600 focus:px-3 focus:py-2 focus:text-white">
      Skip to content
    </a>
    <app-header />
    <main id="main" class="flex-1">
      <router-outlet />
    </main>
    <app-footer />
  `,
})
export class App {
  // Instantiated here so the saved theme is applied before the first render.
  private readonly theme = inject(ThemeService);
}
