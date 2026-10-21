import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';

export type Theme = 'dark' | 'light';
const KEY = 'snapgrab.theme';

/** Dark by default; the choice is remembered in localStorage. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  readonly theme = signal<Theme>(this.initial());

  constructor() {
    effect(() => {
      const t = this.theme();
      const root = this.doc.documentElement;
      root.classList.toggle('dark', t === 'dark');
      root.style.colorScheme = t;
      try {
        localStorage.setItem(KEY, t);
      } catch {
        /* ignore */
      }
    });
  }

  toggle(): void {
    const flip = () => this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
    const root = this.doc.documentElement;
    const reduce = this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!this.doc.startViewTransition || reduce) {
      flip();
      return;
    }
    // Cross-fade between themes; the class is set inside the callback since the effect runs later.
    root.classList.add('theme-switch');
    const vt = this.doc.startViewTransition(() => {
      flip();
      root.classList.toggle('dark', this.theme() === 'dark');
    });
    vt.finished.finally(() => root.classList.remove('theme-switch'));
  }

  private initial(): Theme {
    try {
      return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }
}
