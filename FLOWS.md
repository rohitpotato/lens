# Lens — System Flows

How data moves through Lens. Includes every DB read/write, queue message,
LLM call, state transition, and the exact rules for learning scope, dedup,
idempotency, and correction propagation.

Read alongside [decisions.md](decisions.md) (why) and [TESTING.md](TESTING.md) (verification paths).

---

## 0. Vocabulary

| Term | Meaning |
|---|---|
| **document** | An uploaded file (PDF, or an image converted to PDF at ingest). One row in `documents`. Identified by `id` (UUID) and dedup'd by `file_hash` (SHA256 of bytes). |
| **extraction** | The structured output for a document. One row in `extractions` per document. Mutable — corrections update the row in place. |
| **correction** | A reviewer's edit to one field of an extraction. Immutable append-only row in `corrections` with `old_value`, `new_value`, and `corrected_at`. |
| **hint / rule** | A one-sentence rule in `prompt_hints` scoped to `(document_type, matching_key, field_path)`. Status is `suggested` (waiting for human) → `adopted` (injected into future extractions) or `ignored`. |
| **matching_key** | The normalized vendor name — lowercase, punctuation stripped, corporate suffixes (Inc/LLC/Ltd/Pvt/Corp) dropped. Same rule everywhere. |
| **detected_type** | `'invoice'` \| `'receipt'` \| `'unknown'`. Set by the classify step. Determines which schema + prompt the extract step loads. |

---

## 1. High-level topology

```
                    ┌─────────┐
   User / curl ────▶│  API    │──▶ Postgres (writes docs, events)
                    │(Fastify)│──▶ MinIO (stores file bytes)
                    │         │──▶ Redis Streams (publishes events)
                    └─────────┘
                                        │
                                        ▼
                    ┌──────────┐    Redis Streams   ┌──────────┐
                    │  Worker  │◀────consumers─────│  Streams  │
                    │(node/tsx)│                    └──────────┘
                    │          │──▶ Anthropic API (Sonnet + Haiku)
                    │          │──▶ Postgres (writes extractions, hints, events)
                    │          │──▶ MinIO (reads file bytes)
                    └──────────┘
                                        │
                                        ▼
                    ┌──────────┐
                    │   Web    │──── polls /api/... every 5-15s
                    │(React)   │
                    └──────────┘
```

Nothing is polled from the DB by the worker — every step is either an
inbound stream message or a fresh transaction. The API is stateless; all
state lives in Postgres, Redis Streams, and MinIO.

---

## 2. Upload flow

`POST /documents` (multipart, single file, ≤ 50MB)

### Step-by-step

1. **Pre-flight guards** (all in the API, before touching the file bytes):
   - Rate limit: per-IP token bucket via `@fastify/rate-limit` (default 30/hr). 429 if exceeded.
   - Cost cap: `checkCostGuard()` runs `SELECT COALESCE(SUM(cost_usd), 0) FROM extractions WHERE extracted_at >= NOW() - INTERVAL '24 hours'`. 503 if ≥ `LENS_DAILY_COST_USD`.
2. **Read the file into memory**, capped at 50MB (chunked read to catch oversized early). 413 on overflow.
3. **Image → PDF conversion** (if MIME is `image/png` or `image/jpeg`): `pdf-lib` embeds the image into a single-page PDF sized to the image aspect ratio. `mime` becomes `application/pdf`, filename gets `.pdf` extension. 400 with `code: image_conversion_failed` on failure.
4. **Hash + dedup**: `hash = SHA256(bytes)`. `SELECT ... FROM documents WHERE file_hash = ?`. If a row exists, return `{ id, status, dedup: true }` — no MinIO put, no DB insert, no stream publish.
5. **MinIO put**: key = `documents/YYYY/MM/<hash>.<ext>`. Content-type = `mime`.
6. **DB transaction**:
   - INSERT `documents` (status=`uploaded`) → returns `id`
   - INSERT `events` (`document.uploaded`, aggregate=`document`, aggregate_id=doc.id, payload={filename, sizeBytes, storagePath})
7. **Publish** to `lens:document.uploaded` Redis Stream: `{ documentId }`
8. **Return** `{ id, status: 'uploaded', dedup: false }`.

### DB reads / writes summary

