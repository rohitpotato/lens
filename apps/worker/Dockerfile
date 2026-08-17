FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# --- deps ----------------------------------------------------------------
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
COPY apps/worker ./apps/worker
COPY domains ./domains
COPY pipeline ./pipeline
RUN pnpm --filter @lens/worker build

# --- runtime -------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app/apps/worker
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages     /app/packages
COPY --from=build /app/apps/worker  /app/apps/worker
COPY --from=build /app/domains      /app/domains
COPY --from=build /app/pipeline     /app/pipeline
EXPOSE 9091
CMD ["node", "dist/index.js"]
