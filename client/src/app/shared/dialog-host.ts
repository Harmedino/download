import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { DialogService } from '../core/dialog.service';

/**
 * Renders the dialog requested through DialogService.
 * Uses a native <dialog> opened with showModal(), so the browser makes the page behind it inert
 * (focus stays inside), puts it in the top layer and fires `cancel` on Esc.
 */
@Component({
  selector: 'app-dialog-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dlg
      class="app-dialog m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-zinc-950/60 backdrop:backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
      [attr.role]="req()?.kind === 'confirm' ? 'alertdialog' : 'dialog'"
      aria-labelledby="app-dialog-title"
      [attr.aria-describedby]="req()?.message ? 'app-dialog-message' : null"
      (cancel)="onCancel($event)"
      (click)="onBackdrop($event)"
    >
      @if (req(); as r) {
        <div class="animate-pop-in p-6">
          <div class="flex items-start gap-4">
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              [class]="r.danger ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-violet-500/10 text-violet-600 dark:text-violet-300'"
              aria-hidden="true"
            >
              <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                @if (r.danger) {
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" stroke-linecap="round" stroke-linejoin="round" />
                } @else {
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v5M12 7.5v.5" stroke-linecap="round" />
                }
              </svg>
            </span>
            <div class="min-w-0 flex-1">
              <h2 id="app-dialog-title" class="text-lg font-semibold">{{ r.title }}</h2>
              @if (r.message) {
                <p id="app-dialog-message" class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{{ r.message }}</p>
              }
            </div>
          </div>
          <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            @if (r.kind === 'confirm') {
              <button
                type="button"
                class="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-semibold hover:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                (click)="svc.close(false)"
              >
                {{ r.cancelText }}
              </button>
            }
            <button
              #primary
              type="button"
              class="rounded-xl px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
              [class]="r.danger ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200'"
              (click)="svc.close(true)"
            >
              {{ r.confirmText }}
            </button>
          </div>
        </div>
      }
    </dialog>
  `,
  styles: `
    .app-dialog[open]::backdrop {
      animation: dialog-backdrop-in 200ms ease-out both;
    }
    @keyframes dialog-backdrop-in {
      from {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .app-dialog[open]::backdrop {
        animation: none;
      }
    }
  `,
})
export class DialogHost {
  protected readonly svc = inject(DialogService);
  protected readonly req = this.svc.current;
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  private readonly primary = viewChild<ElementRef<HTMLButtonElement>>('primary');
  private returnFocus: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const el = this.dlg().nativeElement;
      const open = !!this.req();
      if (open && !el.open) {
        this.returnFocus = document.activeElement as HTMLElement | null;
        el.showModal?.();
        // Destructive confirms start on Cancel (the browser's first focusable); others on the primary action.
        if (!this.req()?.danger) queueMicrotask(() => this.primary()?.nativeElement.focus());
      } else if (!open && el.open) {
        el.close();
        this.returnFocus?.focus?.();
        this.returnFocus = null;
      }
    });
  }

  /** Esc: let us close it so the promise settles, instead of the browser closing it behind our back. */
  protected onCancel(e: Event): void {
    e.preventDefault();
    this.svc.close(false);
  }

  /** A click whose target is the <dialog> itself landed on the backdrop, outside the panel. */
  protected onBackdrop(e: MouseEvent): void {
    if (e.target === this.dlg().nativeElement) this.svc.close(false);
  }
}
