# ChimpHouse's room server (server/), as a container. Only the room server: the website is a
# static build that goes on Cloudflare Pages (docs/deploy.md). One image for Fly.io, Render,
# Railway, Koyeb, DigitalOcean App Platform, or a VPS with Docker.
#
#   docker build -t chimphouse-room .
#   docker run --rm -p 8080:8080 -e CHIMPHOUSE_ROOM_ORIGINS=https://house.example.com chimphouse-room
#
# CHIMPHOUSE_ROOM_ORIGINS (the site the pages are served from) is required: the server refuses
# to start in production without it. The port is PORT (8080 here; hosts that set their own
# PORT are followed).

# ---- compile the server (needs the dev tools: TypeScript)
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tools/build-room.mjs tools/build-room.mjs
COPY server server
COPY src src
RUN node tools/build-room.mjs

# ---- the packages the server runs on, and nothing else (the website's are dev-only)
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ---- what runs
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    CHIMPHOUSE_ROOM_HOST=0.0.0.0
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/server/dist server/dist
# the image's own non-root user
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# node itself as the main process: it ends cleanly on SIGTERM (a deploy, a stop)
CMD ["node", "server/dist/server/main.js"]
