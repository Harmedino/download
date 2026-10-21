import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';

/** Shows a slim banner while the browser reports no network connection. */
@Component({
  selector: 'app-offline-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (offline()) {
      <div role="status" class="bg-amber-500 px-4 py-2 text-center text-sm font-medium text-amber-950">
        You're offline. Downloads and uploads will resume when you reconnect.
      </div>
    }
  `,
})
export class OfflineBanner {
  protected readonly offline = signal(typeof navigator !== 'undefined' && navigator.onLine === false);

  constructor() {
    const update = () => this.offline.set(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    });
  }
}
