-- title: Top vendors by spend (last 90 days)
-- description: Sum of extracted `total` field per normalized vendor.
SELECT vendor, invoices, total_spend, currency
FROM (
  SELECT
    LOWER(TRIM(REGEXP_REPLACE(e.extracted_json ->> 'vendor_name', '[^\w\s]', ' ', 'g'))) AS vendor,
    COUNT(DISTINCT d.id) AS invoices,
    ROUND(SUM((e.extracted_json ->> 'total')::numeric)::numeric, 2) AS total_spend,
    MAX(e.extracted_json ->> 'currency') AS currency
  FROM documents d
  JOIN extractions e ON e.document_id = d.id
  WHERE d.uploaded_at >= NOW() - INTERVAL '90 days'
    AND (e.extracted_json ->> 'total') ~ '^-?[0-9]+(\.[0-9]+)?$'
  GROUP BY vendor
) t
WHERE vendor <> ''
ORDER BY total_spend DESC NULLS LAST
LIMIT 20;
