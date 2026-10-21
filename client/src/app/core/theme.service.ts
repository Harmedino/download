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
    this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  private initial(): Theme {
    try {
      return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }
}
