# SnapGrab

Paste a link from a public YouTube, TikTok, Instagram, Facebook, X/Twitter, Pinterest, Reddit, Vimeo, Dailymotion, Twitch, SoundCloud, LinkedIn, Tumblr, Snapchat, Bluesky, Streamable or Imgur post (or a direct link to a media file), preview it, and download the video, audio or image. Then remove an image's background or edit the video with the built-in tools.

Only download content you own or have permission to use. SnapGrab works with public posts only and never asks for social media logins.

## Features

- **Downloader:** platform detection as you type, preview with title, duration and size, 360p / 720p / 1080p / best, MP3 audio only, carousel grid with per-item download and **Download all (ZIP)**.
- **Background remover:** runs locally on the server (no paid API); before/after slider; transparent, solid color, blurred or custom image backgrounds; PNG export.
- **Video tools:** editor, converter, compressor, Shorts maker, frame extractor, thumbnail editor, GIF maker, subtitles and Creator Pack (see [Video tools](#video-tools)).
- **History:** recent jobs per browser, with no accounts.
- Dark mode by default with a light mode toggle, mobile-first layout, friendly error messages, Terms page.

## Tech stack

| Part | Built with |
|------|------------|
| Web app (`client/`) | Angular 22 (standalone components, signals, zoneless), Angular Router, Tailwind CSS 4 |
| API (`server/`) | Node 24, Express 5, TypeScript, Mongoose, Agenda (MongoDB-backed job queue, no Redis), express-rate-limit with a MongoDB store, Helmet |
| Media | yt-dlp, gallery-dl, ffmpeg via fluent-ffmpeg, `@imgly/background-removal-node` (local ONNX model), sharp |
| Database | MongoDB (`jobs`, `mediaCache` and `files` with 1-hour TTL indexes, `rateLimits`, `agendaJobs`) |

## Project structure

```
.
├── client/                 Angular app
│   ├── src/app/core/       API client, job polling, history, theme, error copy
│   ├── src/app/pages/      home, result, remove-bg, tools, history, terms, ...
│   ├── src/app/shared/     header, footer, platform icon, progress bar, compare slider, ...
│   ├── scripts/set-env.mjs writes the API URL (and ad settings) at build time
│   ├── Dockerfile          build + nginx image
│   └── vercel.json         Vercel settings (Root Directory = client)
├── server/                 Express API
│   ├── src/routes/         fetch, download, remove-bg, media, tools, jobs, files, history, config, health
│   ├── src/jobs/           Agenda setup and job processors (downloads, tools, cleanup)
│   ├── src/services/       yt-dlp, gallery-dl, ffmpeg, background removal, storage, AI providers
│   ├── src/middleware/     rate limits, uploads, validation, errors
│   ├── src/models/         Job, File, MediaCache
│   ├── tests/              Vitest + Supertest
│   ├── Dockerfile          Node + ffmpeg + yt-dlp + gallery-dl image
│   └── .env.example        every setting, with defaults
├── docker-compose.yml      MongoDB + API + web app
└── render.yaml             Render Blueprint for the API
```

## Quick start with Docker

Needs [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine with the Compose plugin).

```bash
git clone https://github.com/Harmedino/download.git snapgrab
cd snapgrab
docker compose up --build
```

Then open **http://localhost:8080**. The API is on http://localhost:4000 and http://localhost:4000/api/health should report `"mongo":"connected"`.

- The first build takes a while: it installs ffmpeg, yt-dlp and gallery-dl, and the background-removal model (about 150 MB).
- Optional settings (AI keys for subtitles, limits) go in `server/.env`, copied from `server/.env.example`. Compose reads it if it exists and overrides `MONGO_URI`, `PORT`, `CLIENT_ORIGIN` and `TEMP_DIR` so the containers find each other.
- Ports: change them with `WEB_PORT=3000 API_PORT=5000 docker compose up --build`. If you change the API port or open the app from another machine, also set `API_BASE_URL` (what the browser uses to reach the API) and `CLIENT_ORIGIN` (the web app's address), e.g. `API_BASE_URL=http://localhost:5000 CLIENT_ORIGIN=http://localhost:3000 docker compose up --build`.
- Data: MongoDB lives in the `mongo-data` volume and temporary files in `server-tmp`. `docker compose down` keeps them, `docker compose down -v` deletes them.
- Update yt-dlp (platforms change often): `docker compose build --no-cache server && docker compose up -d`.

## Local development (without Docker)

Requirements:

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 22.22.3+ or 24.15+ (Angular 22 needs it) | [nodejs.org](https://nodejs.org) or `nvm install 24` |
| MongoDB | 6+ | `docker run -d -p 27017:27017 mongo:8.0`, a local install, or a free [Atlas](https://www.mongodb.com/atlas) cluster |
| ffmpeg + ffprobe | 6+ | macOS `brew install ffmpeg`, Ubuntu `sudo apt install ffmpeg`, Windows `winget install ffmpeg` |
| yt-dlp | latest | `pip install -U "yt-dlp[default]"` (the `[default]` extra is what lets YouTube work) |
| gallery-dl | latest | `pip install -U gallery-dl` (image posts and carousels) |

```bash
# API: http://localhost:4000/api/health
cd server
cp .env.example .env        # set MONGO_URI if it isn't localhost
npm install
npm run dev

# Web app: http://localhost:4200 (in a second terminal)
cd client
npm install
npm start
```

In development the web app talks to `http://localhost:4000` (`client/src/environments/environment.development.ts`). At startup the API checks yt-dlp, gallery-dl, ffmpeg and ffprobe and logs an install hint for anything missing; `/api/health` shows the same.

## Configuration

### API (`server/.env`)

All settings, with comments, are in [`server/.env.example`](server/.env.example). The ones you usually touch:

| Variable | Default | What it does |
|----------|---------|--------------|
| `MONGO_URI` | `mongodb://localhost:27017/snapgrab` | MongoDB connection string (Atlas: `mongodb+srv://...`) |
| `PORT` | `4000` | API port (Render and Railway set this themselves) |
| `CLIENT_ORIGIN` | `http://localhost:4200` | Web app address(es) allowed by CORS, comma-separated |
| `TEMP_DIR` | `./tmp` | Where downloads, uploads and results are written |
| `MAX_UPLOAD_MB` | `50` | Upload limit for background removal |
| `MAX_DOWNLOAD_MB` | `500` | Largest file yt-dlp may download |
| `FILE_TTL_MINUTES` | `60` | How long files are kept before cleanup |
| `YTDLP_PATH`, `GALLERYDL_PATH`, `FFMPEG_PATH`, `FFPROBE_PATH` | on `PATH` | Point at the binaries if they aren't on `PATH` |

Video tool limits and AI keys are listed under [Server settings for the tools](#server-settings-for-the-tools) and [AI services](#ai-services-optional).

### Web app (build time)

| Variable | What it does |
|----------|--------------|
| `API_BASE_URL` | The API address the browser calls. Must be `https` except for `localhost`. Without it, `client/src/environments/environment.ts` is used as committed |
| `ADSENSE_*`, `ADSTERRA_*`, `ADS_TXT` | Optional ads, see [Ads](#ads-optional) |

These are read by `client/scripts/set-env.mjs`, which runs before every `npm run build`.

## API

All endpoints are under `/api` and answer JSON errors as `{ "error": { "code", "message" } }`.

| Method | Path | What it does |
|--------|------|--------------|
| `GET` | `/health` | MongoDB state and which tools are installed |
| `GET` | `/config` | Public limits and which tools / AI providers are available |
| `POST` | `/fetch` | `{ url }` → platform, title, thumbnail, duration, formats, carousel items (cached 1 hour) |
| `POST` | `/download` | `{ url, formatId?, itemIndex?, audioOnly? }` → `{ jobId }` |
| `POST` | `/download/zip` | `{ url }` → `{ jobId }` for a ZIP of every carousel item |
| `POST` | `/remove-bg/image` | Multipart upload (`file`, optional `bgImage`) or `{ fileId }`, plus `background` → `{ jobId }` |
| `POST` | `/media/upload` | Upload a video, audio or image for the tools |
| `GET` / `DELETE` | `/media/:id` | Media details / delete an upload |
| `POST` | `/tools/:type` | Start a tool job (`edit`, `convert`, `compress`, `gif`, `frames`, `thumbnail`, `shorts`, `subtitles`, `burn-subtitles`, `creator-pack`) |
| `GET` | `/jobs/:id` | Status, progress (0-100), stage, error and result files |
| `POST` | `/jobs/:id/retry` | Retry a failed job |
| `DELETE` | `/jobs/:id` | Delete a job and its files |
| `GET` / `DELETE` | `/history` | This browser's jobs / clear them |
| `GET` | `/files/:id` | Stream a file with `Content-Disposition` (`?inline=1` for previews; supports Range) |

Long-running work (downloads, background removal, video tools) runs as Agenda jobs: start a job, then poll `/jobs/:id` until `status` is `done` or `failed`.

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

## Video tools

Besides the link downloader and Remove BG, the site has video tools that all follow the same flow: paste a link or upload a file, preview it, pick a tool, export, download. Each tool runs on the server with ffmpeg as a background job, shows real progress, and lands in **History** (`/history`), where jobs can be downloaded, retried or deleted.

| Tool | Path | Status |
|------|------|--------|
| Video Editor | `/editor` | Trim, cut sections, merge clips with transitions, crop (draggable, 16:9 / 9:16 / 1:1 / 4:5), resize, rotate, mirror, speed, brightness/contrast/saturation, fades, text overlays, live composition preview |
| Video Converter | `/convert` | MP4, WebM, MOV, MKV, MP3, M4A, WAV; resolution and frame rate; lossless remux when possible |
| Video Compressor | `/compress` | Quality levels or a target size in MB |
| Video to Shorts | `/shorts` | 9:16 at 1080×1920 or 720×1280 for YouTube Shorts, Reels or TikTok (length checked per platform); manual crop, "follow the subject", or the whole frame on a blurred background; optional caption |
| Frame Extractor | `/frames` | Exact frames at full resolution, a frame every N seconds (with a ZIP), or a contact sheet; JPG, PNG or WebP |
| Thumbnail Editor | `/thumbnail` | Crop (free or 16:9 / 9:16 / 1:1 / 4:5), brightness, contrast, saturation, sharpen, outlined text; opens frames straight from the Frame Extractor |
| Subtitle Generator | `/subtitles` | Speech recognition (needs a key, see below) in auto or a chosen language; edit text and timing against the player; font, colour, size, position, box; download SRT/VTT or burn in with libass. Existing .srt/.vtt files can be imported without any key |
| Creator Pack | `/creator-pack` | Pick items for one ZIP: original and edited video, thumbnail (from a chosen moment), MP3, SRT/VTT, transcript, frames, and AI titles/descriptions/hashtags. Anything that can't be made (no key, no audio, a provider error) is left out and explained in the pack's `README.txt` and on the page |
| GIF Maker | `/gif` | GIF (palette-optimised) or animated WebP, up to 30 s, with width, frame rate, speed and crop |

"Follow the subject" samples frames and scores them with libvips' attention strategy (skin tones, saturated colour and detail), then smooths the path so the crop pans gently. It is a saliency heuristic, not face recognition, so manual framing is always available.

Direct links: links that are not on a supported platform are accepted when they point straight at a public media file (`.mp4`, `.mov`, `.mp3`, ...). Streaming services that use DRM or subscriptions (Netflix, Disney+, Prime Video, Spotify, ...) are refused with an explanation.

History is private to the browser: the client keeps a random id in localStorage and sends it as `X-Client-Id`; the server stores only its SHA-256 and only shows, retries or deletes jobs for that id. There are no accounts.

### Server settings for the tools

| Variable | Default | What it does |
|----------|---------|--------------|
| `MAX_MEDIA_UPLOAD_MB` | 500 | Upload limit for the video tools |
| `MAX_MEDIA_DURATION_MINUTES` | 60 | Longest video/audio accepted |
| `JOB_TIMEOUT_MINUTES` | 30 | ffmpeg is killed and the job marked failed after this |
| `MEDIA_CONCURRENCY` | 1 | ffmpeg jobs at once (more jobs wait in the queue) |
| `FFMPEG_THREADS` | 2 | CPU threads per ffmpeg job |
| `MAX_OUTPUT_SIDE` | 3840 | Longest side of any exported video |
| `DIRECT_URLS_ENABLED` | true | Accept direct media file links |
| `FILE_TTL_MINUTES` | 60 | How long uploads and results are kept |

### AI services (optional)

Subtitles, transcripts and the Creator Pack's titles, descriptions and hashtags use real AI services. Nothing is simulated: without a key those features say they are unavailable (`AI_UNAVAILABLE`), and the Creator Pack skips them with a note. Keys stay on the server; `/api/config` only reports which provider and model are active.

| Variable | Default | What it does |
|----------|---------|--------------|
| `TRANSCRIBE_PROVIDER` | `auto` | `openai`, `groq`, `deepgram`, `none`, or `auto` (the first of those with a key) |
| `LLM_PROVIDER` | `auto` | `anthropic`, `openai`, `groq`, `none`, or `auto` (the first of those with a key) |
| `OPENAI_API_KEY` | | Speech-to-text (Whisper API) and/or text. [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `GROQ_API_KEY` | | Fast, cheap Whisper and/or text (no image input). [console.groq.com/keys](https://console.groq.com/keys) |
| `DEEPGRAM_API_KEY` | | Speech-to-text only. [console.deepgram.com](https://console.deepgram.com) |
| `ANTHROPIC_API_KEY` | | Text only (Claude reads the transcript and three frames). [console.anthropic.com](https://console.anthropic.com) |
| `OPENAI_TRANSCRIBE_MODEL` | `whisper-1` | Must support `verbose_json` with word timestamps |
| `GROQ_TRANSCRIBE_MODEL` | `whisper-large-v3-turbo` | |
| `DEEPGRAM_MODEL` | `nova-3` | |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Called with structured output and Anthropic's server-side fallback for declined requests |
| `OPENAI_LLM_MODEL` | `gpt-4.1-mini` | Any chat model with JSON mode and image input |
| `GROQ_LLM_MODEL` | `llama-3.3-70b-versatile` | |

The cheapest full setup is one `OPENAI_API_KEY` (speech and text) or `GROQ_API_KEY` plus `ANTHROPIC_API_KEY`. Audio is sent as 16 kHz mono MP3 in 10-minute chunks, so a 60-minute video is 6 requests. The AI suggestions are told to use only what the transcript and frames show, and the page and pack label them as drafts to review. Subtitle and Creator Pack jobs are limited to 15 per hour per IP because they cost money per request.

The background queue is Agenda on the same MongoDB, so no Redis is needed. Video encoding is CPU-bound: Render's free instance (0.1 CPU, 512 MB) can run it but is very slow, so use at least **Starter**, and **Standard** (1 CPU, 2 GB) for comfortable 1080p work. Uploads and results live on the instance's disk and are deleted after `FILE_TTL_MINUTES`, so the API must stay a single instance (or move files to object storage first).

## Security and limits

- Public posts only: SnapGrab never asks for or stores social media logins or cookies.
- Links must be `http(s)` URLs on a supported platform (allowlist; blocks SSRF to internal hosts). yt-dlp runs with its generic extractor disabled and gallery-dl ignores direct-link files, so a post can't point the server at an arbitrary URL.
- yt-dlp, gallery-dl and ffmpeg are always spawned with argument arrays, never through a shell.
- Every upload and download is probed with ffprobe before use. ffmpeg/ffprobe only ever read local files (`-protocol_whitelist file,pipe`) and only through a fixed list of demuxers (`-format_whitelist`), so playlist tricks (HLS, concat) in a fake "video" can't make ffmpeg read other files or URLs.
- Subtitle text goes into an ASS file with braces and backslashes neutralised, and is drawn by libass from a relative path, so it can't inject filters or override tags. Thumbnail text is XML-escaped into SVG.
- Video jobs: at most 20 waiting or running in total and 4 per browser; 30 uploads and 40 tool jobs per 10 minutes per IP.
- Rate limits (stored in MongoDB, shared by all instances): 20 fetches/min, 40 downloads/10 min, 20 background removals/10 min per IP. 429 responses include `Retry-After`.
- Queue caps: at most 30 download and 20 background-removal jobs waiting or running at once; beyond that the API answers `503 SERVER_BUSY`.
- Uploads: 50 MB, images only (JPG, PNG, WebP and similar), random filenames on disk.
- Job and file ids are 96-bit random values, so download links can't be guessed. Files are deleted after 1 hour.
- Helmet (CSP `default-src 'none'`), CORS limited to `CLIENT_ORIGIN`, 100 KB JSON body limit, no stack traces in responses.

## Tests

```bash
cd server && npm test      # API: unit + route tests (one runs the real background-removal model)
cd client && npm test      # web app
```

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| `/api/health` shows `"mongo":"disconnected"` or `"degraded"` | `MONGO_URI` is wrong, or Atlas *Network Access* doesn't allow the API's IP (use `0.0.0.0/0` on Render/Railway). The log names the host it tried. |
| The web app says "Can't reach SnapGrab" | The API is down or `API_BASE_URL` points somewhere else. Open `<API_BASE_URL>/api/health` in the browser. |
| Browser console shows a CORS error | Add the web app's exact address (scheme + host, no path) to `CLIENT_ORIGIN` and restart the API. `/api/health` lists the allowed origins. |
| "Server is missing a tool" | yt-dlp, gallery-dl or ffmpeg isn't installed or not on `PATH`; `/api/health` shows which. The Docker image includes all of them. |
| YouTube links fail while others work | yt-dlp is out of date or was installed without `[default]`. Update it (`pip install -U "yt-dlp[default]"`, or rebuild the Docker image). |
| A post says "private" | It needs a login. SnapGrab only supports public posts. |
| Background removal or video tools are very slow | They are CPU-bound. Use an instance with at least 1 CPU and 2 GB RAM, and keep `MEDIA_CONCURRENCY=1`. |

Only download content you own or have permission to use.
