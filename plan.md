Understood. Handing off to another agent means the doc has to stand on its own — every decision, every "why," every edge case we discussed, plus enough spec detail that the agent doesn't have to invent things. This will be long. I'll split into logical sections so you can drop it into a Notion doc or the repo's `PLAN.md`.

I'll write it as a single document, in the voice of "the person who thought through this," so the receiving agent inherits the reasoning. It's yours to attribute however you want.

---

# Project Plan — Zamp Engineering Round, Problem 3

## 0. Context and how to read this document

This is a build plan for a submission to Zamp's engineering project round. The problem chosen is Problem 3: *"Turn messy documents into structured, queryable data."* This document is meant to be handed to a coding agent (Claude Code, Cursor, or similar) that will do a large portion of the implementation. A human engineer will drive the parts that matter for interview defense — extraction pipeline design, confidence computation, review UX, eval harness, event log — and delegate the rest.

The doc contains:
- Product framing and user
- Non-negotiable design principles
- Full architecture (data model, services, pipeline, UI, eval, observability)
- Day-by-day build plan
- What to write in `decisions.md` and `roadmap.md`
- Explicit cuts and why

The receiving agent should read the whole doc before writing any code. Every section informs every other.

---

## 1. Product framing

### The user

Priya, a controller at a mid-sized company. Every month, ~300 vendor invoices arrive in her inbox. She reviews each, extracts the fields her accounting system needs (vendor, invoice number, date, total, line items), and enters them by hand. It takes her 25-50 hours a month. The work is not hard — it is copy-paste with the risk of costly mistakes. This is exactly the "brilliant person as flesh-based infrastructure" problem Zamp's manifesto identifies.

The product's job: process invoices automatically with confidence, surface only the uncertain ones for human review, and get better every time Priya corrects something.

### The scope statement

> This submission is a scoped end-to-end system that demonstrates the primitives Problem 3 hints at: **schema as versioned artifact, confidence from validation rather than model self-report, eval-driven regression prevention, correction as first-class training data, and entity resolution across the corpus.** The novelty is not in any one component; it is in the coherence of the pipeline and the specific engineering decisions that make each layer verifiable.

This paragraph goes at the top of `decisions.md` and is the anchor for every subsequent decision.

### What we deliberately are not building

- Text-to-SQL. Structured output is more reliable than natural language querying at this scale. Ten pre-baked queries plus a raw SQL console do the same job with no hallucination risk.
- Multi-tenant auth. Single shared password on the deployed URL. Sufficient for the reviewer, honest about being minimal.
- Full production-grade PDF ingestion (Docling, Unstructured). Standard libraries with a specific fallback path. Explicitly noted as the first swap for production.
- General document types beyond invoices in v1. Receipts added on day 10 as extensibility proof.
- Full syscall-level agent sandboxing. Out of scope; noted in roadmap.
- OCR for handwriting. Only typed/printed text.

Each of these is called out in `decisions.md` with the reasoning.

---

## 2. Non-negotiable design principles

These principles govern every implementation decision. When the agent has a choice, it defaults to the principle.

1. **Every artifact that matters is versioned.** Schemas, prompts, extractions, corrections, eval fixtures. Nothing is edited in place; changes create new versions with references to their predecessor.

2. **Confidence comes from signals, not self-report.** The LLM's stated confidence is never used directly. Confidence is derived from validation rules, cross-checks, type parsing, and required-field presence.

3. **Corrections are first-class data.** Every correction updates a per-source hint that improves future extractions, becomes a new eval fixture, and is logged with an audit trail.

4. **The eval harness catches regressions before code merges.** Every prompt change, model change, or schema change runs the eval and posts a diff to the PR. Regressions block merge.

5. **Human review is a state, not a modal.** Documents transition through explicit states (`extracted → pending_review → approved` or `rejected`). Review is a first-class workflow, not a popup.

6. **Every user-visible action is keyboard-first.** Tab, Enter, Cmd+E, Cmd+Enter. The review workspace should let a user work through 20 documents in 10 minutes without touching the mouse.

7. **The pipeline is event-sourced.** Each state transition writes an immutable event. Replays are deterministic. Debugging is looking at the event log.

8. **The system degrades visibly.** Every failure (rate limit, timeout, malformed doc, unknown type) shows up somewhere in the UI with an actionable next step. Silent failures are the enemy.

9. **Prompts and schemas live as files, not string literals.** They are diffed in git, PR-reviewed, and pinned by version.

10. **First-run experience is populated.** On cold start, 30 fixtures are seeded so a reviewer landing on the URL sees a working system, not an empty upload button.

---

## 3. Architecture

### 3.1 Services

Three services, all in one monorepo:

**API service** (`apps/api`): Fastify + TypeScript. Serves the REST API for the frontend. Handles uploads, retrieves extractions, records corrections, exposes queue-management endpoints. Runs schema validation on all requests via Zod. Emits OpenTelemetry traces and Prometheus metrics.

**Worker service** (`apps/worker`): Same Node codebase, different entrypoint (`bin/worker.ts`). Reads from Redis Streams. Runs the extraction pipeline. Writes results back to Postgres. Emits its own traces and metrics.

**Web app** (`apps/web`): Vite + React 18 + TypeScript. Radix UI primitives + Tailwind. Custom PDF viewer overlay. No shadcn scaffolds (interview signal: hand-crafted).

Everything is TypeScript. Shared types live in `packages/schemas` and `packages/contracts` so FE and BE stay in sync.

### 3.2 Data stores

**Postgres 16**: primary datastore. Managed via Drizzle ORM. Migrations via Drizzle Kit.

**Redis 7**: queue (Streams) + cache + rate limiter (bottleneck-style).

**S3-compatible object storage**: PDFs and images. Local dev uses MinIO in docker-compose. Production points at S3 or the K8s cluster's storage class. Interface via `@aws-sdk/client-s3`.

### 3.3 Database schema

