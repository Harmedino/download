# SnapGrab web app: Angular build served by nginx.
# Build from the client/ directory:  docker build --build-arg API_BASE_URL=http://localhost:4000 -t snapgrab-web .

# ---- build ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# scripts/set-env.mjs (the prebuild step) writes this into src/environments/environment.ts.
# The browser calls the API directly, so this is the API's address as seen from the user's machine.
ARG API_BASE_URL=http://localhost:4000
ENV API_BASE_URL=${API_BASE_URL} NG_CLI_ANALYTICS=false
RUN npm run build

# ---- serve ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/client/browser /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
