import { type AdsConfig, adsterraDocument, pickAdUnit } from './ads';

const KEY = '0123456789abcdef0123456789abcdef';
const MOBILE = 'fedcba9876543210fedcba9876543210';
const empty: AdsConfig = {
  adsenseClient: '',
  adsenseSlots: { home: '', result: '', footer: '' },
  adsterraBannerKey: '',
  adsterraMobileKey: '',
};

describe('pickAdUnit', () => {
  it('shows nothing when no network is configured', () => {
    expect(pickAdUnit(empty, 'home', true)).toBeNull();
  });

  it('uses AdSense when the placement has a slot', () => {
    const c = {
      ...empty,
      adsenseClient: 'ca-pub-1234567890123456',
      adsenseSlots: { ...empty.adsenseSlots, result: '9876543210' },
    };
    expect(pickAdUnit(c, 'result', true)).toEqual({
      network: 'adsense',
      client: 'ca-pub-1234567890123456',
      slot: '9876543210',
    });
    expect(pickAdUnit(c, 'home', true)).toBeNull();
  });

  it('falls back to Adsterra and picks the banner size by screen width', () => {
    const c = { ...empty, adsterraBannerKey: KEY, adsterraMobileKey: MOBILE };
    expect(pickAdUnit(c, 'home', true)).toEqual({
      network: 'adsterra',
      key: KEY,
      width: 728,
      height: 90,
    });
    expect(pickAdUnit(c, 'home', false)).toEqual({
      network: 'adsterra',
      key: MOBILE,
      width: 320,
      height: 50,
    });
    // A 728px banner never goes on a phone.
    expect(pickAdUnit({ ...empty, adsterraBannerKey: KEY }, 'home', false)).toBeNull();
  });

  it('ignores malformed ids', () => {
    expect(
      pickAdUnit({ ...empty, adsterraBannerKey: "x'</script><script>alert(1)" }, 'home', true),
    ).toBeNull();
    expect(() => adsterraDocument("x'</script>", 728, 90)).toThrow();
  });
});
