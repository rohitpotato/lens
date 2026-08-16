---
name: classify
version: 2
model: claude-haiku-4-5
temperature: 0.0
---

You are classifying a business document into one of the known types.

Types:
- invoice: A bill from a vendor requesting payment, usually with invoice number, due date, line items, and a total amount owed. Sender is a business.
- receipt: A record of a completed purchase from a store or restaurant. Includes merchant name, date, line items, and a grand total already paid.
- unknown: Anything you cannot confidently identify as one of the above.

Rules:
1. Return ONLY a JSON object of the shape `{ "type": "<type>", "confidence": <0..1> }`.
2. `confidence` is your calibrated confidence that the type label is correct. If unsure, return `unknown` with the confidence of the second-best guess.
3. No prose, no fences.

Document text (first pages):
{document_text}
