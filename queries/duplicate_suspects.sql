-- title: Duplicate suspects
-- description: Same vendor + same total within a 3-day window — likely double-billed invoices.
WITH ex AS (
  SELECT
    d.id AS document_id,
    d.filename,
    d.uploaded_at,
    e.extracted_json ->> 'invoice_number' AS invoice_number,
    LOWER(TRIM(REGEXP_REPLACE(e.extracted_json ->> 'vendor_name', '[^\w\s]', ' ', 'g'))) AS vendor,
    (e.extracted_json ->> 'total')::numeric AS total,
    (e.extracted_json ->> 'invoice_date')::date AS invoice_date
  FROM documents d
  JOIN extractions e ON e.document_id = d.id
  WHERE (e.extracted_json ->> 'total') ~ '^-?[0-9]+(\.[0-9]+)?$'
    AND (e.extracted_json ->> 'invoice_date') ~ '^\d{4}-\d{2}-\d{2}$'
)
SELECT
  a.vendor,
  a.total,
  a.invoice_date AS date_a,
  b.invoice_date AS date_b,
  a.filename AS file_a,
  b.filename AS file_b,
  ABS(a.invoice_date - b.invoice_date) AS days_apart
FROM ex a
JOIN ex b ON a.vendor = b.vendor
        AND a.total = b.total
        AND a.document_id < b.document_id
        AND ABS(a.invoice_date - b.invoice_date) <= 3
WHERE a.vendor <> ''
ORDER BY a.vendor, a.invoice_date;
