# Lens

Turn messy invoices into structured, queryable data.

## Quickstart

```bash
make install
make up          # postgres, redis, minio
make dev         # api + worker + web
```

Requires Node 22 and pnpm 9.

## Layout

- `apps/api` — Fastify HTTP API
- `apps/worker` — pipeline consumer
- `apps/web` — React frontend
- `packages/db` — Drizzle schema + client
- `packages/schemas` — shared Zod types
- `packages/llm` — LLM provider abstraction
- `pipeline/` — extraction pipeline steps
- `domains/` — schema and validators per document type
- `evals/` — eval harness and fixtures
