---
name: extract_invoice
version: 3
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
4. `subtotal` is the amount BEFORE tax. `tax_amount` is the total tax across all lines (sum CGST + SGST + IGST + VAT + any other tax lines).
5. `shipping_amount` is any separately listed shipping / freight / delivery / courier charge.
6. `discount_amount` is any discount, coupon, or credit — as a POSITIVE number that reduces the total.
7. `fees_amount` is a CATCH-ALL for anything else that increases the total and isn't tax, shipping, or discount. Sum ALL such lines into it. Examples: packing charges, platform fee, service fee, convenience fee, handling fee, restocking fee, gateway fee. Positive number.
8. **Decomposition invariant** — before returning, verify that
   `subtotal + tax_amount + shipping_amount + fees_amount − discount_amount == total`
   (treat missing fields as 0). If it doesn't balance, you have dropped or misfiled a line — re-read the totals section and fix the offending field. Never return an unbalanced decomposition.
9. For `line_items`, extract each visible row of the primary line-item table. Do NOT include subtotal, tax, shipping, fees, discount, or total rows.
10. Dates in ISO 8601 format (YYYY-MM-DD). If the year is ambiguous, prefer the most recent past year.
11. Return ONLY the JSON object. No prose, no fences, no ```json blocks.

Schema — these are the top-level keys of your response:
{schema_json}

Vendor-specific extraction rules (if any):
{prompt_hints}
