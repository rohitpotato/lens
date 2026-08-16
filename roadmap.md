# Roadmap

What's deferred from the built system, grouped by why.

---

## Would ship next

Things we know are useful and defensible, but scope-cut for the current milestone.

- **SSE for live status updates.** Redis pub/sub → API `/events/stream` → browser `EventSource`, invalidating matching TanStack Query keys on event type. ~2h. Highest impact on the review workspace during demos where the reviewer watches a doc classify → extract → land in the queue in real time. Polling (5s dashboard, 15s queue) is fine for now.
- **Dead-letter surface + retry-from-UI.** A doc in `failed` status can currently only be re-run by `curl -F` uploading the same file again (dedup returns the existing id, does NOT re-process). Add `POST /documents/:id/retry` that re-publishes to `lens:document.uploaded`, and a "Retry" button on the review workspace. Consider auto-retrying dead-letters once after a fixed delay.
- **Currency + date-format hardening.** Currency enum currently hardcoded to USD/EUR/GBP/INR/JPY/AUD/CAD — expand. Add server-side `normalizeDate` on extraction output for non-ISO local formats (the helper already exists in `evals/src/import/docile-mapper.ts`, factor into `packages/pipeline`).
- **Manual-classification queue.** Docs with `status='needs_manual_classification'` currently show up in the recent activity feed but have no dedicated UI to set the type. Add a tab in the review workspace + a `POST /documents/:id/classify { type }` route.
- **Fixture promotion on substantive corrections.** Wired to be trivial — `lens:extraction.completed` and `lens:correction.applied` already fire; a background job could copy the PDF to `evals/fixtures/<id>/input.pdf`, write `expected.yaml` from the corrected extraction, mark `corrections.became_fixture=true`. Would grow the gold set from real reviewer behavior over time.

---

## Would ship after that

Real features but a bigger surface. Only pull in once we have a target user asking.

- **Cross-vendor rule promotion.** A background job that watches for N vendor-scoped hints on the same `field_path` with textually-similar `hint` content → suggests a schema-level `validations[]` rule (human-approved same as vendor-scoped hints). Turns per-vendor patterns into cross-corpus knowledge.
- **i18n scaffolding.** All UI strings behind `t()` via `react-i18next`. English strings extracted; ready to drop in a second locale. ~1h. Full localization (French/Spanish end-to-end) ~half day per language.
- **RTL layout support** (Arabic, Hebrew). Tailwind `[dir='rtl']` variants + component audit. ~half day.
- **In-UI upload failure cards** — right now, upload errors render as toasts. A persistent card on the doc's review page for corrupted PDFs, unknown types, and LLM refusals would give clearer next-step guidance (e.g. "retry with OCR" button).
- **Text-to-SQL** as a third `/query` tab, once structured output on schema-aware SQL reaches >80% accuracy on our fixtures. Pre-baked queries + Monaco console cover the demand today.
- **Argo Rollouts prompt canary** with eval F1 as an AnalysisTemplate. A prompt change deploys to 10% of extractions, eval runs against those, promotes if F1 doesn't regress. Belongs in the infra repo.
- **Content-aware dedup** — hash the extracted text digest + layout bounding boxes instead of file bytes. Would catch "same invoice rescanned as image" cases that SHA256 misses. Needs a similarity threshold.

---

## Would consider

Speculative or narrow — worth naming so we don't accidentally reinvent.

- **Multi-tenant** with per-tenant schemas + row-level security. Would need auth first.
- **Slack integration** — post a message when a hint suggestion appears / when a doc has been in `pending_review` > N hours.
- **Approval chains** for high-value invoices (total > $threshold requires two reviewers).
- **Original-image preservation** for uploaded PNG/JPEG (a `source_mime` column, a branched viewer). Rare need.
- **Model routing** — cheaper model on simple invoices, larger model on cluttered ones. Requires a "cluttered-ness" signal first.
- **Fine-tuned per-vendor extractors** for the top 10 vendors by volume. Cost/accuracy win at scale; overkill for one-off submissions.