| Read | Write |
|---|---|
| `documents WHERE file_hash = ?` | `documents INSERT` |
| `SUM(cost_usd)` from extractions (guard) | `events INSERT (document.uploaded)` |

### Dedup semantics + edge cases

- **Two vendors, same filename (`invoice-2025-04.pdf`)** — different bytes, different hashes, both stored. ✅
- **Same file uploaded twice** — same hash, dedup, returns existing id. ✅
- **Same invoice rescanned** — different bytes, different hash. Two rows, both processed. ⚠️
- **Same PNG uploaded once as PNG, once as JPEG** — different bytes (encoding), different hashes. Two rows. ⚠️
- **Two vendors' invoices with identical content** — same hash, dedup. Impossible in practice unless someone's copying files around. ⚠️

The last three are documented compromises. Hashing on rendered content
(text + layout digest) would catch scans and re-encodes but adds a real
compute step and doesn't cleanly return "which was the same one" without a
similarity threshold. SHA256 is the honest floor.

---

## 3. Classify step

Triggered by a message on `lens:document.uploaded`. Consumer group `classify`.

### Step-by-step

1. **Idempotency check**: `SELECT FROM pipeline_steps_completed WHERE document_id = ? AND step_name = 'classify'`. If a row exists, ack and return — safe replay.
2. **Load document**: `SELECT * FROM documents WHERE id = ?`. If missing, warn + ack.
3. **Update status**: `UPDATE documents SET status = 'classifying' WHERE id = ?`.
4. **Load classify prompt**: `SELECT * FROM prompts WHERE name = 'classify' ORDER BY version DESC LIMIT 1`.
5. **Read PDF bytes** from MinIO (`GET documents/YYYY/MM/<hash>.pdf`).
6. **Extract text**: `pdf-parse` on the first ~6000 characters. (Empty text → next step still runs, LLM will return `unknown` with low confidence.)
7. **LLM call**: `claude-haiku-4-5`, temperature 0, JSON-only response `{ type: 'invoice'|'receipt'|'unknown', confidence: 0..1 }`. Retry-once on JSON parse failure.
8. **Decide next status**:
   - `type` is known AND `confidence ≥ 0.7` → `documents.status = 'extracting'`, publish to `lens:document.classified`
   - Else → `documents.status = 'needs_manual_classification'`, NO publish
9. **DB transaction**:
   - UPDATE `documents` SET detected_type, detected_type_confidence, status
   - INSERT `events` (`document.classified`, payload={type, confidence, model, costUsd, latencyMs})
10. **Mark completed**: INSERT `pipeline_steps_completed (document_id, step_name='classify')` (UNIQUE constraint prevents dup).
11. **Ack** the stream message.

### DB reads / writes

| Read | Write |
|---|---|
| `pipeline_steps_completed (docId, 'classify')` | `documents UPDATE (status)` twice (start + end) |
| `documents WHERE id` | `events INSERT (document.classified)` |
| `prompts WHERE name = 'classify'` | `pipeline_steps_completed INSERT` |

### LLM cost + latency

- ~$0.001 per doc (Haiku, ~1-2K input tokens, tiny output)
- ~1-2s latency

---

## 4. Extract step

Triggered by `lens:document.classified`. Consumer group `extract`. Two-pass when adopted hints match the vendor.

### Step-by-step

1. **Idempotency check**: `pipeline_steps_completed (docId, 'extract')`. Skip if present.
2. **Load document**. Bail if `detected_type` is `unknown` or missing.
3. **Load schema**: `SELECT * FROM schemas WHERE name = <detectedType> AND is_active = true ORDER BY version DESC LIMIT 1`. Bail if none.
4. **Load extract prompt**: `SELECT * FROM prompts WHERE name = 'extract_<detectedType>' ORDER BY version DESC LIMIT 1`.
5. **Read PDF bytes** from MinIO.
6. **Pass 1 — extract without hints**:
   - Sonnet call with PDF as vision content + schema JSON injected into prompt template.
   - `hints: []`. Retry-once on JSON parse failure. If second attempt also fails → mark `documents.status = 'failed'`, ack.
