-- title: Correction hotspots
-- description: Which fields get corrected most often, across all vendors.
SELECT
  c.field_path,
  COUNT(*) AS corrections,
  COUNT(DISTINCT c.extraction_id) AS distinct_extractions,
  MAX(c.corrected_at)::date AS most_recent
FROM corrections c
GROUP BY c.field_path
ORDER BY corrections DESC
LIMIT 20;
