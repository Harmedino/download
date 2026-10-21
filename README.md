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

## Tests

```bash
cd server && npm test
cd client && npm test
```

Only download content you own or have permission to use.
