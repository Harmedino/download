import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ApiError } from '../../core/errors';
import { formatBytes, timeAgo } from '../../core/format';
import { HistoryService } from '../../core/history.service';
import { MediaStateService } from '../../core/media-state.service';
import { PLATFORM_NAMES, detectPlatform, looksLikeUrl } from '../../core/platform';
import type { HistoryEntry } from '../../core/models';
import { AdSlot } from '../../shared/ad-slot';
import { ErrorBanner } from '../../shared/error-banner';
import { PlatformIcon } from '../../shared/platform-icon';
import { Spinner } from '../../shared/spinner';

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AdSlot, PlatformIcon, RouterLink, Spinner, ErrorBanner],
  templateUrl: './home.html',
})
export class Home {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly media = inject(MediaStateService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly history = inject(HistoryService);

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('linkInput');

  protected readonly url = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly platform = computed(() => detectPlatform(this.url()));
  protected readonly platformName = computed(() => (this.platform() ? PLATFORM_NAMES[this.platform()!] : null));
  protected readonly canSubmit = computed(() => !this.loading() && this.url().trim().length > 0);
  protected readonly platforms = Object.values(PLATFORM_NAMES);
  protected readonly clipboardSupported = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;

  protected readonly formatBytes = formatBytes;
  protected readonly timeAgo = timeAgo;

  protected onInput(value: string): void {
    this.url.set(value);
    this.error.set(null);
  }

  protected async pasteFromClipboard(): Promise<void> {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        this.onInput(text);
        this.input().nativeElement.value = text;
        if (looksLikeUrl(text) && detectPlatform(text)) this.submit();
      }
    } catch {
      this.input().nativeElement.focus();
    }
  }

  protected submit(): void {
    const url = this.url().trim();
    if (!url || this.loading()) return;
    if (!looksLikeUrl(url)) {
      this.error.set(new ApiError('INVALID_URL', 'Invalid link'));
      return;
    }
    // Links outside the platform list go to the server too: it accepts direct media file links
    // and explains anything it can't handle (DRM services, web pages, private addresses).
    this.loading.set(true);
    this.error.set(null);
    this.api.fetchMedia(url).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.media.current.set(res);
        this.loading.set(false);
        void this.router.navigate(['/result'], { queryParams: { url: res.sourceUrl } });
      },
      error: (e: ApiError) => {
        this.error.set(e);
        this.loading.set(false);
      },
    });
  }

  protected expired(e: HistoryEntry): boolean {
    return this.history.isExpired(e);
  }

  protected reopen(e: HistoryEntry): void {
    this.url.set(e.sourceUrl);
    this.input().nativeElement.value = e.sourceUrl;
    this.submit();
  }
}