7. **Look up adopted hints for the vendor** (only if extraction JSON has a name):
   - `vendorKey = normalizeVendor(extracted.vendor_name || extracted.merchant_name)`
   - `SELECT hint FROM prompt_hints WHERE document_type = <detectedType> AND matching_key = <vendorKey> AND status = 'adopted' AND is_active = true`
8. **Pass 2 (conditional)** — if hints matched:
   - Second Sonnet call with hints injected. Cost roughly doubles for this doc.
   - Pass 2's result replaces pass 1's.
9. **Validate**: evaluate the schema's `validations[]` block against the extracted JSON. Each rule yields `{name, severity, passed, message?, suggestsField?, suggestsValue?}`.
10. **Compute confidence** (per-field, then overall = `min(perField)`):
    - Signal 1 (weight 0.3): field value parses as declared type
    - Signal 2 (0.3): if required, field is present
    - Signal 3 (0.25): fraction of attributed rules that passed
    - Signal 4 (0.15): regex pattern matches (if pattern declared)
    - Weights renormalize when a signal doesn't apply.
11. **Decide status**:
    - No error-severity rule failed AND `overall ≥ 0.9` → `extraction.status = 'auto_approved'`, `documents.status = 'approved'`
    - Else → `extraction.status = 'pending_review'`, `documents.status = 'pending_review'`
12. **DB transaction**:
    - INSERT `extractions` (extracted_json, per_field_confidence, overall_confidence, validation_results, model_used, tokens_input, tokens_output, cost_usd, latency_ms, status, version=1)
    - UPDATE `documents` (status)
    - INSERT `events` (`extraction.completed`, payload={documentId, status, overallConfidence, costUsd, latencyMs, hintsApplied[]})
13. **Mark completed** + ack.
14. **Publish** to `lens:extraction.completed` (currently no consumers — future work for fixture promotion, etc.).

### DB reads / writes

| Read | Write |
|---|---|
| `pipeline_steps_completed (docId, 'extract')` | `documents UPDATE (status)` |
| `documents WHERE id` | `extractions INSERT` |
| `schemas WHERE name AND active` | `events INSERT (extraction.completed)` |
| `prompts WHERE name` | `pipeline_steps_completed INSERT` |
| `prompt_hints WHERE (doc_type, matching_key, status=adopted)` | |

### LLM cost + latency

- Single pass: ~$0.02, ~10s (Sonnet + PDF)
- Two-pass (adopted hints present for vendor): ~$0.04, ~20s

---

## 5. Review + correction flow

User opens `/review/:documentId` → PDF and fields render.

### View path (read-only)

- `GET /reviews/:documentId` → loads document + latest extraction + schema
- `GET /documents/:documentId/pdf` → API proxies bytes from MinIO to browser
- Fields panel auto-builds from schema JSON. Failed rules render as inline reconciliation cards with `[Accept]` button.

### Correction path

User edits a field OR clicks `[Accept]` on a reconciliation card.

1. `POST /reviews/:documentId/correct { fieldPath, newValue, expectedVersion? }`
2. **Load latest extraction**. If `expectedVersion` given and differs → 409 (optimistic concurrency).
3. **Load schema** (for re-validation).
4. **Patch in memory**: `setPath(extractedJson, fieldPath, newValue)`.
5. **Re-run validation + confidence** with the new value.
6. **DB transaction**:
   - INSERT `corrections` (extraction_id, field_path, old_value, new_value, correction_type='edit', corrected_by)
   - UPDATE `extractions` SET extracted_json, per_field_confidence, overall_confidence, validation_results, version = version + 1, updated_at
   - INSERT `events` (`correction.applied`)
7. **Publish** to `lens:correction.applied` — hint pipeline picks up async.
8. Response: updated extraction detail.

### Approve / reject paths

- `POST /reviews/:documentId/approve` → sets `extraction.status='approved'` + `documents.status='approved'` + `events (review.approved)`.
- `POST /reviews/:documentId/reject { reason }` → sets both to `rejected` + `events (review.rejected)` with reason.

---

## 6. Correction → hint → adopt → applied (the flagship)

Where the system actually learns.

### 6.1 Suggestion generation (worker consumer)

Triggered by `lens:correction.applied`.

