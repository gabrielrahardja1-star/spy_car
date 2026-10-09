# syntax=docker/dockerfile:1
#
# Builds the React app and packages it for Caddy.
#   Stage 1 (build):  Node installs the packages (npm ci) and runs `npm run build` -> /app/dist
#   Stage 2 (final):  Caddy image with the built files in /srv.
# The Caddyfile is NOT baked in: deploy/docker-compose.yml mounts deploy/caddy at /etc/caddy,
# so the proxy rules can be edited without a rebuild. (The stock Caddy image's own Caddyfile just
# serves /usr/share/caddy, so this image does nothing useful without that mount.)
#
# Build from the deploy folder:  docker compose up -d --build
# Vite writes VITE_* values into the JavaScript at BUILD time, so changing them needs a rebuild.

# Node 22 is an LTS line; Vite 8 here needs Node 20.19+ or 22.12+ (see web/package-lock.json).
FROM node:22-alpine AS build
WORKDIR /app

# Install packages first so Docker can reuse this layer when only source code changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build-time settings (passed from deploy/.env by docker-compose.yml).
ARG VITE_DATA_SOURCE=traccar
ARG VITE_TIMEZONE=Asia/Makassar
ARG VITE_SITE_GEOFENCE_NAME=Site
ENV VITE_DATA_SOURCE=$VITE_DATA_SOURCE \
    VITE_TIMEZONE=$VITE_TIMEZONE \
    VITE_SITE_GEOFENCE_NAME=$VITE_SITE_GEOFENCE_NAME

# "npm run build" = type-check (tsc -b) + vite build.
RUN npm run build

# ---------------------------------------------------------------------------
# Major version tag 2 follows Caddy 2.x updates; "alpine" keeps the image small.
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
# Caddy's own image already declares /data and /config as volumes and exposes 80/443.
