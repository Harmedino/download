import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  /** Styles the confirm button red, for destructive actions. */
  danger?: boolean;
}

export interface AlertOptions {
  title: string;
  message?: string;
  okText?: string;
}

export interface DialogRequest {
  kind: 'confirm' | 'alert';
  title: string;
  message?: string;
  confirmText: string;
  cancelText: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

/**
 * In-app replacement for window.confirm() and window.alert().
 * The open request is rendered by <app-dialog-host>, which lives in the root component.
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly current = signal<DialogRequest | null>(null);

  confirm(opts: ConfirmOptions): Promise<boolean> {
    return this.open({
      kind: 'confirm',
      title: opts.title,
      message: opts.message,
      confirmText: opts.confirmText ?? 'Confirm',
      cancelText: opts.cancelText ?? 'Cancel',
      danger: opts.danger ?? false,
    });
  }

  alert(opts: AlertOptions): Promise<void> {
    return this.open({
      kind: 'alert',
      title: opts.title,
      message: opts.message,
      confirmText: opts.okText ?? 'OK',
      cancelText: '',
      danger: false,
    }).then(() => undefined);
  }

  /** Settles the open dialog. Cancel, Esc and a backdrop click all close with false. */
  close(ok: boolean): void {
    const req = this.current();
    if (!req) return;
    this.current.set(null);
    req.resolve(ok);
  }

  private open(req: Omit<DialogRequest, 'resolve'>): Promise<boolean> {
    // A new dialog replaces one that is still open; the old one counts as cancelled.
    this.close(false);
    return new Promise<boolean>((resolve) => this.current.set({ ...req, resolve }));
  }
}
