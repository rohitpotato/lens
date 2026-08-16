# Telemetry — Plan

**Status: not implemented. This document reserves the design decisions so we can pick it up cheaply when the deploy target is ready.**

Observability lives in the **infra repo**, not here. This repo's job is to:
1. Produce structured logs
2. Expose OpenTelemetry spans + Prometheus metrics
3. Assume the infra side has the LGTM stack (Loki + Grafana + Tempo + Mimir) already provisioned.

---

## 1. Stack

- **OpenTelemetry SDK** in every Node process (api, worker) — auto-instrumentation for HTTP, PostgreSQL, Redis, and custom spans for pipeline steps.
- **OTLP exporter** → OTel Collector or Grafana Alloy (whichever the infra repo runs).
- **Prometheus scrape endpoint** at `/metrics` on both api and worker. Metrics library: `prom-client`.
- **Pino** stays for structured logs — already in place, no change. Loki picks them up from pod stdout.

**Deliberate cut:** no APM SaaS (Datadog, New Relic). Grafana LGTM covers all three signals with one auth surface and one cost line.

---

## 2. Spans (Traces)

Root span per document: `document.process` (starts at upload, closes at first terminal status).

Child spans:

| Span | Attributes |
|---|---|
| `http.POST /documents` | request_id, ip, mime_type, sha256, dedup_hit |
| `image.to_pdf` | source_mime, source_bytes, output_bytes |
| `storage.put` | bucket, key, bytes |
| `db.tx.insert_document` | document_id |
| `pipeline.classify` | document_id, model, tokens_input, tokens_output, cost_usd, latency_ms, detected_type, confidence |
| `pipeline.extract` (pass 1 and pass 2) | document_id, model, tokens_input, tokens_output, cost_usd, latency_ms, hints_applied_count, overall_confidence |
| `pipeline.validate` | document_id, rules_evaluated, rules_failed, error_rules_failed |
| `hint.generate` | correction_id, document_type, vendor_key, field_path, tokens_input, tokens_output, cost_usd |
| `review.correct` | document_id, field_path, extraction_version_before, extraction_version_after |

Every LLM call is its own leaf span with a common attribute set — model, tokens, cost, latency, provider. That's the primary trace-view use case: "why did this doc take 40 seconds?"

Trace propagation: `traceparent` header from browser → api → worker via a `trace_id` column already on `events` table. Cross-service linking works out of the box once the OTel SDK is wired.

---

## 3. Metrics (Prometheus)

Business metrics — the ones a product manager watches:

| Metric | Type | Labels |
|---|---|---|
| `lens_extractions_total` | counter | `document_type`, `outcome=auto_approved\|pending_review\|failed` |
| `lens_extraction_cost_usd_total` | counter | `document_type`, `model` |
| `lens_extraction_duration_seconds` | histogram | `document_type`, `pass=1\|2` |
| `lens_extraction_confidence` | histogram | `document_type` |
| `lens_touchless_rate` | gauge | `document_type` (recomputed periodically from DB) |
| `lens_corrections_total` | counter | `document_type`, `field_path` |
| `lens_hints_suggested_total` | counter | `document_type` |
| `lens_hints_adopted_total` | counter | `document_type` |
| `lens_hints_ignored_total` | counter | `document_type` |

Pipeline health metrics:

| Metric | Type | Labels |
|---|---|---|
| `lens_queue_stream_length` | gauge | `stream` (each `lens:*` stream) |
| `lens_queue_consumer_lag` | gauge | `stream`, `group`, `consumer` |
| `lens_queue_pending_count` | gauge | `stream`, `group` |
| `lens_llm_requests_total` | counter | `model`, `provider`, `outcome=success\|error\|rate_limited` |
| `lens_llm_tokens_total` | counter | `model`, `direction=input\|output` |
| `lens_llm_request_duration_seconds` | histogram | `model` |

System metrics:

| Metric | Type | Labels |
|---|---|---|
| `lens_http_request_duration_seconds` | histogram | `method`, `route`, `status_code` |
| `lens_db_pool_active` | gauge | — |
| `lens_db_pool_waiting` | gauge | — |
| `lens_cost_cap_hits_total` | counter | — |
| `lens_rate_limit_hits_total` | counter | — |

Guardrail metrics matter — reviewers should see them fire on a dashboard, not discover them in logs after a bill spike.

---

## 4. Logs (Loki via pino)

Already in place — no changes needed to add Loki. Every log line goes through pino → JSON → stdout → containerd → Loki.

Required log fields (already emitted):
- `app` (`api` or `worker`)
- `consumer` (worker only; `classify` / `extract` / `hint`)
- `document_id`, `extraction_id`, `correction_id` where relevant
- `trace_id` (once OTel is wired)

**One convention we should enforce**: never log the full extracted JSON at INFO level — it may contain sensitive invoice content. Log field-level metadata (counts, confidence numbers) and log the full JSON at DEBUG only.

---

## 5. Grafana dashboards (owned by infra repo)

Three dashboards, JSON definitions live in `infra/dashboards/`:

1. **Business** — auto-approval rate over time, cost/doc trend, average confidence, top vendors by volume, corrections leaderboard, adopted-rules count trend.
2. **Pipeline** — per-step latency (P50/P95/P99), stream depths, LLM error rates by model, queue reclaim rate (`XCLAIM`).
3. **System** — HTTP metrics (API), DB pool, Redis health, cost cap + rate limit hit counts.

**Deliberate cut:** don't ship dashboards from this repo. Keeps deploy config in one place, and the infra team owns the version.

---

## 6. Alerts (owned by infra repo)

Anything paging-worthy:

- `lens_cost_cap_hits_total` rate > 0 → warn (user visible via 503, but ops wants to know)
- `lens_llm_requests_total{outcome="error"}` rate > 5/min → warn
- `lens_queue_pending_count > 20` for any group > 10 min → warn (workers stuck)
- `lens_extraction_confidence` P50 drops > 0.1 vs 24h ago → warn (something broke in extraction quality)
- API `/health/ready` failing → page

Same principle: definitions live in infra repo alongside the Prometheus rules.

---

## 7. What to implement first (when we pick this up)

Not all at once. Order of ROI:

1. **`prom-client` + `/metrics`** on api and worker with the LLM cost/token counters. One afternoon. Immediately answers "how much are we spending today?" without a DB query.
2. **`@opentelemetry/sdk-node` bootstrap** with auto-instrumentation. One afternoon. Now every HTTP + DB call has a span, and we can trace a slow request without adding spans manually.
3. **Manual spans on `pipeline.classify` / `pipeline.extract`** with cost/token attributes. Half a day.
4. **The remaining custom metrics** and the recomputed `touchless_rate` gauge (periodic background job). Half a day.
5. **Loki-friendly log-line cleanup** (audit for large JSON at INFO level). An hour.

**Explicitly do NOT ship** dashboards, alerts, or the collector config from this repo. Those belong in the infra repo, one integration point away.

---

## 8. Cost of this plan

- SDK bundles: ~500KB additional in api + worker (OTel is heavy, but node-only, no client impact).
- Runtime overhead: <1ms per traced call at auto-instrumentation defaults. Sampling ratio can be tuned in the infra collector config, not in code.
- Storage: metrics + traces + logs at our current volume ≪ 100MB/day even without retention tuning. Cheap.

Nothing here changes the code architecture — every counter/span/histogram lives inside existing seams (`extract.ts`, `queue/index.ts`, `documents.ts`). Ship whenever the deploy target is ready.
