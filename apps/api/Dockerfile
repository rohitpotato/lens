FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# --- deps ----------------------------------------------------------------
# Copy EVERY workspace package.json + the root lockfile. pnpm --frozen-lockfile
# needs every workspace member the lockfile references, or install rejects.
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
COPY packages ./packages
COPY apps/api ./apps/api
# Runtime reads these from disk on startup (resolve paths in services.ts).
COPY domains ./domains
COPY pipeline ./pipeline
RUN pnpm --filter @lens/api build

# --- runtime -------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
# CWD must be apps/api so the plugin's ../../{domains,pipeline} resolves
# to /app/{domains,pipeline} — same shape as local dev.
WORKDIR /app/apps/api
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages     /app/packages
COPY --from=build /app/apps/api     /app/apps/api
COPY --from=build /app/domains      /app/domains
COPY --from=build /app/pipeline     /app/pipeline
EXPOSE 3001
CMD ["node", "dist/index.js"]
