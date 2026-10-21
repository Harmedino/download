# SnapGrab

Paste a link from a public YouTube, TikTok, Instagram, Facebook, X/Twitter, Pinterest, Reddit, Vimeo, Dailymotion, Twitch, SoundCloud, LinkedIn, Tumblr, Snapchat, Bluesky, Streamable or Imgur post, preview it, and download the video, audio or image. You can also remove the background from an image (uploaded, or straight from a fetched post). Background removal works on images only.

> Work in progress. Full setup and deployment docs land in phase 8.

## Layout

| Path | What |
|------|------|
| `server/` | Node + Express + TypeScript API, MongoDB (Mongoose), Agenda job queue, yt-dlp / gallery-dl / ffmpeg |
| `client/` | Angular 22 (standalone components, signals, zoneless) + Tailwind CSS 4 |

## Quick start (local)

Requirements: Node 22.22.3+ or 24.15+, MongoDB, `yt-dlp` (install with `pip install -U "yt-dlp[default]"` so YouTube works), `gallery-dl`, `ffmpeg`.

```bash
# API
cd server
cp .env.example .env        # set MONGO_URI etc.
npm install
npm run dev                 # http://localhost:4000/api/health

# Web app
cd client
npm install
npm start                   # http://localhost:4200
```

## Deploying

The two halves deploy separately:

| Part | Where | Why |
|------|-------|-----|
| `client/` (Angular) | Vercel or Netlify | Static site |
| `server/` (API) | Render or Railway, using `server/Dockerfile` | Needs ffmpeg, yt-dlp, gallery-dl, MongoDB and long-running jobs, which serverless platforms like Vercel can't provide |
| Database | MongoDB Atlas | Free tier is enough to start |

**Do not deploy `server/` to Vercel.** `server/vercel.json` turns off Git deployments for any Vercel project rooted at `server/`, so such projects stop posting failed checks on PRs. You can still delete them (or change their Root Directory to `client`).

### API on Render
1. MongoDB Atlas: create a cluster and a database user, and under *Network Access* allow `0.0.0.0/0`. Copy the `mongodb+srv://` connection string.
2. Render: **New > Blueprint**, pick this repo. `render.yaml` creates `snapgrab-api` from `server/Dockerfile`.
3. Set `MONGO_URI` (Atlas string) and `CLIENT_ORIGIN` (your Vercel URL, e.g. `https://your-app.vercel.app`).
4. Check `https://<your-api>.onrender.com/api/health` shows `"mongo":"connected"`, the tools as available, and your Vercel URL in `allowedOrigins`. The API starts even when MongoDB is unreachable (it keeps retrying and logs why), so a `"degraded"` status points at `MONGO_URI` or Atlas Network Access.

On Railway, create a service from the repo with root directory `server`; `server/railway.json` selects the Dockerfile.

Background removal loads a ~150 MB model and is CPU-heavy, so use an instance with at least 2 GB RAM.

### Client on Vercel
1. **Root Directory:** `client` (framework, build command and output directory come from `client/vercel.json`).
2. **Environment variable:** `API_BASE_URL` = your API URL, e.g. `https://download-vmbd.onrender.com` (no trailing slash). The build falls back to the URL in `client/src/environments/environment.ts` when this is unset, so keep that file pointing at the live API too.
3. Deploy, then make sure that URL is in the API's `CLIENT_ORIGIN`.

### Ads (optional)
Ads stay off until you set one of these on the client's Vercel project and redeploy. Each spot shows a small "Advertisement" label: one under the link box on the home page, one under the download details, and one above the footer on the other pages.

| Variable | What to paste |
| --- | --- |
| `ADSENSE_CLIENT` | Your AdSense publisher id, `ca-pub-…` |
| `ADSENSE_SLOT_HOME`, `ADSENSE_SLOT_RESULT`, `ADSENSE_SLOT_FOOTER` | The `data-ad-slot` number of a display ad unit for each spot |
| `ADSTERRA_BANNER_KEY` | Key of an Adsterra 728x90 banner (computers and tablets) |
| `ADSTERRA_MOBILE_KEY` | Key of an Adsterra 320x50 banner (phones) |
| `ADS_TXT` | Extra `/ads.txt` lines from your ad network, separated by `;` |

AdSense fills a spot when it has a slot id for it; otherwise Adsterra does. With `ADSENSE_CLIENT` set, the build also publishes `/ads.txt` with your Google line. Adsterra banners run in a sandboxed frame, so they cannot redirect the page or open pop-ups by themselves.

## Security and limits

- Public posts only: SnapGrab never asks for or stores social media logins or cookies.
- Links must be `http(s)` URLs on a supported platform (allowlist; blocks SSRF to internal hosts). yt-dlp runs with its generic extractor disabled and gallery-dl ignores direct-link files, so a post can't point the server at an arbitrary URL.
- yt-dlp, gallery-dl and ffmpeg are always spawned with argument arrays, never through a shell.
- Rate limits (stored in MongoDB, shared by all instances): 20 fetches/min, 40 downloads/10 min, 20 background removals/10 min per IP. 429 responses include `Retry-After`.
- Queue caps: at most 30 download and 20 background-removal jobs waiting or running at once; beyond that the API answers `503 SERVER_BUSY`.
- Uploads: 50 MB, images only (JPG, PNG, WebP and similar), random filenames on disk.
- Job and file ids are 96-bit random values, so download links can't be guessed. Files are deleted after 1 hour.
- Helmet (CSP `default-src 'none'`), CORS limited to `CLIENT_ORIGIN`, 100 KB JSON body limit, no stack traces in responses.

## Tests

```bash
cd server && npm test
cd client && npm test
```

Only download content you own or have permission to use.