```sql
-- Schemas: versioned document type definitions
CREATE TABLE schemas (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,              -- 'invoice', 'receipt'
  version INTEGER NOT NULL,
  yaml_definition TEXT NOT NULL,   -- full YAML as text
  compiled_json JSONB NOT NULL,    -- parsed for query
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (name, version)
);

-- Prompts: versioned prompt files
CREATE TABLE prompts (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,              -- 'extract_invoice', 'classify'
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  model TEXT NOT NULL,             -- 'claude-sonnet-4-6', 'claude-haiku-4-5'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (name, version)
);

-- Documents: uploaded files
CREATE TABLE documents (
  id UUID PRIMARY KEY,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,      -- S3/MinIO key
  file_hash TEXT NOT NULL,         -- SHA256, for dedup
  page_count INTEGER,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  detected_type TEXT,              -- 'invoice', 'unknown'
  detected_type_confidence NUMERIC,
  status TEXT NOT NULL DEFAULT 'uploaded',
    -- 'uploaded', 'classifying', 'extracting', 'extracted',
    -- 'pending_review', 'approved', 'rejected', 'failed'
  UNIQUE (file_hash)
);

-- Extractions: immutable; corrections create new versions
CREATE TABLE extractions (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id),
  schema_id UUID NOT NULL REFERENCES schemas(id),
  prompt_id UUID NOT NULL REFERENCES prompts(id),
  parent_extraction_id UUID REFERENCES extractions(id),  -- for corrections
  extracted_json JSONB NOT NULL,
  per_field_confidence JSONB NOT NULL,   -- { "vendor_name": 0.98, ... }
  overall_confidence NUMERIC NOT NULL,
  validation_results JSONB NOT NULL,     -- rule name → pass/fail/warning
  model_used TEXT NOT NULL,
  tokens_input INTEGER,
  tokens_output INTEGER,
  cost_usd NUMERIC,
  latency_ms INTEGER,
  status TEXT NOT NULL,                  -- 'auto_approved', 'pending_review', 'approved', 'rejected'
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX ON extractions (document_id, extracted_at DESC);
CREATE INDEX ON extractions (status, overall_confidence);

-- Corrections: audit trail of every change
CREATE TABLE corrections (
  id UUID PRIMARY KEY,
  extraction_id UUID NOT NULL REFERENCES extractions(id),
  field_path TEXT NOT NULL,        -- 'total', 'line_items[2].amount'
  old_value JSONB,
  new_value JSONB,
  correction_type TEXT NOT NULL,   -- 'edit', 'delete', 'add'
  note TEXT,
  corrected_by TEXT NOT NULL,
  corrected_at TIMESTAMPTZ DEFAULT NOW(),
  became_fixture BOOLEAN DEFAULT false,
  fixture_id TEXT                  -- populated when correction is promoted to eval fixture
);

-- Prompt hints: per-source overrides learned from corrections
CREATE TABLE prompt_hints (
  id UUID PRIMARY KEY,
  document_type TEXT NOT NULL,     -- 'invoice'
  matching_key TEXT NOT NULL,      -- vendor name normalized, e.g. 'aws'
  field_path TEXT NOT NULL,        -- 'total'
  hint TEXT NOT NULL,              -- 'grand total after credits, labeled "Amount Due" on final page'
  created_from_correction_id UUID REFERENCES corrections(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Entities: canonical named things
CREATE TABLE entities (
  id UUID PRIMARY KEY,
  entity_type TEXT NOT NULL,       -- 'vendor'
  canonical_name TEXT NOT NULL,
  embedding VECTOR(1536),          -- pgvector
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (entity_type, canonical_name)
);

-- Entity mentions: raw values → canonical entities
CREATE TABLE entity_mentions (
  id UUID PRIMARY KEY,
  entity_id UUID NOT NULL REFERENCES entities(id),
  extraction_id UUID NOT NULL REFERENCES extractions(id),
  field_path TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  confidence NUMERIC NOT NULL,
  resolved_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event log: append-only, for durable execution and audit
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,        -- 'document.uploaded', 'extraction.completed', etc.
  aggregate_type TEXT NOT NULL,    -- 'document', 'extraction'
  aggregate_id UUID NOT NULL,
  payload JSONB NOT NULL,
  trace_id TEXT,                   -- OTel trace ID for correlation
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON events (aggregate_type, aggregate_id, created_at);
CREATE INDEX ON events (event_type, created_at DESC);

-- Eval runs: history of eval executions
CREATE TABLE eval_runs (
  id UUID PRIMARY KEY,
  git_sha TEXT NOT NULL,
  ran_at TIMESTAMPTZ DEFAULT NOW(),
  fixtures_total INTEGER NOT NULL,
  fixtures_passed INTEGER NOT NULL,
  overall_f1 NUMERIC,
  regressions JSONB,               -- fixture_ids that got worse
  improvements JSONB,              -- fixture_ids that got better
  cost_usd NUMERIC,
  report_markdown TEXT,
  triggered_by TEXT                -- 'manual', 'ci', 'schema_change'
);
```

Notes for the agent implementing this:
- Use `pgvector` extension for embeddings. Enable via `CREATE EXTENSION vector;` in the initial migration.
- Every mutation goes through an `events.append()` helper that writes to the `events` table in the same transaction as the mutation. No mutation is committed without an event.
- Extractions are immutable. To "correct" an extraction, you insert a new row with `parent_extraction_id` pointing to the previous one, plus insert `corrections` rows for the specific field diffs.

### 3.4 Domain files (schemas and prompts)

Schemas live in `domains/<type>/schema.yaml`. On startup, the API service parses these YAML files, compares to the DB, and creates new schema versions for any that changed. This means schema changes go through git.

