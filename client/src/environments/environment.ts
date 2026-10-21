// Production build. On Vercel/Netlify set the API_BASE_URL (and optional ad) environment variables
// instead of editing this file: scripts/set-env.mjs rewrites it before `npm run build`.
export const environment = {
  production: true,
  apiBaseUrl: 'https://download-vmbd.onrender.com',
  ads: {
    adsenseClient: '',
    adsenseSlots: { home: '', result: '', footer: '' },
    adsterraBannerKey: '',
    adsterraMobileKey: '',
  },
};
