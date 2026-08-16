# evals

The eval harness. Runs the `extract_invoice` pipeline against a fixture corpus and
compares output to expected values with field-type-aware matching.

## Layout

```
evals/
  fixtures/<id>/
    input.pdf            # the invoice
    expected.yaml        # ground truth in our schema shape
    metadata.yaml        # source, features (for slicing)
    source_annotation.json   # DocILE-imported only: original annotation
  reports/
    baseline.json        # current-committed baseline scores
    <timestamp>.md       # per-run markdown reports
  .cache/                # git-ignored LLM response cache
  src/
    bin/{eval,synth,import}.ts
    ...
```

## Commands

```bash
pnpm --filter @lens/evals synth      # (re)generate synthetic fixtures
pnpm --filter @lens/evals import     # pull the DocILE sample fixture
pnpm --filter @lens/evals eval       # run all fixtures, write report

# CLI flags
pnpm --filter @lens/evals eval -- --fixture syn_001_simple_usd
pnpm --filter @lens/evals eval -- --block-on-regression --format github
pnpm --filter @lens/evals eval -- --update-baseline
```

## Cache

`evals/.cache/` stores LLM responses keyed by `(model, temperature, system, messages)`.
Re-running with unchanged prompts / schemas is free. Any prompt or schema change
invalidates the affected keys — you'll see real cost again for those fixtures.
