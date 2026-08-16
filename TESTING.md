# Testing Lens

Practical guide for validating what's built. Split into (1) automated evals for
the extractor, (2) manual test paths for the review + rules UX, (3) failure
modes to poke at, (4) edge cases worth watching.

Setup once:

```bash
make up                                              # postgres, redis, minio
pnpm install
pnpm --filter @lens/db db:migrate
cp .env.example .env  # add ANTHROPIC_API_KEY
pnpm --filter @lens/evals synth                      # generate 5 synthetic fixtures
pnpm --filter @lens/evals import:docile              # + 1 real DocILE fixture
```

Two terminals for the manual paths:

```bash
pnpm --filter @lens/api dev
pnpm --filter @lens/worker dev
pnpm --filter @lens/web dev                          # http://localhost:5173
```

---

## 1. Automated: the eval harness

The gold standard for extractor quality. Runs against 6 fixtures with LLM
response caching so re-runs are free.

```bash
pnpm --filter @lens/evals eval                       # run all
pnpm --filter @lens/evals eval -- --fixture syn_001_simple_usd
pnpm --filter @lens/evals eval -- --update-baseline
pnpm --filter @lens/evals eval -- --block-on-regression   # exits non-zero if F1 dropped >0.02
```

**Pass criteria:**
- Overall F1 ≥ 0.85 (current baseline: 0.900).
- No fixture regresses by more than 0.02 F1 vs baseline.
- Second consecutive run reports `Cost: $0.0000` (cache is warm).

**When it fails:**
- Regressions list appears at the bottom of the CLI output and in the
  timestamped `evals/reports/<ts>.md` file.
- Check the per-field diff in `runner.ts` output — usually a prompt tweak
  changed one field's phrasing.

**On PRs:** `.github/workflows/eval.yml` runs the harness whenever
`pipeline/prompts/**`, `domains/**/schema.yaml`, `packages/pipeline/**`,
`packages/llm/**`, or `evals/**` changes. It posts a sticky report comment and
fails the job on any >0.02 regression.

---

## 2. Manual paths

### 2a. Golden path — upload → review → approve

1. `curl -F file=@evals/fixtures/syn_001_simple_usd/input.pdf http://localhost:3001/documents`
2. Wait ~10s; open `http://localhost:5173/review`.
3. Expect: Acme Widgets appears in queue with confidence strip near 100%.
4. Click it. PDF renders center. Fields populate right.
5. `Cmd+Enter` (or click **Approve & next**).
6. Verify: `documents.status='approved'`, `extractions.status='approved'`,
   `events` gets a `review.approved` row.

### 2b. Reconciliation path (Phase 3 UX)

Needs a doc with a rule violation. The DocILE Philip Morris sample already
has one.

1. Upload `curl -F file=@evals/fixtures/docile_.../input.pdf http://localhost:3001/documents`
2. Open the doc in the review workspace.
3. Expect **inline reconciliation card** under `TOTAL`:
   "Subtotal + tax does not equal total. Rule expects: 4759.2 [Accept]"
4. Click Accept.
5. Verify:
   - `corrections` row inserted (`total`, old→new, `type=edit`).
   - `extractions.version` bumped, `overall_confidence` jumps toward 1.0.
   - Reconciliation card disappears.
   - Queue's strip flips from amber to primary.

### 2c. Flagship path — correction → hint → adopt → next extraction uses hint

The submission's differentiating loop.

1. On any doc, edit a field (click value, type new value, Enter).
2. Wait ~5s. Query `SELECT * FROM prompt_hints;` — a row with
   `status='suggested'`, `evidence_count=1` should appear.
3. Open `http://localhost:5173/rules`. Card renders with the LLM-generated hint
   + rationale.
4. Click **Adopt**. DB row flips to `status='adopted'`.
5. Upload a NEW invoice from the same vendor (`head -c 900 /dev/urandom > salt; cat original.pdf salt > new.pdf`).
6. Wait ~35s. Tail `/tmp/worker.log`:
   ```
   applying adopted hints  vendorKey=<vendor>  hintCount=1
   ```
7. Query `SELECT payload->'hintsApplied' FROM events WHERE event_type='extraction.completed' ORDER BY id DESC LIMIT 1;`
   — should list the hint text.
8. Expect the extracted field to reflect the hint pattern.

### 2d. Reject path

