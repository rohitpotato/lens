FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# --- deps ----------------------------------------------------------------
# `pnpm install --frozen-lockfile` at workspace root fails unless every
# workspace member's package.json is present (lockfile references all).
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json      ./apps/api/
COPY apps/web/package.json      ./apps/web/
COPY apps/worker/package.json   ./apps/worker/
COPY packages/db/package.json       ./packages/db/
COPY packages/llm/package.json      ./packages/llm/
COPY packages/metrics/package.json  ./packages/metrics/
COPY packages/pipeline/package.json ./packages/pipeline/
COPY packages/queue/package.json    ./packages/queue/
COPY packages/storage/package.json  ./packages/storage/
COPY evals/package.json         ./evals/
RUN pnpm install --frozen-lockfile

# --- build ---------------------------------------------------------------
FROM deps AS build
COPY apps/web ./apps/web
RUN pnpm --filter @lens/web build

# --- runtime -------------------------------------------------------------
FROM nginx:alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
