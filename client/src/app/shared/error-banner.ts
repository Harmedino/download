import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ApiError, friendly } from '../core/errors';

@Component({
  selector: 'app-error-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (text(); as t) {
      <div
        role="alert"
        class="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-200"
      >
        <svg class="mt-0.5 h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v6M12 16.5v.5" stroke-linecap="round" />
        </svg>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">{{ t.title }}</p>
          @if (t.hint) {
            <p class="mt-0.5 opacity-90">{{ t.hint }}</p>
          }
        </div>
        @if (retryable()) {
          <button type="button" class="shrink-0 rounded-lg px-2 py-1 font-medium underline-offset-2 hover:underline" (click)="retry.emit()">
            Retry
          </button>
        }
      </div>
    }
  `,
})
export class ErrorBanner {
  readonly error = input<ApiError | null>(null);
  readonly retryable = input(false);
  readonly retry = output<void>();
  protected readonly text = computed(() => friendly(this.error()));
}