1. In the review workspace, click **Reject** (or press `Shift+R`).
2. Type a reason (required), click Reject in the dialog.
3. Verify: `documents.status='rejected'`, `extractions.status='rejected'`,
   `events` gets a `review.rejected` with the reason in payload.

### 2e. Keyboard-only review

Should work end-to-end without touching the mouse:

- `j`/`k` (or arrows) → move in queue
- `Enter` → open selected doc
- Click a field → `e` or `Enter` → enter edit mode
- Type, `Enter` → commit; `Esc` → cancel
- `Cmd+Enter` → approve + move to next
- `Shift+R` → open reject dialog
- `[` / `]` → PDF page nav (only when not in a text field)
- `+` / `-` → zoom

---

## 3. Failure modes

### 3a. Duplicate upload

```bash
curl -F file=@same.pdf http://localhost:3001/documents   # first: dedup:false
curl -F file=@same.pdf http://localhost:3001/documents   # second: dedup:true, same id
```
Verify: no second `documents` row, no duplicate MinIO PUT (check size unchanged).

### 3b. Oversized file

```bash
dd if=/dev/urandom of=huge.pdf bs=1M count=60
curl -sS -o /dev/null -w '%{http_code}\n' -F file=@huge.pdf http://localhost:3001/documents
# expect: 413
```

### 3c. Non-invoice document

Upload a plain text PDF or a screenshot. Classifier should return `type=unknown`
with low confidence, `documents.status='needs_manual_classification'`, no
extraction attempted.

### 3d. LLM 401 / rate-limit

Set `ANTHROPIC_API_KEY` to garbage in the worker's env. Upload an invoice.
Worker log should show a 401, message left unacked (pending count > 0),
`pipeline_steps_completed` NOT written — safe to retry.

### 3e. Malformed JSON from extractor

Hard to force deterministically. The pipeline retries once with the parse
error appended. On second failure, `documents.status='failed'` and no
extractions row is written.

### 3f. Concurrent correction

1. Open the same doc in two browser tabs.
2. Edit a field in tab A, save. Tab B still shows old `version`.
3. Edit a different field in tab B, save. Expect: 409 Conflict from
   `/reviews/:id/correct` with `currentVersion` in the body.

### 3g. Worker crash mid-classify

```bash
pkill -9 -f "worker.*src/index.ts"
# upload a fresh invoice
sleep 65
pnpm --filter @lens/worker dev
# xautoclaim reclaims the pending message after 60s idle; doc still processes.
```

### 3h. Empty-body POST

Adopt/ignore/approve/reject send no body. `apiFetch` must NOT set
`content-type: application/json` when body is null — otherwise Fastify 400s
with `FST_ERR_CTP_EMPTY_JSON_BODY`. This is regression-tested implicitly by
the flagship path (2c) which clicks Adopt.

---

## 4. Edge cases worth watching

- **Vendor name variance.** "Acme Widgets Inc.", "Acme Widgets, LLC", "ACME
  WIDGETS" should all normalize to the same `matching_key` and share hints.
  Verify with `SELECT DISTINCT matching_key FROM prompt_hints;`.
- **Line items with negative amounts (credits).** The Philip Morris fixture is
  the canonical test. Line items sum to `subtotal` — this is a real disagreement
  with DocILE's `amount_total_gross` labeling.
- **Currency mix.** `syn_003_many_lines_inr` uses ₹, `syn_002_no_tax_eur` €.
  Extractor should preserve the code exactly (not translate to USD).
- **Missing optional fields.** `syn_002_no_tax_eur` has no `tax_amount`. The
  extraction should return `null`, not fabricate a value.
- **Rule attribution edge case.** If a rule's `suggests.field` is NOT set,
  confidence attribution falls back to substring matching on the rule name.
  Test by adding a rule with no `suggests` block and confirming per-field
  scores still degrade sensibly.
- **Same-hash re-upload after correction.** Dedup returns the existing doc
  even if it's now in `pending_review`. The dedup response should show the
  current status.
- **Adopted hint on a vendor with no prior adopted rules.** First extraction
  with a hint doubles cost (two-pass). Verify the `extraction.completed`
  event's `hintsApplied` array and cost roughly doubles.

---

## Cost sanity

Per successful invoice today: ~$0.02–0.03 (Sonnet extract) + ~$0.001 (Haiku
classify). Hint generation is ~$0.0007 per correction that triggers one.
Two-pass extraction on adopted-hint vendors ~doubles the extract cost.

If you see a run cost >$0.10 per invoice, something is off — check
`extraction.completed` events for repeated attempts.
