import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Platform } from '../core/models';
import { PLATFORM_NAMES } from '../core/platform';

const COLORS: Record<Platform, string> = {
  tiktok: 'bg-black text-white ring-1 ring-white/20',
  instagram: 'bg-gradient-to-br from-amber-400 via-pink-500 to-purple-600 text-white',
  youtube: 'bg-red-600 text-white',
  facebook: 'bg-blue-600 text-white',
  twitter: 'bg-black text-white ring-1 ring-white/20',
  pinterest: 'bg-red-700 text-white',
  reddit: 'bg-orange-600 text-white',
  vimeo: 'bg-sky-500 text-white',
  dailymotion: 'bg-blue-700 text-white',
  twitch: 'bg-purple-600 text-white',
  soundcloud: 'bg-orange-500 text-white',
  linkedin: 'bg-sky-700 text-white',
  tumblr: 'bg-slate-800 text-white',
  snapchat: 'bg-yellow-300 text-black',
  bluesky: 'bg-blue-500 text-white',
  streamable: 'bg-indigo-600 text-white',
  imgur: 'bg-emerald-600 text-white',
};

/** Simplified platform glyphs (24x24 viewBox, drawn for this app). Platforms without one show their initial. */
const PATHS: Partial<Record<Platform, string>> = {
  tiktok: 'M14 3h3a4 4 0 0 0 4 4v3a7 7 0 0 1-4-1.3V15a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3z',
  instagram:
    'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zm5 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm5.5-4.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  youtube: 'M10 8.5v7l6-3.5z',
  facebook: 'M13.5 21v-7.5H16l.5-3h-3V8.6c0-.9.3-1.6 1.6-1.6h1.6V4.3A21 21 0 0 0 14.3 4C12 4 10.5 5.4 10.5 8v2.5H8v3h2.5V21z',
  twitter: 'M4 4h4.5l4 5.5L17 4h2.5l-5.8 7 6.3 9h-4.5l-4.3-6-5 6H3.5l6.2-7.4z',
  pinterest:
    'M12 3a9 9 0 0 0-3.3 17.4c-.1-.8-.1-2 0-2.8l1.1-4.6s-.3-.6-.3-1.4c0-1.3.8-2.3 1.7-2.3.8 0 1.2.6 1.2 1.3 0 .8-.5 2-.8 3.1-.2.9.5 1.7 1.4 1.7 1.7 0 3-1.8 3-4.4 0-2.3-1.6-3.9-4-3.9-2.7 0-4.3 2-4.3 4.2 0 .8.3 1.7.7 2.2l.1.4-.3 1.1c0 .2-.2.2-.4.1-1.2-.6-2-2.3-2-3.8 0-3.1 2.3-6 6.5-6 3.4 0 6.1 2.4 6.1 5.7 0 3.4-2.2 6.2-5.1 6.2-1 0-2-.5-2.3-1.2l-.6 2.4c-.2.8-.8 1.9-1.2 2.6A9 9 0 1 0 12 3z',
  reddit:
    'M20 11.5a2 2 0 0 0-3.4-1.4A9.6 9.6 0 0 0 12.4 9l.8-3.7 2.6.6a1.4 1.4 0 1 0 .2-1l-3-.6-1 4.7c-1.7.1-3.2.5-4.4 1.2A2 2 0 1 0 5.4 13a3.8 3.8 0 0 0 0 .6c0 3 3 5.4 6.6 5.4s6.6-2.4 6.6-5.4v-.6a2 2 0 0 0 1.4-1.5zM8.5 13a1.2 1.2 0 1 1 2.4 0 1.2 1.2 0 0 1-2.4 0zm6.7 3.2c-.8.8-2 1.1-3.2 1.1s-2.4-.3-3.2-1.1a.4.4 0 0 1 .5-.5c.7.6 1.6.8 2.7.8s2-.2 2.7-.8a.4.4 0 0 1 .5.5zm-.2-2a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z',
};

@Component({
  selector: 'app-platform-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0' },
  template: `
    @if (platform(); as p) {
      <span
        class="inline-flex items-center justify-center rounded-xl {{ colors[p] }}"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [attr.title]="names[p]"
        role="img"
        [attr.aria-label]="names[p]"
      >
        <svg viewBox="0 0 24 24" class="h-3/5 w-3/5" fill="currentColor" aria-hidden="true">
          @if (p === 'youtube') {
            <rect x="2.5" y="5.5" width="19" height="13" rx="4" fill="currentColor" />
            <path [attr.d]="paths[p]" fill="#dc2626" />
          } @else if (paths[p]) {
            <path [attr.d]="paths[p]" fill-rule="evenodd" />
          } @else {
            <text x="12" y="12" text-anchor="middle" dominant-baseline="central" font-size="15" font-weight="700" font-family="system-ui, sans-serif">
              {{ names[p][0] }}
            </text>
          }
        </svg>
      </span>
    } @else {
      <span
        class="inline-flex items-center justify-center rounded-xl bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
        [style.width.px]="size()"
        [style.height.px]="size()"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" class="h-1/2 w-1/2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
        </svg>
      </span>
    }
  `,
})
export class PlatformIcon {
  readonly platform = input<Platform | null>(null);
  readonly size = input(40);
  protected readonly colors = COLORS;
  protected readonly paths = PATHS;
  protected readonly names = PLATFORM_NAMES;
  protected readonly label = computed(() => (this.platform() ? PLATFORM_NAMES[this.platform()!] : 'Unknown'));
}
