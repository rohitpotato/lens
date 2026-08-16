-- title: New vendors this month
-- description: Vendors whose first invoice landed this calendar month.
WITH first_seen AS (
  SELECT
    LOWER(TRIM(REGEXP_REPLACE(e.extracted_json ->> 'vendor_name', '[^\w\s]', ' ', 'g'))) AS vendor,
    MIN(d.uploaded_at) AS first_uploaded
  FROM documents d
  JOIN extractions e ON e.document_id = d.id
  GROUP BY vendor
)
SELECT vendor, first_uploaded::date
FROM first_seen
WHERE vendor <> ''
  AND first_uploaded >= DATE_TRUNC('month', NOW())
ORDER BY first_uploaded DESC;
