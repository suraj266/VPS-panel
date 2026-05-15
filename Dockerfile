# syntax=docker/dockerfile:1.7

# ============================================================
# Stage 1: build the web SPA
# ============================================================
FROM node:22-alpine AS web-build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --filter @panel/web --frozen-lockfile

COPY apps/web ./apps/web
RUN pnpm --filter @panel/web build


# ============================================================
# Stage 2: build the API (install deps, generate Prisma client, compile TS)
# ============================================================
FROM node:22-alpine AS api-build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN apk add --no-cache openssl
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
RUN pnpm install --filter @panel/api --frozen-lockfile

COPY apps/api ./apps/api
RUN cd apps/api && pnpm db:generate && pnpm build


# ============================================================
# Stage 3: runtime
# ============================================================
# We copy api-build's node_modules wholesale instead of pruning to a separate
# prod-deps stage. pnpm's .pnpm symlink layout is fragile to selective copies
# (the wildcard COPY against /repo/node_modules/.pnpm/@prisma+client* breaks
# in BuildKit). The size hit is acceptable for a self-hosted panel.
FROM node:22-alpine
RUN apk add --no-cache \
    openssl \
    ca-certificates \
    tini \
    git \
    docker-cli \
    docker-cli-compose
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# Workspace root files — needed for pnpm to resolve symlinks correctly.
COPY --from=api-build /repo/package.json ./package.json
COPY --from=api-build /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=api-build /repo/pnpm-lock.yaml ./pnpm-lock.yaml

# Root node_modules from the api-build stage — contains all pnpm-managed
# packages including the generated Prisma client.
COPY --from=api-build /repo/node_modules ./node_modules

# API-specific files
COPY --from=api-build /repo/apps/api/dist ./apps/api/dist
COPY --from=api-build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=api-build /repo/apps/api/package.json ./apps/api/
COPY --from=api-build /repo/apps/api/node_modules ./apps/api/node_modules

# Built SPA — served by Fastify in production
COPY --from=web-build /repo/apps/web/dist ./apps/web/dist

ENV NODE_ENV=production
ENV API_PORT=4000
ENV PANEL_WEB_DIST=/app/apps/web/dist
ENV PANEL_BACKUP_DIR=/data/backups

EXPOSE 4000

ENTRYPOINT ["/sbin/tini", "--"]

WORKDIR /app/apps/api
# Push the schema to the DB (idempotent, additive-safe) then start the API.
CMD ["sh", "-c", "pnpm exec prisma db push --schema=prisma/schema.prisma --skip-generate && exec node dist/index.js"]
