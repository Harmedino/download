# SnapGrab API: Node + ffmpeg + yt-dlp + gallery-dl in one image.
# Build from the server/ directory:  docker build -t snapgrab-api .

# ---- build: compile TypeScript with dev dependencies ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000 \
    TEMP_DIR=/app/tmp \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_NO_CACHE_DIR=1

# ffmpeg/ffprobe for media processing; Python for yt-dlp and gallery-dl.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates \
 && pip3 install --upgrade yt-dlp gallery-dl \
 && apt-get purge -y python3-pip && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /app/tmp && chown -R node:node /app/tmp
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
