---
name: generate_hint
version: 1
model: claude-haiku-4-5
temperature: 0.0
---

You are analyzing corrections a human reviewer made to invoice extractions from a specific vendor, so that a future extraction of another invoice from the same vendor will get the field right on the first pass.

Vendor: {vendor}
Field: {field}

Recent corrections on this field for this vendor:
{corrections}

Produce a single, actionable rule that would prevent the extractor from making the same mistake again. The rule will be pasted into the extractor's system prompt for future invoices from this vendor.

Rules:
1. Return ONLY a JSON object of the shape `{ "hint": "<one sentence>", "note": "<one short sentence rationale, optional>" }`.
2. `hint` must be one sentence, imperative voice, referencing the field by its schema name (e.g. "total", "tax_amount").
3. Do NOT invent facts not supported by the corrections. If the corrections don't imply a clear rule, return `{ "hint": "", "note": "insufficient signal" }`.
4. If the corrections point in opposite directions (e.g. total moved from A to B, then back to A on a later invoice), that is inconsistent — return `{ "hint": "", "note": "inconsistent signal" }`. Do not average, pick a side, or synthesize a rule.
5. No prose outside the JSON, no fences.
