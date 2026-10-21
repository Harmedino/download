import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { environment } from '../../environments/environment';
import { type AdPlacement, adsterraDocument, pickAdUnit } from '../core/ads';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * A labelled ad box for one placement. Renders nothing unless an ad network is configured
 * (see scripts/set-env.mjs), so local builds and forks stay ad-free.
 */
@Component({
  selector: 'app-ad-slot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (unit(); as u) {
      <aside
        class="mx-auto flex max-w-3xl flex-col items-center gap-1 px-4"
        aria-label="Advertisement"
      >
        <span class="text-[10px] tracking-wider text-zinc-400 uppercase dark:text-zinc-500"
          >Advertisement</span
        >
        @if (u.network === 'adsense') {
          <ins
            #adsense
            class="adsbygoogle block w-full"
            style="display: block; min-height: 90px"
            [attr.data-ad-client]="u.client"
            [attr.data-ad-slot]="u.slot"
            data-ad-format="auto"
            data-full-width-responsive="true"
          ></ins>
        } @else {
          <iframe
            title="Advertisement"
            class="max-w-full border-0"
            style="color-scheme: light"
            [width]="u.width"
            [height]="u.height"
            [srcdoc]="adsterraDoc()"
            loading="lazy"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          ></iframe>
        }
      </aside>
    }
  `,
})
export class AdSlot {
  readonly placement = input.required<AdPlacement>();

  private readonly doc = inject(DOCUMENT);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly adsense = viewChild<ElementRef<HTMLElement>>('adsense');

  private readonly wide =
    typeof matchMedia === 'function' && matchMedia('(min-width: 768px)').matches;
  protected readonly unit = computed(() =>
    pickAdUnit(environment.ads, this.placement(), this.wide),
  );

  // The key is validated in pickAdUnit/adsterraDocument, so the generated document is trusted.
  protected readonly adsterraDoc = computed(() => {
    const u = this.unit();
    return u?.network === 'adsterra'
      ? this.sanitizer.bypassSecurityTrustHtml(adsterraDocument(u.key, u.width, u.height))
      : '';
  });

  constructor() {
    afterNextRender(() => {
      const u = this.unit();
      if (u?.network !== 'adsense' || !this.adsense()) return;
      this.loadAdsense(u.client);
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        /* blocked by an ad blocker */
      }
    });
  }

  private loadAdsense(client: string): void {
    if (this.doc.querySelector('script[data-snapgrab-adsense]')) return;
    const s = this.doc.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    s.dataset['snapgrabAdsense'] = '';
    this.doc.head.appendChild(s);
  }
}
