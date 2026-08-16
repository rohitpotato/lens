import { eq } from 'drizzle-orm';
import { appendEvent, documents, type Database } from '@lens/db';
import { type LlmClient } from '@lens/llm';
import { classifyDocument, getActivePrompt } from '@lens/pipeline';
import { STREAMS, type Queue } from '@lens/queue';
import { type Storage } from '@lens/storage';
import { hasCompleted, markCompleted } from '../idempotency.js';
import type { Logger } from 'pino';

const STEP = 'classify';
const CONFIDENCE_THRESHOLD = 0.7;

export function makeClassifyConsumer(deps: {
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

    await deps.db.update(documents).set({ status: 'classifying' }).where(eq(documents.id, documentId));

    const prompt = await getActivePrompt(deps.db, 'classify');
    if (!prompt) throw new Error('no active classify prompt');

    const pdf = await deps.storage.get(doc.storagePath);
    const result = await classifyDocument({
      llm: deps.llm,
      model: prompt.model,
      promptTemplate: prompt.content,
      pdf,
    });

    // Any known type (invoice OR receipt OR any future type) proceeds to extraction
    // if the classifier is confident. Only 'unknown' or low-confidence goes to manual.
    const nextStatus =
      result.type !== 'unknown' && result.confidence >= CONFIDENCE_THRESHOLD
        ? 'extracting'
        : 'needs_manual_classification';

    await deps.db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          detectedType: result.type,
          detectedTypeConfidence: result.confidence.toString(),
          status: nextStatus,
        })
        .where(eq(documents.id, documentId));
      await appendEvent(tx, {
        eventType: 'document.classified',
        aggregateType: 'document',
        aggregateId: documentId,
        payload: {
          type: result.type,
          confidence: result.confidence,
          model: result.model,
          costUsd: result.costUsd,
          latencyMs: result.latencyMs,
        },
      });
      // Inside the tx: crash between commit and this insert would otherwise
      // let a retry redo the LLM call and duplicate rows.
      await markCompleted(tx, documentId, STEP);
    });

    log.info(
      { type: result.type, confidence: result.confidence, mode: result.mode, nextStatus },
      'classified',
    );

    if (nextStatus === 'extracting') {
      await deps.queue.publish(STREAMS.documentClassified, { documentId });
    }
  };
}