1. Load doc + latest extraction to derive `documentType` and `vendorKey`. Publish payload already has both.
2. `vendorKey = normalizeVendor(vendor_name || merchant_name)`. If empty, skip (no vendor to scope to).
3. **Fetch prior corrections on same field**: `SELECT ... FROM corrections c JOIN extractions e ON e.id = c.extraction_id WHERE c.field_path = <fieldPath>` — then in JS filter to `normalizeVendor(e.extracted_json.vendor_name) === vendorKey`.
4. **Threshold check**: at least 1 (documented as demo-friendly; production would be 3+).
5. **Check for existing suggestion** on `(document_type, matching_key, field_path)`:
   - If a `suggested` or `adopted` hint already exists → just bump `evidence_count` and `updated_at`, done.
   - If an `ignored` hint exists → skip (don't re-suggest what a human dismissed).
6. **Load `generate_hint` prompt**.
7. **LLM call** (Haiku): prompt gets `{vendor, field, corrections[]}` and returns `{hint, note}`. Guardrails: empty hint on inconsistent-direction corrections, empty hint on insufficient signal.
8. If hint is non-empty: INSERT `prompt_hints` with `status='suggested'`, `evidence_count=N`, `created_from_correction_id=...`.

### 6.2 Human approval (UI)

`/rules` route.
- `GET /rules?status=suggested` → cards render with hint text, LLM rationale, evidence count.
- Buttons `[Adopt]` / `[Ignore]` / `[Modify]` → `POST /rules/:id/adopt` (or ignore, or PATCH).
- On Adopt: `UPDATE prompt_hints SET status='adopted', updated_at=NOW()`.

### 6.3 Hint application (next extract)

Already covered in §4 step 7: extract's second pass loads adopted hints for the extracted vendor+doc_type and injects them into the prompt.

### Learning scope — the important part

**Every hint is scoped strictly by `(document_type, matching_key)`.**

- A rule adopted for `(invoice, philip morris, total)` fires ONLY for invoices whose extracted vendor normalizes to `"philip morris"`.
- A rule adopted for `(receipt, ridgeway coffee, tax_amount)` does NOT influence invoice extractions at all, nor does it help any other receipt vendor.
- Cross-vendor generalization comes from the **schema's `validations[]` block**, which applies to every document of that type. Domain rules like "subtotal + tax + shipping - discount = total" generalize; vendor-specific quirks stay scoped.

**Why per-vendor is safer today:**
- Vendor patterns can be idiosyncratic (Philip Morris's credit-line convention, an Indian vendor's GST columns, a European vendor's inclusive VAT). Cross-applying would introduce silent errors that are hard to detect.
- The reviewer's mental model matches — they think "for AWS invoices, always X" not "for all invoices, always X."
- Ignored hints stay per-vendor. Cross-vendor would need cross-vendor "why was this ignored?" tracking.

**Why we'll want cross-vendor eventually:**
- A common correction pattern ("shipping is often listed as 'Freight' on the invoice") deserves promotion to the schema itself, not repeated adoption per vendor.
- Roadmap: a background job that watches for `N` adopted per-vendor hints on the same `field_path` with textually-similar hint content → suggest a schema-level validation-rule update. Human-approved same as vendor hints.

---

## 7. Idempotency — how replays stay safe

Every worker step has the same guarantee: **at least once, effectively once**.

- **Redis Streams** may redeliver on consumer crash. `XCLAIM` reclaims messages pending > 60s from a dead consumer.
- **Pre-check**: every step does `SELECT FROM pipeline_steps_completed WHERE document_id = ? AND step_name = ?` first. If a row exists, ack immediately.
- **Post-commit**: after the step's DB transaction commits, INSERT into `pipeline_steps_completed`. The UNIQUE `(document_id, step_name)` protects against two workers racing on the same message — the second insert loses on conflict and its downstream work rolls back cleanly on the next check-in.
- **Failure semantics**: if the step throws BEFORE marking complete, the message stays unacked → `XCLAIM` picks it up later → retry runs the LLM call again. LLM cost pays twice for that doc, which is the acceptable trade for "never fail silently."

The API's `POST /documents` is naturally idempotent via the `file_hash` UNIQUE index — same bytes never insert twice.

---

## 8. All state transitions

### Document status

```
uploaded
   │  classify consumer picks up
   ▼
classifying
   │  type known, confidence ≥ 0.7
   ├──────────────────────────┐
   │                          │
   ▼                          ▼
extracting              needs_manual_classification
   │  extract done            (manual triage — not yet UI'd)
   │
   │  auto_approve threshold met
   ├──────────────────────────┐
   │                          │
   ▼                          ▼
approved                pending_review
                              │  reviewer acts
                              ├──────────────────┐
                              │                  │
                              ▼                  ▼
                          approved            rejected

failed  ← reachable from `classifying` or `extracting` on unrecoverable LLM error
```

### Extraction status

```
auto_approved  ← set by extract step when confidence ≥ 0.9 and no error rules failed
pending_review ← default when the above condition isn't met
approved       ← human clicked Approve
rejected       ← human clicked Reject
```

### Hint status

```
suggested (new hint from worker)
    │
    ├─── [Adopt]  ──▶ adopted
    │                     │
    │                     └─── [Retire] ──▶ ignored
    │
    └─── [Ignore] ──▶ ignored  (dead end; new suggestions on the same
                                key will still be skipped)
```

---

## 9. Query surface

Two ways to read the structured data:

1. **Pre-baked insights**: 6 SQL files in `queries/`. `GET /query/insights` lists them; `POST /query/run` executes.
2. **Ad-hoc SQL**: Monaco editor on `/query`. Also `POST /query/run`.

Both paths execute inside a `SET LOCAL statement_timeout = 5000; SET LOCAL transaction_read_only = ON` transaction. Any DDL/DML fails with `code: read_only_violation`. 500-row cap on results.

---

## 10. Row updates cheat-sheet — every write in the system

Grouped by trigger:

**API `POST /documents`:**
- `documents INSERT` (once per unique file)
- `events INSERT (document.uploaded)`
- MinIO PUT
- Redis XADD `lens:document.uploaded`

**Worker classify consumer:**
- `documents UPDATE status` (twice: classifying, then either extracting or needs_manual_classification)
- `documents UPDATE detected_type, detected_type_confidence`
- `events INSERT (document.classified)`
- `pipeline_steps_completed INSERT (docId, 'classify')`
- Redis XADD `lens:document.classified` (conditional)
- Redis XACK on the input message

**Worker extract consumer:**
- `extractions INSERT` (once per doc processed)
- `documents UPDATE status` (approved or pending_review)
- `events INSERT (extraction.completed)`
- `pipeline_steps_completed INSERT (docId, 'extract')`
- Redis XADD `lens:extraction.completed`
- Redis XACK

**API `POST /reviews/:id/correct`:**
- `corrections INSERT`
- `extractions UPDATE` (extracted_json, per_field_confidence, overall_confidence, validation_results, version++, updated_at)
- `events INSERT (correction.applied)`
- Redis XADD `lens:correction.applied`

**Worker hint consumer:**
- Either `prompt_hints INSERT` (new suggestion) OR `prompt_hints UPDATE evidence_count` (reinforce existing)
- Redis XACK

**API `POST /reviews/:id/approve`:**
- `extractions UPDATE status='approved', reviewed_by, reviewed_at`
- `documents UPDATE status='approved'`
- `events INSERT (review.approved)`

**API `POST /reviews/:id/reject`:**
- Same as approve but `status='rejected'` and payload carries the reason.

**API `POST /rules/:id/adopt`|`/ignore`:**
- `prompt_hints UPDATE status, updated_at`

**API `PATCH /rules/:id`:**
- `prompt_hints UPDATE hint, updated_at`

**API startup (via services plugin):**
- `schemas UPSERT` — inserts a new row when `domains/<type>/schema.yaml` differs from latest active
- `prompts UPSERT` — same for `pipeline/prompts/*.md`

---

## 11. What's NOT here (deferred honestly)

- **Fixture promotion** on substantive corrections (a background job that would copy the PDF to `evals/fixtures/` and write `expected.yaml` from the corrected extraction). Wired to be trivial once we want it — `lens:extraction.completed` already fires.
- **Cross-vendor rule promotion** — see §6 "Why we'll want cross-vendor eventually."
- **`needs_manual_classification` queue** in the UI — docs go there in DB, but no dedicated review tab yet.
- **Failure-mode UX cards** (retry-with-OCR button for corrupted PDFs, etc.) — covered by the recent-activity feed + toast for now.
