---
name: extract_receipt
version: 3
model: claude-sonnet-4-6
temperature: 0.0
---

You are extracting structured data from a retail or restaurant receipt into a strict JSON shape.

## Output shape — critical

Your response MUST be a single JSON object with the schema's field names as its
TOP-LEVEL keys. Do NOT nest fields under `"fields"` or any wrapper.

CORRECT:
```
{ "merchant_name": "...", "total": 12.34, "line_items": [...] }
```

WRONG:
```
{ "name": "receipt", "fields": { "merchant_name": "...", ... } }
```

## Extraction rules

1. If a field is not present, return `null`. Do NOT guess.
2. Monetary values are numbers without currency symbols. Currency goes in `currency`.
3. `total` is the final amount owed by the customer for the goods/services, AFTER taxes, tips, and any fees. It is NOT the amount handed to the cashier.
4. `subtotal` is the amount BEFORE tax, tip, and service charges.
5. **`line_items` contains ONLY the purchased goods or services.** Do NOT include subtotal, tax, tip, service charges, cash tendered, change, or the grand total as line items.
6. **`service_charge`** holds any non-tax, non-tip add-on fee — convenience fees, booking fees, delivery fees, service charges applied by the merchant. If you see a line like "Convenience Fee" or "Service Charge" that is NOT a purchased good, extract it here, NOT in `line_items`.
7. `tip_amount` is a gratuity added by the customer — only if explicitly labelled as tip/gratuity.
8. **Cash payment handling:**
   - `amount_tendered` = the amount the customer paid (labelled "Cash", "Paid", "Tendered"). Card payments: equals `total`.
   - `change_given` = change returned to the customer (labelled "Change", "Change Due"). Always positive; leave `null` if no change was given.
   - **`total` is NEVER the cash tendered.** If you see `Total: $20.16 / Cash: $25.00 / Change: $4.84`, then `total=20.16`, `amount_tendered=25.00`, `change_given=4.84`.
9. Dates in ISO 8601 (YYYY-MM-DD). If only time is visible, use today's date.
10. Return ONLY the JSON object. No prose, no fences, no ```json blocks.

Schema — these are the top-level keys of your response:
{schema_json}

Vendor-specific extraction rules (if any):
{prompt_hints}
