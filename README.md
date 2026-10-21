# SnapGrab

Paste a link from a public TikTok, Instagram, YouTube, Facebook, X/Twitter, Pinterest or Reddit post, preview it, and download the video or image. Background removal for images and short videos is coming in the next phases.

> Work in progress. Full setup and deployment docs land in phase 8.

## Layout

| Path | What |
|------|------|
| `server/` | Node + Express + TypeScript API, MongoDB (Mongoose), Agenda job queue, yt-dlp / gallery-dl / ffmpeg |
| `client/` | Angular 22 (standalone components, signals, zoneless) + Tailwind CSS 4 |

## Quick start (local)

Requirements: Node 22.22.3+ or 24.15+, MongoDB, `yt-dlp`, `gallery-dl`, `ffmpeg`.

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

**Do not deploy `server/` to Vercel.** If a Vercel project builds `snapgrab-server`, change its Root Directory to `client` (or delete it).

### API on Render
1. MongoDB Atlas: create a cluster and a database user, and under *Network Access* allow `0.0.0.0/0`. Copy the `mongodb+srv://` connection string.
2. Render: **New > Blueprint**, pick this repo. `render.yaml` creates `snapgrab-api` from `server/Dockerfile`.
3. Set `MONGO_URI` (Atlas string) and `CLIENT_ORIGIN` (your Vercel URL, e.g. `https://your-app.vercel.app`).
4. Check `https://<your-api>.onrender.com/api/health` shows `"mongo":"connected"` and the tools as available.

On Railway, create a service from the repo with root directory `server`; `server/railway.json` selects the Dockerfile.

Background removal loads a ~150 MB model and is CPU-heavy, so use an instance with at least 2 GB RAM.

### Client on Vercel
1. **Root Directory:** `client` (framework, build command and output directory come from `client/vercel.json`).
2. **Environment variable:** `API_BASE_URL` = your API URL, e.g. `https://snapgrab-api.onrender.com`.
3. Deploy, then make sure that URL is in the API's `CLIENT_ORIGIN`.

## Security and limits

- Public posts only: SnapGrab never asks for or stores social media logins or cookies.
- Links must be `http(s)` URLs on the seven supported platforms (allowlist; blocks SSRF to internal hosts). yt-dlp runs with its generic extractor disabled and gallery-dl ignores direct-link files, so a post can't point the server at an arbitrary URL.
- yt-dlp, gallery-dl and ffmpeg are always spawned with argument arrays, never through a shell.
- Rate limits (stored in MongoDB, shared by all instances): 20 fetches/min, 40 downloads/10 min, 20 image background removals/10 min and 4 video background removals/hour per IP. 429 responses include `Retry-After`.
- Queue caps: at most 30 downloads, 20 image and 4 video background-removal jobs waiting or running at once; beyond that the API answers `503 SERVER_BUSY`.
- Uploads: 50 MB, images or videos only, random filenames on disk. Videos over 60 s are rejected.
- Job and file ids are 96-bit random values, so download links can't be guessed. Files are deleted after 1 hour.
- Helmet (CSP `default-src 'none'`), CORS limited to `CLIENT_ORIGIN`, 100 KB JSON body limit, no stack traces in responses.

## Tests

```bash
cd server && npm test
cd client && npm test
```

Only download content you own or have permission to use.
