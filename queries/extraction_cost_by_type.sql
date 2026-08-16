-- title: Extraction cost by document type
-- description: LLM spend per document type over the last 30 days.
SELECT
  d.detected_type,
  COUNT(*) AS extractions,
  ROUND(SUM(e.cost_usd)::numeric, 4) AS total_cost_usd,
  ROUND(AVG(e.cost_usd)::numeric, 4) AS avg_cost_usd,
  ROUND(AVG(e.latency_ms)::numeric, 0) AS avg_latency_ms
FROM extractions e
JOIN documents d ON d.id = e.document_id
WHERE e.extracted_at >= NOW() - INTERVAL '30 days'
GROUP BY d.detected_type
ORDER BY total_cost_usd DESC NULLS LAST;
