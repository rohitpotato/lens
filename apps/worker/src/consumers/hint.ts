import { and, desc, eq, sql } from 'drizzle-orm';
import {
  corrections,
  extractions,
  promptHints,
  type Database,
} from '@lens/db';
import { type LlmClient } from '@lens/llm';
import { generateHint, getActivePrompt } from '@lens/pipeline';
import type { Logger } from 'pino';

const MIN_CORRECTIONS_TO_TRIGGER = 1;

export function makeHintConsumer(deps: {
  db: Database;
  llm: LlmClient;
  log: Logger;
}) {
  return async (msg: {
    payload: {
      correctionId: string;
      extractionId: string;
      documentId: string;
      documentType: string;
      vendorKey: string;
      fieldPath: string;
    };
  }) => {
    const { correctionId, documentType, vendorKey, fieldPath } = msg.payload;
    const log = deps.log.child({ consumer: 'hint', vendorKey, fieldPath });

    // pull all recent corrections on this (vendor, field). vendor is resolved
    // through the extraction's vendor_name via a subquery, normalized in JS.
    const priorRaw = await deps.db
      .select({
        id: corrections.id,
        oldValue: corrections.oldValue,
        newValue: corrections.newValue,
        note: corrections.note,
        correctedAt: corrections.correctedAt,
        vendorName: sql<string | null>`(${extractions.extractedJson} ->> 'vendor_name')`,
      })
      .from(corrections)
      .innerJoin(extractions, eq(extractions.id, corrections.extractionId))
      .where(eq(corrections.fieldPath, fieldPath))
      .orderBy(desc(corrections.correctedAt))
      .limit(20);

    const forThisVendor = priorRaw.filter((r) => matchesVendor(r.vendorName, vendorKey));
    if (forThisVendor.length < MIN_CORRECTIONS_TO_TRIGGER) {
      log.info({ found: forThisVendor.length }, 'not enough evidence yet');
      return;
    }

    // skip if an active suggestion already exists for this (vendor, field)
    const existing = (
      await deps.db
        .select()
        .from(promptHints)
        .where(
          and(
            eq(promptHints.documentType, documentType),
            eq(promptHints.matchingKey, vendorKey),
            eq(promptHints.fieldPath, fieldPath),
            eq(promptHints.isActive, true),
          ),
        )
        .limit(1)
    )[0];
    if (existing && existing.status !== 'ignored') {
      // bump evidence count on the existing suggestion so the reviewer can see it strengthening
      await deps.db
        .update(promptHints)
        .set({ evidenceCount: forThisVendor.length, updatedAt: new Date() })
        .where(eq(promptHints.id, existing.id));
      log.info({ hintId: existing.id, evidence: forThisVendor.length }, 'existing hint reinforced');
      return;
    }

    const prompt = await getActivePrompt(deps.db, 'generate_hint');
    if (!prompt) {
      log.warn('no generate_hint prompt available');
      return;
    }

    const result = await generateHint({
      llm: deps.llm,
      model: prompt.model,
      promptTemplate: prompt.content,
      vendor: vendorKey,
      field: fieldPath,
      corrections: forThisVendor.map((r) => ({
        oldValue: r.oldValue,
        newValue: r.newValue,
        note: r.note,
        correctedAt: new Date(r.correctedAt).toISOString(),
      })),
    });
    if (!result) {
      log.info('LLM returned no actionable hint');
      return;
    }

    const inserted = await deps.db
      .insert(promptHints)
      .values({
        documentType,
        matchingKey: vendorKey,
        fieldPath,
        hint: result.hint,
        note: result.note,
        evidenceCount: forThisVendor.length,
        createdFromCorrectionId: correctionId,
      })
      .returning();
    const row = inserted[0];
    log.info(
      { hintId: row?.id, evidence: forThisVendor.length, costUsd: result.costUsd },
      'hint suggested',
    );
  };
}

function matchesVendor(raw: string | null, key: string): boolean {
  if (!raw || !key) return false;
  // reuse a compact inline normalizer — same rules as normalizeVendor
  const norm = raw.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return norm.startsWith(key) || norm === key;
}
