import client from 'prom-client';

/**
 * Shared Prometheus registry for the Lens stack. Every app / package imports
 * from here so metrics land in one place and `/metrics` on api + worker
 * scrapes the same names.
 */
export const register = new client.Registry();

// Standard Node process metrics (event loop lag, CPU, memory, GC).
client.collectDefaultMetrics({ register, prefix: 'lens_node_' });

/** Label the process so Prometheus can group api vs. worker without another job label. */
export function setAppLabel(app: 'api' | 'worker'): void {
  register.setDefaultLabels({ app });
}

// -------------------------------------------------------------------------
// LLM
// -------------------------------------------------------------------------

export const llmRequestsTotal = new client.Counter({
  name: 'lens_llm_requests_total',
  help: 'LLM calls, by model and outcome.',
  labelNames: ['model', 'outcome'] as const,
  registers: [register],
});

export const llmTokensTotal = new client.Counter({
  name: 'lens_llm_tokens_total',
  help: 'LLM tokens, by model and direction (input | output).',
  labelNames: ['model', 'direction'] as const,
  registers: [register],
});

export const llmCostUsdTotal = new client.Counter({
  name: 'lens_llm_cost_usd_total',
  help: 'LLM spend in USD, by model.',
  labelNames: ['model'] as const,
  registers: [register],
});

export const llmRequestDurationSeconds = new client.Histogram({
  name: 'lens_llm_request_duration_seconds',
  help: 'LLM call latency, by model.',
  labelNames: ['model'] as const,
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60],
  registers: [register],
});

// -------------------------------------------------------------------------
// Extractions
// -------------------------------------------------------------------------

export const extractionsTotal = new client.Counter({
  name: 'lens_extractions_total',
  help: 'Completed extractions, by document type and outcome.',
  labelNames: ['document_type', 'outcome'] as const, // auto_approved | pending_review | failed
  registers: [register],
});

export const extractionDurationSeconds = new client.Histogram({
  name: 'lens_extraction_duration_seconds',
  help: 'End-to-end extract step latency (may include two LLM passes).',
  labelNames: ['document_type', 'passes'] as const,
  buckets: [1, 2, 5, 10, 20, 40, 60, 120],
  registers: [register],
});

export const extractionConfidence = new client.Histogram({
  name: 'lens_extraction_confidence',
  help: 'Overall confidence per completed extraction, by document type.',
  labelNames: ['document_type'] as const,
  buckets: [0.1, 0.3, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99, 1.0],
  registers: [register],
});

export const extractionHintsApplied = new client.Counter({
  name: 'lens_extraction_hints_applied_total',
  help: 'Extractions where an adopted hint was injected (pass 2 ran).',
  labelNames: ['document_type'] as const,
  registers: [register],
});

// -------------------------------------------------------------------------
// Documents (ingest + lifecycle)
// -------------------------------------------------------------------------

export const documentsUploadedTotal = new client.Counter({
  name: 'lens_documents_uploaded_total',
  help: 'Uploads accepted at POST /documents.',
  labelNames: ['dedup', 'source_mime'] as const, // dedup: 'hit' | 'miss'
  registers: [register],
});

export const documentsClassifiedTotal = new client.Counter({
  name: 'lens_documents_classified_total',
  help: 'Documents classified, by detected type and classify mode.',
  labelNames: ['detected_type', 'mode'] as const, // mode: 'text' | 'vision'
  registers: [register],
});

// -------------------------------------------------------------------------
// Corrections + rule learning loop
// -------------------------------------------------------------------------

export const correctionsTotal = new client.Counter({
  name: 'lens_corrections_total',
  help: 'Reviewer corrections applied, by document type and field.',
  labelNames: ['document_type', 'field_path'] as const,
  registers: [register],
});

export const hintsTotal = new client.Counter({
  name: 'lens_hints_total',
  help: 'Hint pipeline actions.',
  labelNames: ['document_type', 'action'] as const,
  // action: suggested | reinforced | adopted | ignored | modified | inconsistent | insufficient
  registers: [register],
});

export const reviewActionsTotal = new client.Counter({
  name: 'lens_review_actions_total',
  help: 'Reviewer terminal actions on a document.',
  labelNames: ['action'] as const, // approved | rejected
  registers: [register],
});

// -------------------------------------------------------------------------
// Queue
// -------------------------------------------------------------------------

export const queueMessagesTotal = new client.Counter({
  name: 'lens_queue_messages_total',
  help: 'Queue message outcomes per stream.',
  labelNames: ['stream', 'outcome'] as const, // published | acked | failed | dead_lettered
  registers: [register],
});

export const queueDeliveryAttempts = new client.Histogram({
  name: 'lens_queue_delivery_attempts',
  help: 'How many delivery attempts a message took before being acked or dead-lettered.',
  labelNames: ['stream'] as const,
  buckets: [1, 2, 3, 5, 10],
  registers: [register],
});

// -------------------------------------------------------------------------
// Guardrails
// -------------------------------------------------------------------------

export const costCapHitsTotal = new client.Counter({
  name: 'lens_cost_cap_hits_total',
  help: '503s served because the daily LLM cost cap was reached.',
  registers: [register],
});

export const rateLimitHitsTotal = new client.Counter({
  name: 'lens_rate_limit_hits_total',
  help: '429s served because of per-IP upload rate limits.',
  registers: [register],
});

export const uploadRejectedTotal = new client.Counter({
  name: 'lens_upload_rejected_total',
  help: 'Uploads rejected before processing.',
  labelNames: ['reason'] as const, // too_large | image_conversion_failed | missing_file
  registers: [register],
});

// -------------------------------------------------------------------------
// HTTP (recorded via a fastify onResponse hook in apps/api)
// -------------------------------------------------------------------------

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'lens_http_request_duration_seconds',
  help: 'HTTP request latency at the API.',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

export async function serializeMetrics(): Promise<string> {
  return register.metrics();
}

export const CONTENT_TYPE = register.contentType;
