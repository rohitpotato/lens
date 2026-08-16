import { and, desc, eq } from 'drizzle-orm';
import {
  appendEvent,
  documents,
  extractions,
  promptHints,
  prompts,
  schemas,
  type Database,
} from '@lens/db';
import { type LlmClient } from '@lens/llm';
import {
  extractionConfidence,
  extractionDurationSeconds,
  extractionHintsApplied,
  extractionsTotal,
} from '@lens/metrics';
import {
  computeConfidence,
  domainSchemaSchema,
  evaluateRules,
  extractInvoice,
  normalizeVendor,
  type DomainSchema,
} from '@lens/pipeline';
import { STREAMS, type Queue } from '@lens/queue';
import { type Storage } from '@lens/storage';
import { hasCompleted, markCompleted } from '../idempotency.js';
import type { Logger } from 'pino';

const STEP = 'extract';
const AUTO_APPROVE_THRESHOLD = 0.9;

export function makeExtractConsumer(deps: {
  db: Database;
  llm: LlmClient;
  storage: Storage;
  queue: Queue;
  log: Logger;
}) {
  return async (msg: { payload: { documentId: string } }) => {
    const { documentId } = msg.payload;
    const log = deps.log.child({ step: STEP, documentId });

    if (await hasCompleted(deps.db, documentId, STEP)) {
      log.info('already completed, skipping');
      return;
    }

    const docs = await deps.db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    const doc = docs[0];
    if (!doc) {
      log.warn('document not found');
      return;
    }
    const detectedType = doc.detectedType;
    if (!detectedType || detectedType === 'unknown') {
      log.warn({ detectedType }, 'no known type, skipping extract');
      return;
    }

    // Schema + prompt lookup are keyed off the detected type — adding a new
    // domain (e.g. receipt) is a schema.yaml + prompt.md + classify update.
    const schemaRow = (
      await deps.db
        .select()
        .from(schemas)
        .where(and(eq(schemas.name, detectedType), eq(schemas.isActive, true)))
        .orderBy(desc(schemas.version))
        .limit(1)
    )[0];
    if (!schemaRow) throw new Error(`no active schema for type "${detectedType}"`);
    const parsedSchema: DomainSchema = domainSchemaSchema.parse(schemaRow.compiledJson);

    const extractPromptName = `extract_${detectedType}`;
    const promptRow = (
      await deps.db
        .select()
        .from(prompts)
        .where(eq(prompts.name, extractPromptName))
        .orderBy(desc(prompts.version))
        .limit(1)
    )[0];
    if (!promptRow) throw new Error(`no active ${extractPromptName} prompt`);

    const pdf = await deps.storage.get(doc.storagePath);
    const extractStart = Date.now();

    // Pass 1: no hints. We need the extracted vendor before we can look up
    // per-vendor hints. Cost: one Sonnet call.
    let result = await extractInvoice({
      llm: deps.llm,
      model: promptRow.model,
      promptTemplate: promptRow.content,
      schema: parsedSchema,
      hints: [],
      pdf,
    });

    let hintsApplied: string[] = [];
    if (result.json) {
      // Vendor/merchant field name is schema-dependent; try both.
      const rawName = typeof result.json['vendor_name'] === 'string'
        ? (result.json['vendor_name'] as string)
        : typeof result.json['merchant_name'] === 'string'
          ? (result.json['merchant_name'] as string)
          : '';
      const vendorKey = normalizeVendor(rawName);
      if (vendorKey) {
        const adopted = await deps.db
          .select({ hint: promptHints.hint })
          .from(promptHints)
          .where(
            and(
              eq(promptHints.documentType, detectedType),
              eq(promptHints.matchingKey, vendorKey),
              eq(promptHints.status, 'adopted'),
              eq(promptHints.isActive, true),
            ),
          );
        if (adopted.length > 0) {
          // Pass 2: re-extract with adopted hints. Cost: one more Sonnet call
          // when hints exist for this vendor. The second result wins.
          hintsApplied = adopted.map((r) => r.hint);
          log.info({ vendorKey, hintCount: hintsApplied.length }, 'applying adopted hints');
          result = await extractInvoice({
            llm: deps.llm,
            model: promptRow.model,
            promptTemplate: promptRow.content,
            schema: parsedSchema,
            hints: hintsApplied,
            pdf,
          });
        }
      }
    }

    if (!result.json) {
      log.error({ parseError: result.parseError }, 'extraction JSON parse failed twice');
      await deps.db.update(documents).set({ status: 'failed' }).where(eq(documents.id, documentId));
      extractionsTotal.inc({ document_type: detectedType, outcome: 'failed' });
      extractionDurationSeconds.observe(
        { document_type: detectedType, passes: hintsApplied.length > 0 ? '2' : '1' },
        (Date.now() - extractStart) / 1000,
      );
      return;
    }

    const validations = evaluateRules(parsedSchema.validations, result.json, parsedSchema);
    const confidence = computeConfidence(parsedSchema, result.json, validations);

    const hasErrorFailure = validations.some((v) => !v.passed && v.severity === 'error');
    const status =
      !hasErrorFailure && confidence.overall >= AUTO_APPROVE_THRESHOLD
        ? 'auto_approved'
        : 'pending_review';

    await deps.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(extractions)
        .values({
          documentId,
          schemaId: schemaRow.id,
          promptId: promptRow.id,
          extractedJson: result.json as never,
          perFieldConfidence: confidence.perField as never,
          overallConfidence: confidence.overall.toString(),
          validationResults: validations as never,
          modelUsed: result.model,
          tokensInput: result.usage.inputTokens,
          tokensOutput: result.usage.outputTokens,
          costUsd: result.costUsd.toString(),
          latencyMs: result.latencyMs,
          status,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error('failed to insert extraction');
      await tx
        .update(documents)
        .set({ status: status === 'auto_approved' ? 'approved' : 'pending_review' })
        .where(eq(documents.id, documentId));
      await appendEvent(tx, {
        eventType: 'extraction.completed',
        aggregateType: 'extraction',
        aggregateId: row.id,
        payload: {
          documentId,
          status,
          overallConfidence: confidence.overall,
          costUsd: result.costUsd,
          latencyMs: result.latencyMs,
          hintsApplied,
        },
      });
      // Inside the tx: crash between commit and this insert would otherwise
      // let a retry redo the two-pass extraction (~$0.04) and duplicate rows.
      await markCompleted(tx, documentId, STEP);
    });

    log.info({ status, overallConfidence: confidence.overall }, 'extracted');

    await deps.queue.publish(STREAMS.extractionCompleted, { documentId });
  };
}