```yaml
# domains/invoice/schema.yaml
name: invoice
version: 1
description: A vendor invoice with header fields and line items.
fields:
  vendor_name:
    type: string
    required: true
    description: The legal name of the entity issuing the invoice.
    normalize:
      via: entity_resolution
      entity_type: vendor
  vendor_address:
    type: string
    required: false
  invoice_number:
    type: string
    required: true
    pattern: '[A-Za-z0-9\-\/]+'
    description: The unique identifier for this invoice from the vendor.
  invoice_date:
    type: date
    required: true
    format: iso8601
  due_date:
    type: date
    required: false
    format: iso8601
  currency:
    type: enum
    values: [USD, EUR, GBP, INR, JPY, AUD, CAD]
    default: USD
  subtotal:
    type: money
    required: false
  tax_amount:
    type: money
    required: false
  tax_percentage:
    type: number
    required: false
  total:
    type: money
    required: true
    description: The grand total the recipient owes, after all taxes and credits.
  line_items:
    type: list
    required: false
    element:
      description:
        type: string
        required: true
      quantity:
        type: number
        required: false
      unit:
        type: string
        required: false
      unit_price:
        type: money
        required: false
      amount:
        type: money
        required: true
validations:
  - name: line_items_sum_to_subtotal
    rule: 'abs(sum(line_items[*].amount) - subtotal) < 0.01'
    severity: warning
    applies_if: 'line_items != null && subtotal != null'
  - name: subtotal_plus_tax_equals_total
    rule: 'abs((subtotal || 0) + (tax_amount || 0) - total) < 0.01'
    severity: warning
    applies_if: 'total != null'
  - name: due_date_after_invoice_date
    rule: 'due_date >= invoice_date'
    severity: error
    applies_if: 'due_date != null'
  - name: total_is_positive
    rule: 'total > 0'
    severity: error
```

Prompts live in `pipeline/prompts/<name>.v<n>.md`. Each is a markdown file with front-matter for metadata:

```markdown
---
name: extract_invoice
version: 1
model: claude-sonnet-4-6
temperature: 0.0
---

You are extracting structured data from an invoice PDF. Extract fields into the schema provided below.

Rules:
1. If a field is not present in the document, return null. Do not guess.
2. For monetary values, extract the number without currency symbols. Include the currency separately.
3. The "total" is the final amount the recipient owes, after all taxes and credits. If the document shows a subtotal, taxes, and a grand total, "total" is the grand total.
4. For line items, extract every visible row in the primary line-item table. Skip subtotal and tax rows.
5. Dates in ISO 8601 format (YYYY-MM-DD). If the year is ambiguous, prefer the most recent past year.

Schema:
{schema_json}

Vendor-specific hints (if any):
{prompt_hints}

Return only the JSON object matching the schema. No prose.
```

The `{schema_json}` and `{prompt_hints}` placeholders are string-replaced at runtime.

### 3.5 The extraction pipeline

The pipeline is a sequence of async steps, each producing an event on completion:

```
uploaded → classifying → extracting → validating → resolving_entities → complete
                                                                   ↓
                                                     pending_review OR auto_approved
```

Every step is idempotent (checks completion status before starting) and can be retried without side effects.

**Step 1: Classify.** Input: document ID. Output: `detected_type` + confidence.

- Extract first 2 pages of text via `pdf-parse`. If empty (scanned), rasterize page 1 and send to a vision model.
- Send text sample to Haiku 4.5 with a classifier prompt: "which document type is this: invoice, receipt, or unknown."
- Persist result to `documents.detected_type`.
- If confidence < 0.7, emit `document.needs_manual_classification`. Do not proceed to extraction.

**Step 2: Extract.** Input: document ID + detected type. Output: extraction row.

- Load active schema for detected type. Load latest active prompt for `extract_<type>`.
- Load any active `prompt_hints` matching this document's `vendor` (once we know it — first pass has no vendor, so pass none; second pass after entity resolution can re-extract with hints).
- Build the prompt: base template + injected schema JSON + injected hints.
- Send PDF (as base64 for vision) or extracted text to Sonnet 4.6.
- Parse response as JSON. If parsing fails, retry once with the parse error appended to the prompt. If still fails, emit `extraction.failed` and stop.
- Compute per-field confidence (see 3.6).
- Insert `extractions` row with all metadata (model, tokens, cost, latency).

**Step 3: Validate.** Input: extraction ID. Output: validation results attached.

- Load schema's validation rules.
- Evaluate each rule against the extracted data.
- Store results in `extractions.validation_results`.
- Rules with severity `error` that fail → force `pending_review`.
- Rules with severity `warning` → lower confidence but don't force review.

**Step 4: Resolve entities.** Input: extraction ID. Output: entity mentions inserted.

- For each field marked `normalize: entity_resolution` in the schema, run the resolver (see 3.7).
- Insert `entity_mentions` rows.
- If any entity has confidence < threshold, emit `entity.needs_review`.

**Step 5: Route to review or auto-approve.**

- If `overall_confidence >= AUTO_APPROVE_THRESHOLD` (default 0.9) AND no `error`-severity validation failures AND no unresolved entities → mark extraction `auto_approved`.
- Else → mark `pending_review`, add to review queue.

Each step reads its input from Postgres, does its work, writes its output to Postgres in a transaction that also writes an event, and publishes the next step's message to Redis Streams.

### 3.6 Confidence computation

Per-field confidence is a weighted combination of signals:

```
signal 1: schema_type_match       (0 or 1)  — does the value parse as the declared type?
signal 2: required_field_present  (0 or 1)  — if required, is it present?
signal 3: validation_rules_passed (0 to 1)  — fraction of rules touching this field that passed
signal 4: cross_check_agreement   (0 to 1)  — for critical fields, we run a second cheap extraction with a different prompt; do they agree?
signal 5: pattern_match           (0 or 1)  — for fields with regex patterns, does the value match?
```

Weights: 0.25, 0.25, 0.2, 0.2, 0.1. Sum = 1.

Fields flagged for cross-check (defined in schema): `total`, `invoice_number`, `invoice_date`. The cross-check calls Haiku (cheap) with a one-shot prompt: "what is the [field] on this invoice, one line answer." String similarity against the Sonnet extraction.

Overall confidence: min of per-field confidences (weakest link).

**Explicit non-choice**: we do not use the LLM's self-reported confidence. Note in `decisions.md`: *"Model self-reported confidence is uncalibrated and correlates poorly with actual correctness. We derive confidence from structural signals that are independently verifiable."*

### 3.7 Entity resolution

For each field marked `normalize: entity_resolution`:

