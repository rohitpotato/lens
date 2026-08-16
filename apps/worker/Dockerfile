FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/llm/package.json ./packages/llm/
COPY packages/queue/package.json ./packages/queue/
COPY packages/storage/package.json ./packages/storage/
COPY packages/pipeline/package.json ./packages/pipeline/
COPY apps/worker/package.json ./apps/worker/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages ./packages
COPY apps/worker ./apps/worker
COPY pipeline ./pipeline
COPY domains ./domains
RUN pnpm --filter @lens/worker build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/
COPY --from=build /app/pipeline ./pipeline
COPY --from=build /app/domains ./domains
CMD ["node", "apps/worker/dist/index.js"]
