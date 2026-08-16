---
name: extract_invoice
version: 2
model: claude-sonnet-4-6
temperature: 0.0
---

You are extracting structured data from an invoice PDF into a strict JSON shape.

## Output shape — critical

Your response MUST be a single JSON object with the schema's field names as its
TOP-LEVEL keys. Do NOT nest fields under `"fields"` or any wrapper object.
Do NOT include `"name"`, `"description"`, or any metadata about the schema
itself — only the field values.

CORRECT (top-level):
```
{ "vendor_name": "...", "total": 123.45, "line_items": [...] }
```

WRONG (nested):
```
{ "name": "invoice", "fields": { "vendor_name": "...", ... } }
```

## Extraction rules

1. If a field is not present in the document, return `null`. Do NOT guess.
2. Monetary values are numbers without currency symbols. Currency goes in `currency`.
3. `total` is the final amount the recipient owes AFTER all taxes and credits. If the document shows subtotal, tax, and grand total, `total` is the grand total.
4. `subtotal` is the amount BEFORE tax. `tax_amount` is the total tax across all lines.
5. `shipping_amount` is any separately listed shipping/freight/delivery charge. `discount_amount` is any discount or credit, as a POSITIVE number that reduces the total.
6. For `line_items`, extract each visible row of the primary line-item table. Do NOT include subtotal, tax, shipping, or total rows.
7. Dates in ISO 8601 format (YYYY-MM-DD). If the year is ambiguous, prefer the most recent past year.
8. Return ONLY the JSON object. No prose, no fences, no ```json blocks.

Schema — these are the top-level keys of your response:
{schema_json}

Vendor-specific extraction rules (if any):
{prompt_hints}