1. Normalize the raw value: lowercase, strip punctuation, strip common suffixes (`Inc`, `LLC`, `Ltd`, `Pvt Ltd`, `Corp`), collapse whitespace.
2. Look up exact match in `entities` (by canonical_name + entity_type). If found, record mention, done.
3. Compute embedding of normalized value via `text-embedding-3-small`.
4. Nearest-neighbor search over `entities.embedding` limited to same `entity_type`, top-5 by cosine similarity.
5. If top match's similarity >= 0.92 → auto-resolve, record mention.
6. If top match's similarity in [0.85, 0.92) → mark for human review with candidates.
7. If below 0.85 → create new entity, record mention.

The review path: on the review workspace, when a document has an unresolved entity, one of the review fields shows a dropdown with the top 5 candidates plus "create new."

### 3.8 The review workspace (frontend)

Route: `/review`.

Layout: three columns.

**Left column (queue, ~20% width):**
- Ordered list of documents pending review.
- Sort key: (has_error_validation ? 0 : 1) × 100 + (1 - overall_confidence) × 10 + age_days
- Each row: filename, vendor (if resolved), total (if extracted), a colored strip showing overall confidence.
- Keyboard: `j`/`k` to move, `Enter` to open.

**Middle column (source PDF, ~40% width):**
- `react-pdf` rendered PDF.
- Overlay canvas that draws highlight rectangles when a field on the right is hovered or focused.
- Bounding boxes come from the extraction step: when Sonnet extracts, we also ask it to return `bbox: [page, x, y, width, height]` for each field.
- Pan/zoom controls, page navigation with `[` and `]`.

**Right column (extracted fields, ~40% width):**
- Form matching the schema structure. Header fields, then line items table.
- Each field: label, current value, confidence strip, edit button.
- Focused field is highlighted (blue outline) and its PDF region highlights automatically.
- Keyboard: `Tab` moves focus, `Enter` confirms current, `Cmd+E` enters edit mode, `Esc` cancels edit, `Cmd+Enter` approves whole document and loads next, `Cmd+R` rejects, `Cmd+Z` undoes last edit.
- Validation failures show inline: red badge on the field, tooltip with the rule name.
- Unresolved entities show as a dropdown of candidates.
- Bottom-right: a persistent status bar with "Reviewed: 47 / Backlog: 23 / Session time: 12m" so a reviewer sees their pace.

**First-run experience:** if the queue is empty, show a helpful zero-state with a "Upload sample invoices" button that seeds 10 fixture documents. Do not show an empty page.

### 3.9 The dashboard (`/`)

Route: `/`. This is the landing page.

Above the fold:
- One giant metric: "Auto-approval rate this week: 73% (↑ 4% from last)" as the hero.
- Sub-metrics: total processed, average confidence, average cost, average review time.
- A recent-activity list: last 10 documents with status.
- Big buttons: "Upload documents" and "Open review queue (23)".

Below the fold: a small Grafana iframe (or link) showing the dashboard, and a "System health" widget pulling from `/api/health`.

### 3.10 The query interface (`/query`)

Route: `/query`.

Two tabs:

**Insights tab:** ten pre-baked queries, each rendered as a card with a title, a small chart or table, and a "run" button.

