import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { ThemeService } from './core/theme.service';
import { AdSlot } from './shared/ad-slot';
import { DialogHost } from './shared/dialog-host';
import { Footer } from './shared/footer';
import { Header } from './shared/header';
import { OfflineBanner } from './shared/offline-banner';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Header, Footer, OfflineBanner, AdSlot, DialogHost],
  host: { class: 'flex min-h-dvh flex-col' },
  template: `
    <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-violet-600 focus:px-3 focus:py-2 focus:text-white">
      Skip to content
    </a>
    <app-offline-banner />
    <app-header />
    <main id="main" class="flex-1">
      <router-outlet />
    </main>
    @if (showFooterAd()) {
      <app-ad-slot placement="footer" class="mt-12" />
    }
    <app-footer />
    <app-dialog-host />
  `,
})
export class App {
  // Instantiated here so the saved theme is applied before the first render.
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  /** The home and download pages carry their own ad, so the footer banner is skipped there. */
  protected readonly showFooterAd = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => !['/', '/result'].includes(e.urlAfterRedirects.split(/[?#]/)[0])),
    ),
    { initialValue: false },
  );
}
