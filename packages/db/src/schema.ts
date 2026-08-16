import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Document types recognized by the classifier. Adding a new type here
 * is coordinated with a matching schema.yaml under domains/<type>/.
 */
export const documentStatuses = [
  'uploaded',
  'classifying',
  'needs_manual_classification',
  'extracting',
  'extracted',
  'pending_review',
  'approved',
  'rejected',
  'failed',
] as const;

export const extractionStatuses = [
  'auto_approved',
  'pending_review',
  'approved',
  'rejected',
] as const;

export const schemas = pgTable(
  'schemas',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    version: integer('version').notNull(),
    yamlDefinition: text('yaml_definition').notNull(),
    compiledJson: jsonb('compiled_json').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameVersionUnique: unique('schemas_name_version_uniq').on(t.name, t.version),
  }),
);

export const prompts = pgTable(
  'prompts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameVersionUnique: unique('prompts_name_version_uniq').on(t.name, t.version),
  }),
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    storagePath: text('storage_path').notNull(),
    fileHash: text('file_hash').notNull(),
    pageCount: integer('page_count'),
    detectedType: text('detected_type'),
    detectedTypeConfidence: numeric('detected_type_confidence'),
    status: text('status').notNull().default('uploaded'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    fileHashUnique: unique('documents_file_hash_uniq').on(t.fileHash),
    statusIdx: index('documents_status_idx').on(t.status),
  }),
);

/**
 * Extractions are the current state of an extracted document. We deliberately
 * do NOT chain versions via parent_extraction_id; corrections are the immutable
 * audit trail. `version` supports optimistic concurrency for concurrent edits.
 */
export const extractions = pgTable(
  'extractions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    schemaId: uuid('schema_id')
      .notNull()
      .references(() => schemas.id),
    promptId: uuid('prompt_id')
      .notNull()
      .references(() => prompts.id),
    extractedJson: jsonb('extracted_json').notNull(),
    perFieldConfidence: jsonb('per_field_confidence').notNull(),
    overallConfidence: numeric('overall_confidence').notNull(),
    validationResults: jsonb('validation_results').notNull(),
    modelUsed: text('model_used').notNull(),
    tokensInput: integer('tokens_input'),
    tokensOutput: integer('tokens_output'),
    costUsd: numeric('cost_usd'),
    latencyMs: integer('latency_ms'),
    status: text('status').notNull(),
    version: integer('version').notNull().default(1),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    documentIdIdx: index('extractions_document_id_idx').on(t.documentId, t.extractedAt),
    statusConfidenceIdx: index('extractions_status_confidence_idx').on(t.status, t.overallConfidence),
  }),
);

export const corrections = pgTable(
  'corrections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    extractionId: uuid('extraction_id')
      .notNull()
      .references(() => extractions.id, { onDelete: 'cascade' }),
    fieldPath: text('field_path').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    correctionType: text('correction_type').notNull(),
    note: text('note'),
    correctedBy: text('corrected_by').notNull(),
    becameFixture: boolean('became_fixture').notNull().default(false),
    fixtureId: text('fixture_id'),
    correctedAt: timestamp('corrected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    extractionFieldIdx: index('corrections_extraction_field_idx').on(t.extractionId, t.fieldPath),
    correctedAtIdx: index('corrections_corrected_at_idx').on(t.correctedAt),
  }),
);

/**
 * `status` values: 'suggested' (waiting for human review), 'adopted' (injected
 * into extract prompts), 'ignored' (reviewer dismissed). Only 'adopted' hints
 * flow into the extract pipeline.
 */
export const promptHintStatuses = ['suggested', 'adopted', 'ignored'] as const;

export const promptHints = pgTable(
  'prompt_hints',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentType: text('document_type').notNull(),
    matchingKey: text('matching_key').notNull(),
    fieldPath: text('field_path').notNull(),
    hint: text('hint').notNull(),
    status: text('status').notNull().default('suggested'),
    evidenceCount: integer('evidence_count').notNull().default(1),
    note: text('note'),
    createdFromCorrectionId: uuid('created_from_correction_id').references(() => corrections.id, {
      onDelete: 'set null',
    }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lookupIdx: index('prompt_hints_lookup_idx').on(t.documentType, t.matchingKey, t.status),
    statusIdx: index('prompt_hints_status_idx').on(t.status, t.createdAt),
  }),
);

export const entities = pgTable(
  'entities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    entityType: text('entity_type').notNull(),
    canonicalName: text('canonical_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typeNameUnique: unique('entities_type_name_uniq').on(t.entityType, t.canonicalName),
  }),
);

export const entityMentions = pgTable(
  'entity_mentions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    extractionId: uuid('extraction_id')
      .notNull()
      .references(() => extractions.id, { onDelete: 'cascade' }),
    fieldPath: text('field_path').notNull(),
    rawValue: text('raw_value').notNull(),
    confidence: numeric('confidence').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    extractionIdx: index('entity_mentions_extraction_idx').on(t.extractionId),
  }),
);

/**
 * Append-only event log. Every mutation writes here in the same transaction.
 * Debugging is "read the events for this aggregate."
 */
export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    traceId: text('trace_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    aggregateIdx: index('events_aggregate_idx').on(t.aggregateType, t.aggregateId, t.createdAt),
    eventTypeIdx: index('events_type_idx').on(t.eventType, t.createdAt),
  }),
);

/**
 * Pipeline idempotency. Redis Streams may redeliver a message; consumers
 * check here before doing work so replays are safe.
 */
export const pipelineStepsCompleted = pgTable(
  'pipeline_steps_completed',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    stepName: text('step_name').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    docStepUnique: unique('pipeline_steps_doc_step_uniq').on(t.documentId, t.stepName),
  }),
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fixturesTotal: integer('fixtures_total').notNull(),
    fixturesPassed: integer('fixtures_passed').notNull(),
    overallF1: numeric('overall_f1'),
    regressions: jsonb('regressions'),
    improvements: jsonb('improvements'),
    costUsd: numeric('cost_usd'),
    reportMarkdown: text('report_markdown'),
    triggeredBy: text('triggered_by'),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ranAtIdx: index('eval_runs_ran_at_idx').on(t.ranAt),
  }),
);

/**
 * Which prompt/schema versions were active for an eval run.
 * Enables meaningful F1 deltas between runs when artifacts change.
 */
export const evalRunArtifacts = pgTable(
  'eval_run_artifacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    evalRunId: uuid('eval_run_id')
      .notNull()
      .references(() => evalRuns.id, { onDelete: 'cascade' }),
    artifactType: text('artifact_type').notNull(),
    artifactName: text('artifact_name').notNull(),
    version: integer('version').notNull(),
  },
  (t) => ({
    runIdx: index('eval_run_artifacts_run_idx').on(t.evalRunId),
    lookupUnique: unique('eval_run_artifacts_uniq').on(
      t.evalRunId,
      t.artifactType,
      t.artifactName,
    ),
  }),
);

// Convenience: enable pg_trgm for future fuzzy entity matching without a new migration.
export const enableTrgm = sql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`;
