import { and, eq } from 'drizzle-orm';
import { pipelineStepsCompleted, type Database } from '@lens/db';

/**
 * Accepts either a top-level Database handle OR a Drizzle transaction — both
 * expose the same query-builder interface. `markCompleted` MUST be called
 * inside the domain transaction (see below); `hasCompleted` typically runs
 * before the transaction is even opened.
 */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type DbOrTx = Database | Tx;

/**
 * True if this (documentId, stepName) has already been marked complete.
 * Redis Streams may redeliver — consumers gate on this so replays are safe.
 */
export async function hasCompleted(
  db: DbOrTx,
  documentId: string,
  stepName: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: pipelineStepsCompleted.id })
    .from(pipelineStepsCompleted)
    .where(and(eq(pipelineStepsCompleted.documentId, documentId), eq(pipelineStepsCompleted.stepName, stepName)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Mark step complete. MUST run inside the same transaction as the domain
 * writes it protects — otherwise a crash between transaction-commit and this
 * insert leaves the domain state committed but the completion marker missing,
 * so the next retry does the work AGAIN (duplicate extractions row, duplicate
 * event, duplicate LLM spend).
 *
 * UNIQUE (document_id, step_name) protects against two concurrent consumers
 * racing on the same message — the second insert conflicts and the whole tx
 * rolls back, which is what we want.
 */
export async function markCompleted(
  tx: DbOrTx,
  documentId: string,
  stepName: string,
): Promise<void> {
  await tx
    .insert(pipelineStepsCompleted)
    .values({ documentId, stepName })
    .onConflictDoNothing();
}
