-- title: Auto-approval rate by vendor
-- description: Share of extractions marked auto_approved per vendor.
SELECT
  LOWER(TRIM(REGEXP_REPLACE(e.extracted_json ->> 'vendor_name', '[^\w\s]', ' ', 'g'))) AS vendor,
  COUNT(*) AS extractions,
  COUNT(*) FILTER (WHERE e.status = 'auto_approved') AS auto_approved,
  ROUND(100.0 * COUNT(*) FILTER (WHERE e.status = 'auto_approved') / COUNT(*), 1) AS auto_pct
FROM extractions e
GROUP BY vendor
HAVING vendor <> '' AND COUNT(*) >= 1
ORDER BY auto_pct DESC, extractions DESC
LIMIT 20;
