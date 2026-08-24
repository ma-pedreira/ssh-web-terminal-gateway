# syntax=docker/dockerfile:1

# ---------- dependencies ----------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# ssh2 ships an optional native binding that is not built: pure JS avoids the
# toolchain and allows a read-only root filesystem.
RUN npm ci --ignore-scripts

# ---------- build ----------
FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs ./
COPY src ./src
COPY public ./public
RUN npm run build

# ---------- production dependencies ----------
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---------- runtime ----------
FROM node:24-alpine AS runner
WORKDIR /app

RUN apk add --no-cache dumb-init

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3030 \
    SSH_WEB_DB_PATH=/data/ssh-web.db \
    SSH_WEB_CONFIG_DIR=/data \
    SSH_WEB_SSH_DIR=/ssh \
    SSH_WEB_KEYS_DIR=/ssh-keys \
    SSH_WEB_IN_CONTAINER=true

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
# Node runs the TypeScript in src and server.ts uncompiled, so the sources are
# part of the runtime image.
COPY package.json next.config.ts server.ts ./
COPY src ./src
# Icons, manifest and service worker: without these the application cannot be
# installed, because Next serves public/ from disk at runtime.
COPY public ./public

# The data volume is mounted by compose; the node user is not root.
RUN mkdir -p /data /ssh /ssh-keys && chown -R node:node /data /ssh /app
USER node

EXPOSE 3030

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3030)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.ts"]
