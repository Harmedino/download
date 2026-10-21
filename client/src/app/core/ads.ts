export type AdPlacement = 'home' | 'result' | 'footer';

export interface AdsConfig {
  /** Google AdSense publisher id, e.g. ca-pub-1234567890123456. */
  adsenseClient: string;
  /** AdSense ad unit ids (the numeric data-ad-slot) for each placement. */
  adsenseSlots: Record<AdPlacement, string>;
  /** Adsterra 728x90 banner key, shown on wide screens. */
  adsterraBannerKey: string;
  /** Adsterra 320x50 banner key, shown on phones. */
  adsterraMobileKey: string;
}

export type AdUnit =
  | { network: 'adsense'; client: string; slot: string }
  | { network: 'adsterra'; key: string; width: number; height: number };

const ADSENSE_CLIENT = /^ca-pub-\d{10,20}$/;
const ADSENSE_SLOT = /^\d{5,20}$/;
const ADSTERRA_KEY = /^[a-f0-9]{32}$/i;

/**
 * Picks the ad to show in a placement, or null when nothing valid is configured.
 * AdSense wins when it has a unit for the placement; otherwise Adsterra fills it.
 * Ids are validated here because the Adsterra key ends up inside an iframe document.
 */
export function pickAdUnit(
  config: AdsConfig,
  placement: AdPlacement,
  wide: boolean,
): AdUnit | null {
  const slot = config.adsenseSlots[placement];
  if (ADSENSE_CLIENT.test(config.adsenseClient) && ADSENSE_SLOT.test(slot)) {
    return { network: 'adsense', client: config.adsenseClient, slot };
  }
  if (wide && ADSTERRA_KEY.test(config.adsterraBannerKey)) {
    return { network: 'adsterra', key: config.adsterraBannerKey, width: 728, height: 90 };
  }
  if (ADSTERRA_KEY.test(config.adsterraMobileKey)) {
    return { network: 'adsterra', key: config.adsterraMobileKey, width: 320, height: 50 };
  }
  return null;
}

/** Standalone document for an Adsterra banner, rendered in a sandboxed iframe so it cannot touch the page. */
export function adsterraDocument(key: string, width: number, height: number): string {
  if (!ADSTERRA_KEY.test(key)) throw new Error('Invalid Adsterra key');
  return (
    `<!doctype html><html><head><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style></head><body>` +
    `<script>atOptions={key:'${key}',format:'iframe',height:${height},width:${width},params:{}};</script>` +
    `<script src="https://www.highperformanceformat.com/${key}/invoke.js"></script>` +
    `</body></html>`
  );
}