Examples:
- "Top 10 vendors by spend, last 90 days"
- "Invoices with mismatched totals" (line items don't sum to total)
- "Duplicate suspects" (same vendor + amount + date within 3 days)
- "Overdue invoices" (due_date past, not marked paid)
- "Currency mix this quarter"
- "Auto-approval rate by vendor"
- "Average confidence by vendor (last 30 days)"
- "Extraction cost by document type"
- "Correction hotspots" (which fields get corrected most)
- "New vendors this month"

Each query is a SQL string in `queries/<slug>.sql` — versioned, git-tracked, executable read-only.

**SQL tab:** a Monaco editor connected to a read-only Postgres user. Reviewer can write arbitrary SELECT queries. Schema browser in a side panel.

### 3.11 The eval harness

Located in `evals/`.

**Fixture format:**

```
evals/fixtures/inv_0001/
  input.pdf                    # the actual PDF
  expected.yaml                # ground truth
  metadata.yaml                # { source: 'docile', vendor: 'aws', difficulty: 'hard', features: ['multi-page', 'credit-memo'] }
```

`expected.yaml` matches the schema structure exactly:

```yaml
vendor_name: "Amazon Web Services, Inc."
invoice_number: "INV-2024-3312"
invoice_date: "2024-03-01"
due_date: "2024-03-31"
currency: "USD"
subtotal: 12450.00
tax_amount: 652.50
total: 13102.50
line_items:
  - description: "EC2 On-Demand Instances"
    amount: 8420.15
  - description: "S3 Storage"
    amount: 1234.85
  # ...
```

**Runner (`bin/eval`)** is a Node script:

1. Loads all fixtures (or a subset via CLI flag).
2. For each fixture: runs the current pipeline (loads latest active schema + prompt), gets extraction result.
3. Compares extraction to `expected.yaml` field-by-field using field-type-aware matching:
   - Strings: exact match, then normalized match (lowercase, strip punctuation)
   - Money: within 0.01
   - Dates: exact ISO match
   - Enums: exact match
   - Lists: match each element, order-independent for line items with a Hungarian-like assignment on `description` similarity
4. Computes per-field score (0 or 1), then per-fixture F1 across all fields.
5. Loads previous baseline from `evals/reports/baseline.json`.
6. Identifies regressions (fixtures whose F1 dropped by > 0.02) and improvements (F1 rose by > 0.02).
7. Writes markdown report to `evals/reports/<timestamp>.md`.
8. Prints summary. Exits non-zero if regressions exist and `--block-on-regression` flag is set.

**Cost control**: response cache keyed by `(fixture_id, prompt_version, model)`. Second run against unchanged prompt is free. Cache lives in `evals/.cache/`, git-ignored.

**GitHub Action (`.github/workflows/eval.yml`)**:

```yaml
on:
  pull_request:
    paths:
      - 'pipeline/prompts/**'
      - 'domains/**/schema.yaml'
      - 'pipeline/**'
      - 'evals/**'
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - checkout
      - install pnpm and deps
      - restore eval cache
      - run bin/eval --block-on-regression --format github
      - post the report as PR comment
      - save cache
```

**In-app view (`/evals`):** shows the last 20 eval runs with sparklines of overall F1, per-document-type F1, cost per run. Click a run → see the full markdown report. Diff two runs → see which fixtures changed.

### 3.12 The correction → fixture pipeline

This is the piece that makes the whole system worth building. Named explicitly in `decisions.md` as the primary engineering contribution.

Flow:

1. Reviewer corrects a field on document `doc_47` in the workspace.
2. On save, three things happen atomically:
   - `corrections` row inserted with old/new values.
   - A new `extractions` row inserted with `parent_extraction_id = old_id` and the corrected value applied.
   - An event `correction.applied` written to the event log.
3. If this is the third correction on this vendor's `total` field in the last 30 days (query threshold), a background job:
   - Generates a `prompt_hint` for that vendor+field via a small LLM call: "Based on these three corrections, what pattern should the extractor learn?"
   - Inserts into `prompt_hints`. From next extraction of this vendor, the hint is injected into the extraction prompt.
4. A background job also considers promoting the corrected extraction to an eval fixture:
   - If this document isn't already a fixture, if the correction was substantive (not just a typo fix), and if the document's vendor is under-represented in fixtures → promote.
   - Promotion means: copy the PDF to `evals/fixtures/<new_id>/input.pdf`, write `expected.yaml` from the corrected extraction, write `metadata.yaml`.
   - Mark `corrections.became_fixture = true` and store the fixture path.
5. On next eval run, the new fixture is included. Any future prompt change that would re-break this extraction is caught before merge.

This is what "corrections are first-class training data" means in practice. Reviewers should be able to see the trail: correction → hint → future extraction improved → fixture guards it going forward.

### 3.13 Observability

**Stack**: OpenTelemetry SDK in Node → OTLP exporter → Grafana Alloy (or OTel Collector) → Loki (logs) + Tempo (traces) + Mimir/Prometheus (metrics).

For POC (before infra day): docker-compose brings up the LGTM stack locally. All three services export to it. Grafana dashboards checked into `dashboards/` are provisioned automatically.

**Instrumentation:**

Traces: root span per document (`document.process`), child spans per pipeline step (`pipeline.classify`, `pipeline.extract`, etc.). Every LLM call is its own span with attributes for model, tokens, cost.

Metrics (Prometheus format, exposed on `/metrics`):

Business:
- `extraction_duration_seconds` (histogram): labels `document_type`, `model`, `outcome`
- `extraction_cost_usd_total` (counter): labels `model`, `document_type`
- `extraction_confidence` (histogram): labels `document_type`
- `extraction_auto_approved_total` (counter): labels `document_type`
- `extraction_pending_review_total` (counter): labels `document_type`
- `extraction_validation_failure_total` (counter): labels `document_type`, `rule`, `severity`

Review:
- `review_action_duration_seconds` (histogram): labels `action`
- `review_corrections_total` (counter): labels `document_type`, `field_path`
- `review_queue_depth` (gauge): labels `document_type`

Pipeline:
- `queue_lag_messages` (gauge): labels `stream`, `consumer_group`
- `llm_tokens_total` (counter): labels `model`, `direction`
- `llm_request_duration_seconds` (histogram): labels `model`
- `llm_errors_total` (counter): labels `model`, `error_type`

Eval:
- `eval_overall_f1` (gauge)
- `eval_regression_count` (gauge)

**Grafana dashboards** (JSON in `dashboards/`, auto-provisioned):

1. **Business**: auto-approval rate over time, cost per doc, review time saved, confidence distribution.
2. **Pipeline**: latency by step, queue depth, model health, error rates.
3. **System**: HTTP request metrics, DB connection pool, Redis health.

### 3.14 Failure modes and graceful degradation

Every failure mode below is called out in `decisions.md` and has a specific handling strategy:

**Corrupted PDF**: parser throws. Document status → `failed`, error surfaced in UI with a "retry with OCR" button. Not silent.

**Unknown document type**: classifier confidence < 0.7. Status → `needs_manual_classification`. Shows in queue with a "select type" dropdown.

**Huge file (> 50MB)**: reject at upload with 413. In UI, show a specific error message. Above threshold documented in `decisions.md` — chosen to bound memory and LLM cost.

**LLM rate limit (429)**: exponential backoff with jitter, up to 5 retries. Metric emitted. Document stays in `extracting` state. If all retries fail, `failed` with a specific error type surfaced to UI.

**LLM returns malformed JSON**: retry once with the parse error appended to the prompt. If still fails, `failed`.

**LLM returns refusal / safety block**: `failed` with the specific error type. Not retried.

**Duplicate upload** (same file hash): return the existing document ID, do not re-process. UI shows "This file was already uploaded on X."

**User closes tab mid-review**: workspace state is entirely server-side. On return, load queue as before. No local state loss.

**Concurrent edits on same document**: extractions table is versioned via `parent_extraction_id`. Two simultaneous corrections create two branches; the second one shows a "This document was modified while you were reviewing" banner. Optimistic concurrency.

**Queue consumer crashes mid-message**: Redis Streams with `XCLAIM` — messages pending > 60s are reclaimed by another consumer. Idempotency check via a `pipeline_steps_completed` table (extraction_id + step_name unique).

**Postgres connection drops**: connection pool retries with exponential backoff. Requests during outage return 503 with retry-after header.

**Prompt update accidentally breaks all extractions**: eval harness on PR blocks merge. If somehow deployed, Argo Rollouts + Prometheus check catches degraded confidence distribution and rolls back.

---

## 4. Stack

**Backend:**
- Node.js 20 LTS
- Fastify + `@fastify/schema` for validation
- TypeScript (strict mode)
- Drizzle ORM + Drizzle Kit for migrations
- `@anthropic-ai/sdk` primary
- `openai` SDK for embeddings only
- `bullmq` OR raw Redis Streams — go with raw Redis Streams for explicit control and event-sourcing story
- `pdf-parse`, `pdfjs-dist`, `sharp` for document handling
- `@aws-sdk/client-s3` for object storage (points at MinIO in dev)
- `@opentelemetry/*` for tracing and metrics
- `pino` for structured logging
- Vitest for tests

**Frontend:**
- Vite + React 18 + TypeScript
- `@radix-ui/*` primitives
- Tailwind CSS (no shadcn scaffolds)
- `react-pdf` for PDF viewing
- `@tanstack/react-query` for server state
- `zustand` for local UI state
- Monaco editor for the SQL tab
- `motion` (formerly Framer Motion) for the "canvas, motion, tokens" signal

**Infra (later):**
- Docker + docker-compose for local
- Kubernetes manifests + ArgoCD Application definitions for deployed
- LGTM stack for observability

**Repo:**
- pnpm workspaces
- Turborepo? No, adds config surface. Plain pnpm scripts.
- Prettier + ESLint (minimal config, not the interview point)
- GitHub Actions for CI and eval

---

## 5. Repository structure

```
<repo-name>/
├── README.md                           # 3-min overview, deploy URL, demo video link
├── decisions.md                        # THE FILE. Every meaningful decision.
├── roadmap.md                          # what's next / what we cut
├── architecture.md                     # this document, distilled
├── Makefile                            # setup / dev / test / eval / seed
├── docker-compose.yml                  # postgres, redis, minio, LGTM
├── docker-compose.observability.yml    # separate compose for the LGTM stack alone
├── .env.example
├── .gitignore
├── package.json                        # root, pnpm workspaces config
├── pnpm-workspace.yaml
├── tsconfig.base.json
│
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── index.ts                # server entrypoint
│   │   │   ├── routes/
│   │   │   │   ├── documents.ts
│   │   │   │   ├── extractions.ts
│   │   │   │   ├── reviews.ts
│   │   │   │   ├── queries.ts
│   │   │   │   ├── evals.ts
│   │   │   │   └── health.ts
│   │   │   ├── middleware/
│   │   │   ├── plugins/
│   │   │   └── telemetry.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── worker/
│   │   ├── src/
│   │   │   ├── index.ts                # worker entrypoint
│   │   │   ├── consumers/
│   │   │   │   ├── classify.ts
│   │   │   │   ├── extract.ts
│   │   │   │   ├── validate.ts
│   │   │   │   ├── resolve.ts
│   │   │   │   └── correct.ts
│   │   │   └── telemetry.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/
│       ├── src/
│       │   ├── main.tsx
│       │   ├── app.tsx
│       │   ├── routes/
│       │   │   ├── index.tsx           # dashboard
│       │   │   ├── review.tsx          # workspace
│       │   │   ├── review/$id.tsx
│       │   │   ├── query.tsx
│       │   │   └── evals.tsx
│       │   ├── components/
│       │   │   ├── pdf-viewer/
│       │   │   ├── review-panel/
│       │   │   ├── field-input/
│       │   │   └── kbd.tsx
│       │   ├── hooks/
│       │   ├── styles/
│       │   └── lib/
│       ├── index.html
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── db/                             # Drizzle schema + migrations
│   │   ├── src/
│   │   │   ├── schema.ts
│   │   │   ├── client.ts
│   │   │   └── migrations/
│   │   └── package.json
│   │
│   ├── schemas/                        # Zod types shared across apps
│   │   └── src/
│   │       ├── document.ts
│   │       ├── extraction.ts
│   │       └── correction.ts
│   │
│   ├── contracts/                      # OpenAPI-style route types
│   │   └── src/
│   │
│   └── llm/                            # LLM provider abstraction
│       └── src/
│           ├── anthropic.ts
│           ├── openai.ts
│           └── provider.ts
│
├── pipeline/
│   ├── classify.ts
│   ├── extract.ts
│   ├── confidence.ts
│   ├── validate.ts
│   ├── resolve_entities.ts
│   ├── promote_to_fixture.ts
│   └── prompts/
│       ├── classify.v1.md
│       ├── extract_invoice.v1.md
│       ├── extract_receipt.v1.md       # added day 10
│       ├── cross_check_total.v1.md
│       └── generate_hint.v1.md
│
├── domains/
│   ├── invoice/
│   │   ├── schema.yaml
│   │   ├── validators.ts
│   │   └── README.md
│   └── receipt/                        # added day 10
│       └── schema.yaml
│
├── evals/
│   ├── fixtures/
│   │   ├── inv_0001/{input.pdf,expected.yaml,metadata.yaml}
│   │   └── ...
│   ├── runner.ts
│   ├── compare.ts
│   ├── cache.ts
│   ├── reports/
│   │   └── baseline.json
│   └── README.md
│
├── seed/
│   ├── seed.ts                         # populates initial fixtures on cold start
│   ├── load_docile.ts                  # downloads a subset of DocILE
│   └── fixtures_meta.yaml
│
├── queries/
│   ├── top_vendors_by_spend.sql
│   ├── mismatched_totals.sql
│   ├── duplicate_suspects.sql
│   └── ...
│
├── dashboards/
│   ├── business.json                   # Grafana dashboard
│   ├── pipeline.json
│   └── system.json
│
├── infra/
│   ├── k8s/
│   │   ├── api/
│   │   ├── worker/
│   │   ├── web/
│   │   ├── postgres/
│   │   └── redis/
│   └── argocd/
│       └── application.yaml
│
└── .github/workflows/
    ├── ci.yml                          # lint, typecheck, test
    ├── eval.yml                        # eval harness on PR
    └── deploy.yml
```

---

## 6. Day-by-day plan

### Day 1: Foundation

**Goal by end of day:** a working local stack that ingests a PDF and returns raw text. Deployed to your k3s cluster with a working URL.

- Create the repo. Name it something product-shaped, not `zamp-project`.
- pnpm workspaces + TypeScript base config + shared tsconfig.
- Docker Compose: Postgres 16 with pgvector, Redis 7, MinIO.
- Drizzle schema for all tables. Initial migration.
- Fastify API skeleton with `/health` and a `POST /documents` upload endpoint (accepts multipart, hashes, stores to MinIO, inserts row).
- Simple React app with a "upload" page that hits the endpoint.
- ArgoCD Application manifest committed. Deployed to your cluster.
- Reviewer can go to `https://<subdomain>.rohitpotato.dev`, upload a PDF, see it appear in the DB.

`decisions.md` gets its first three entries: Node over Go, Drizzle over Prisma, Redis Streams over Kafka.

### Day 2: Ingestion, DocILE, seed

**Goal:** ~100 real DocILE PDFs in MinIO with metadata, first prompt working.

- `seed/load_docile.ts`: downloads a subset of DocILE via `datasets` Python OR direct HF URLs. Hand-select 100 diverse invoices.
- Seed script inserts them into `documents` with pre-filled ground truth as ready-made "expected extractions" for later fixture use.
- `pipeline/classify.ts` implementation: send text sample to Haiku, get type + confidence, update document.
- Worker skeleton reading from Redis Streams. Consumes `document.uploaded` events, runs classifier.
- On upload from UI, event goes to stream, worker picks up, classifies, updates document. Round-trip works end-to-end.

`decisions.md`: why DocILE, why event-sourced pipeline over synchronous, why worker as separate deployable.

### Day 3: Extraction pipeline

**Goal:** upload → extraction JSON, working end-to-end with per-field confidence.

- `domains/invoice/schema.yaml` finalized.
- `pipeline/extract.ts`: builds prompt from template + schema, calls Sonnet with PDF as vision input, parses response with Zod validation.
- Retry-once-with-parse-error logic.
- `pipeline/confidence.ts`: implements all five signal computations. Cross-check for `total`, `invoice_number`, `invoice_date`.
- `pipeline/validate.ts`: schema validation rules engine. Simple expression evaluator (or use `jsonlogic` — decide first).
- Bounding box: prompt asks Sonnet to return `bbox` for each field. Parse and store in `extractions.per_field_confidence` or a sidecar field.
- Metrics wired up for extraction step.

`decisions.md`: why not model-self-reported confidence, prompt-as-file architecture, retry policy.

### Day 4: Review workspace scaffold

**Goal:** three-column layout renders, queue populated, PDF displays, extracted fields display.

- `/review` route with three-column layout.
- Queue: TanStack Query fetches pending review docs, sorted correctly.
- Middle: `react-pdf` renders selected doc.
- Right: form built from schema, values populated from extraction.
- Basic keyboard: `j`/`k` in queue, `Enter` to open.
- No editing yet, just display.
- Bounding box overlay wired: hover a field → PDF region highlights.

### Day 5: Review workspace — corrections + keyboard

**Goal:** full keyboard-driven review, corrections persist.

- Field editing: `Cmd+E` to enter edit mode, `Enter` to commit, `Esc` to cancel.
- `Cmd+Enter` approves whole doc, loads next in queue.
- `Cmd+R` rejects with reason prompt.
- Corrections POST to `/api/reviews/:id/correct`. Backend inserts `corrections` row, new `extractions` row with `parent_extraction_id`.
- Session stats bar (reviewed / backlog / time) live-updates.
- Validation failures show inline with red badges.
- Undo stack via `Cmd+Z`, at least last 5 corrections in session.

`decisions.md`: keyboard-first as senior signal, extractions as immutable versioned artifacts, correction as event.

### Day 6: Eval harness + gold set

**Goal:** `bin/eval` runs against 30 fixtures and produces a real report.

- Hand-pick 30 documents from seed and hand-label their `expected.yaml`. DocILE's own annotations are a starting point but need adaptation to our schema.
- Fixture directory structure.
- `evals/runner.ts` + `evals/compare.ts` with field-type-aware comparison.
- Response cache in `evals/.cache/`.
- Baseline JSON stored, first eval run committed.
- Markdown report generation.
- `bin/eval --format github` for CI.
- GitHub Action wired up.
- In-app `/evals` route showing eval history.

`decisions.md`: why per-field F1, why gold set matters more than any single feature, cache design.

### Day 7: Entity resolution + prompt hints

**Goal:** vendors get normalized, corrections generate prompt hints.

- `pipeline/resolve_entities.ts`: normalize → exact match → embedding NN.
- pgvector extension enabled, embeddings populated.
- Vendor dropdown in review workspace for unresolved cases.
- Correction → prompt hint pipeline (background job with threshold).
- Extraction pipeline re-reads prompt hints and injects into prompt.
- Test: correct a vendor's total 3 times, next similar invoice from that vendor extracts correctly with no correction needed.

`decisions.md`: entity resolution as first-class step, why embeddings over fuzzy string matching, per-vendor hints over global prompt tuning.

### Day 8: Query interface + dashboard

**Goal:** landing page + insights + SQL console all working.

- Dashboard route with hero metric + activity list.
- Ten pre-baked queries as SQL files.
- Query cards render, each executable.
- Monaco editor for SQL tab, read-only Postgres user.
- Correction → fixture promotion background job.

`decisions.md`: why pre-baked queries over text-to-SQL, correction-to-fixture as the flagship engineering piece.

### Day 9: Second domain (receipts) + polish

**Goal:** system handles a second document type with one afternoon of work, proves extensibility.

- `domains/receipt/schema.yaml`.
- `pipeline/prompts/extract_receipt.v1.md`.
- 10 receipt fixtures added to gold set.
- Verify end-to-end: upload a receipt, classifier detects it, extractor uses receipt schema, review workspace renders receipt fields.
- Time-permitting: motion transitions on state changes (Zamp's "motion" JD language).
- OTel + metrics fully wired, dashboards showing real data.

`decisions.md`: extensibility as architectural payoff.

### Day 10: The failure surface

**Goal:** every "reviewer tries to break it" scenario handled visibly.

- Corrupted PDF: parse error caught, UI shows retry-with-OCR.
- Unknown type: manual classification queue.
- Huge file: 413 with clear message.
- Rate limits: retry with backoff, metric emitted, UI shows queued status.
- Duplicate upload: dedup by hash.
- Session resume: server-side state fully.
- Concurrent edit: optimistic concurrency banner.

Each failure mode is testable. Write one integration test per failure mode.

`decisions.md`: every failure mode handled, listed explicitly.

### Day 11: Docs, deploy hardening, demo video

**Goal:** submission-ready. Reviewer could poke this cold.

- README: 3-minute overview, deploy URL, live-demo password, demo video link, one-command local setup.
- `decisions.md`: final polish. Should be 15-25 real decisions, each with the four-part structure. Written by you, not by an agent.
- `roadmap.md`: everything cut, prioritized. Includes Argo Rollouts as prompt-canary, Docling migration, multi-tenant, syscall-level sandbox for extraction workers (hat-tip to what we discussed).
- `architecture.md`: distilled from this doc.
- Demo video: 3 minutes, cursor on-screen, voice-over. Recorded on this day, not day 12.
- Cluster deployment hardened: mTLS via Linkerd verified, ArgoCD synced, cert-manager providing real TLS, external-secrets pulling API keys from Vault.

### Day 12: Buffer

**Goal:** buffer for the inevitable slippage.

If nothing slipped:
- Second polish pass on the review workspace (motion refinements, empty-state).
- Add Argo Rollouts config for the API deployment with a canary analysis template that queries eval F1. Demo-only, doesn't need to trigger a real rollback.
- Write the `HANDOFF.md` — one-pager for the interview conversation: "here's what I built, here's what I'd change with more time, here's what I learned."

If things slipped: prioritize in this order — deployment works, demo video exists, `decisions.md` is complete, everything else is negotiable.

---

## 7. What `decisions.md` must contain

The file is graded harder than the code. It is a running log of judgment calls, not a summary. It should be written progressively across all 12 days, not at the end.

Every entry has this structure:

```markdown
### <Decision title>

**Chose:** <the thing>
**Alternatives:** <the other things seriously considered>
**Reasoning:** <why, including the tradeoff accepted>
**Cut:** <what this decision deliberately leaves out>
```

The file should contain at minimum:

1. Problem framing (the scope statement paragraph)
2. Domain choice: invoices + receipts, not contracts or bank statements
3. Data source: DocILE, why over synthesis or other public sets
4. Stack: Node over Go, Fastify over Express, Drizzle over Prisma, pnpm over Turbo, React over Solid/Svelte
5. Queue: Redis Streams over Kafka (with the explicit "primitives map 1:1" note)
6. Storage: MinIO in dev, S3 interface for production
7. Schema-as-file over schema-in-code
8. Prompt-as-file over prompt-as-string
9. Confidence from signals, not model self-report
10. Cross-check pattern for critical fields
11. Extraction as immutable, corrections as new versions
12. Entity resolution via embeddings + threshold + human fallback
13. Prompt hints as per-source overrides
14. Correction → hint → fixture pipeline (the flagship contribution)
15. Eval harness as PR-blocking regression gate
16. Ten pre-baked queries over text-to-SQL
17. Keyboard-first review UX (with the specific shortcut set)
18. Bounding boxes from the same extraction call, not a second model call
19. Every failure mode and its handling
20. Auth-lite (shared password) as explicit cut
21. Single-tenant as explicit cut
22. Docling swap listed as first production migration
23. Argo Rollouts for prompt canary (with the "eval F1 as analysis template" note)
24. Observability stack choice (OTel + LGTM)

Written honestly, this is 3,000-5,000 words. It is the file reviewers will read most carefully.

---

## 8. What `roadmap.md` must contain

Short. Prioritized. Every item has a one-sentence rationale.

Structure:

```markdown
## Would ship next

- Docling for ingestion — better table extraction than pdf-parse.
- Argo Rollouts with eval F1 as analysis template — automated prompt/model canary.
- Multi-tenant with per-tenant schemas — needed for real customers.
- Better cross-check — currently one field pattern, generalize to schema-declared.

## Would ship after that

- Text-to-SQL over pre-baked queries once structured output on schema-aware SQL reaches >80% accuracy.
- Fine-tuned per-vendor extractors for the top 10 vendors by volume — cost/accuracy win.
- Real durable execution via Temporal — replaces our hand-rolled event log for cross-region.
- Syscall-level sandbox for extraction workers — Tetragon on eBPF, blast-radius reduction.

## Would consider

- Slack integration for review notifications.
- Public sharing/audit links.
- Approval chains for high-value invoices.
```

The point: reviewers see you know exactly what's missing. If your roadmap says "add dark mode," you look junior. If it says the above, you look senior.

---

## 9. Handoff instructions for the coding agent

Read this whole document before writing code. Then work in this order:

1. Set up the repo skeleton (Section 5). All directories and stub files.
2. Docker Compose for local infra (Section 4).
3. Drizzle schema and initial migration (Section 3.3).
4. LLM provider abstraction (`packages/llm/`).
5. Ingestion + classifier (`pipeline/classify.ts`).
6. Extraction with schema-driven prompt (`pipeline/extract.ts`).
7. Confidence + validation (`pipeline/confidence.ts`, `pipeline/validate.ts`).
8. Worker consuming from Redis Streams.
9. Review workspace, day 4-5 scope.
10. Eval harness, gold set, GitHub Action.
11. Entity resolution + prompt hints.
12. Dashboard + queries + SQL console.
13. Second domain, failure surface, docs, deploy.

Rules for the agent:

- **Do not write `decisions.md`.** The human owns this file. Agent may draft entries, but human rewrites in their own voice.
- **Do not skip the eval harness.** It is the flagship engineering piece, not an optional add-on.
- **Do not use shadcn scaffolds.** Radix + Tailwind primitives only.
- **Do not use `console.log` in production paths.** Structured logs via pino only, with trace ID.
- **Do not add features not in this document.** If tempted to, add to `roadmap.md` instead.
- **Every LLM call is instrumented.** Model, tokens, cost, latency, trace ID.
- **Every mutation writes an event.** Same transaction, no exceptions.
- **Every file created is TypeScript strict-mode-clean and has a companion test if it's not pure boilerplate.**
- **Prompts are files, not literals.** Schemas are files, not literals.
- **Idempotency keys everywhere.** Any pipeline step that can be replayed must be idempotent by construction.

When in doubt about a decision, escalate to the human. The point of this submission is that the human made the interesting calls; the agent implemented them.

---

## 10. Final notes

The submission is graded on: problem framing, product thinking, UX decisions, code quality, tests, documentation, setup experience, velocity, and "above and beyond" depth.

The submission wins by having a `decisions.md` that reads senior, a deployed URL that responds correctly to every attempt to break it, and one flagship depth piece — the correction → hint → fixture pipeline plus the eval harness that regression-blocks PRs — that most candidates will skip entirely.

Everything else is table stakes done well.

The scope statement (Section 1) is the anchor. When any decision is unclear, return to it.

---