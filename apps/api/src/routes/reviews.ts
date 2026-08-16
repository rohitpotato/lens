import { and, desc, eq, sql } from 'drizzle-orm';
import {
  appendEvent,
  corrections,
  documents,
  extractions,
  schemas,
  type Database,
} from '@lens/db';
import {
  computeConfidence,
  domainSchemaSchema,
  evaluateRules,
  normalizeVendor,
} from '@lens/pipeline';
import { STREAMS } from '@lens/queue';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const REVIEWABLE_STATUSES = ['pending_review'] as const;

type ExtractionRow = typeof extractions.$inferSelect;
type DocumentRow = typeof documents.$inferSelect;

export const reviewRoutes: FastifyPluginAsync = async (app) => {
  app.get('/reviews/queue', async () => {
    const rows = await app.db
      .select({
        documentId: documents.id,
        filename: documents.filename,
        docStatus: documents.status,
        detectedType: documents.detectedType,
        uploadedAt: documents.uploadedAt,
        extractionId: extractions.id,
        overallConfidence: extractions.overallConfidence,
        validationResults: extractions.validationResults,
        extractedJson: extractions.extractedJson,
        extractionStatus: extractions.status,
        extractedAt: extractions.extractedAt,
      })
      .from(documents)
      .innerJoin(
        extractions,
        and(
          eq(extractions.documentId, documents.id),
          eq(
            extractions.extractedAt,
            sql`(select max(extracted_at) from extractions where document_id = ${documents.id})`,
          ),
        ),
      )
      .where(eq(documents.status, 'pending_review'));

    // Look up schemas once so we can count "required fields missing" per doc.
    // Same treatment the fields-panel badge uses: overall=0 due to a required
    // field being null is a different signal from overall=0 due to a bad extraction.
    const schemaRows = await app.db.select().from(schemas).where(eq(schemas.isActive, true));
    const requiredByType = new Map<string, string[]>();
    for (const s of schemaRows) {
      const parsed = s.compiledJson as { fields?: Record<string, { required?: boolean }> };
      const fields = parsed?.fields ?? {};
      requiredByType.set(
        s.name,
        Object.entries(fields).filter(([, def]) => def.required).map(([name]) => name),
      );
    }

    const sorted = rows
      .map((r) => {
        const validations = Array.isArray(r.validationResults) ? r.validationResults : [];
        const hasError = validations.some((v) => v && typeof v === 'object' && (v as { severity?: string }).severity === 'error' && (v as { passed?: boolean }).passed === false);
        const conf = Number(r.overallConfidence ?? 0);
        const ageMs = Date.now() - new Date(r.uploadedAt).getTime();
        const ageDays = ageMs / (24 * 60 * 60 * 1000);
        const rank = (hasError ? 0 : 1) * 100 + (1 - conf) * 10 + ageDays;
        const extracted = typeof r.extractedJson === 'object' && r.extractedJson !== null ? (r.extractedJson as Record<string, unknown>) : {};
        const requiredFields = requiredByType.get(r.detectedType ?? '') ?? [];
        const missingRequired = requiredFields.filter((f) => extracted[f] == null || extracted[f] === '');
        return {
          documentId: r.documentId,
          filename: r.filename,
          vendorName: typeof extracted['vendor_name'] === 'string' ? extracted['vendor_name'] : null,
          total: typeof extracted['total'] === 'number' ? extracted['total'] : null,
          currency: typeof extracted['currency'] === 'string' ? extracted['currency'] : null,
          overallConfidence: conf,
          hasError,
          missingRequiredCount: missingRequired.length,
          uploadedAt: r.uploadedAt,
          _rank: rank,
        };
      })
      .sort((a, b) => a._rank - b._rank)
      .map(({ _rank, ...rest }) => (void _rank, rest));

    return { queue: sorted };
  });

  app.get('/reviews/:documentId', async (req, reply) => {
    const params = z.object({ documentId: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.badRequest('invalid documentId');

    const doc = (await app.db.select().from(documents).where(eq(documents.id, params.data.documentId)).limit(1))[0];
    if (!doc) return reply.notFound();

    const extraction = (
      await app.db
        .select()
        .from(extractions)
        .where(eq(extractions.documentId, params.data.documentId))
        .orderBy(desc(extractions.extractedAt))
        .limit(1)
    )[0];

    if (!extraction) {
      return { document: doc, extraction: null, schema: null };
    }

    const schemaRow = (
      await app.db.select().from(schemas).where(eq(schemas.id, extraction.schemaId)).limit(1)
    )[0];

    return {
      document: doc,
      extraction: {
        id: extraction.id,
        extractedJson: extraction.extractedJson,
        perFieldConfidence: extraction.perFieldConfidence,
        overallConfidence: Number(extraction.overallConfidence),
        validationResults: extraction.validationResults,
        status: extraction.status,
        version: extraction.version,
        model: extraction.modelUsed,
        costUsd: extraction.costUsd == null ? null : Number(extraction.costUsd),
        latencyMs: extraction.latencyMs,
      },
      schema: schemaRow?.compiledJson ?? null,
    };
  });

  app.post('/reviews/:documentId/correct', async (req, reply) => {
    const params = z.object({ documentId: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.badRequest('invalid documentId');
    const body = z
      .object({
        fieldPath: z.string().min(1),
        newValue: z.unknown(),
        note: z.string().optional(),
        expectedVersion: z.number().int().positive().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.badRequest('invalid body');

    const extraction = (
      await app.db
        .select()
        .from(extractions)
        .where(eq(extractions.documentId, params.data.documentId))
        .orderBy(desc(extractions.extractedAt))
        .limit(1)
    )[0];
    if (!extraction) return reply.notFound('no extraction to correct');
    if (body.data.expectedVersion != null && body.data.expectedVersion !== extraction.version) {
      return reply.code(409).send({ error: 'version conflict', currentVersion: extraction.version });
    }

    const schemaRow = (
      await app.db.select().from(schemas).where(eq(schemas.id, extraction.schemaId)).limit(1)
    )[0];
    if (!schemaRow) return reply.internalServerError('extraction references missing schema');
    const parsedSchema = domainSchemaSchema.parse(schemaRow.compiledJson);

    const currentJson = clone(extraction.extractedJson) as Record<string, unknown>;
    const oldValue = getPath(currentJson, body.data.fieldPath);
    setPath(currentJson, body.data.fieldPath, body.data.newValue);
    const validations = evaluateRules(parsedSchema.validations, currentJson, parsedSchema);
    const confidence = computeConfidence(parsedSchema, currentJson, validations);

    const { updated, correctionId } = await app.db.transaction(async (tx) => {
      const corrRows = await tx.insert(corrections).values({
        extractionId: extraction.id,
        fieldPath: body.data.fieldPath,
        oldValue: oldValue as never,
        newValue: body.data.newValue as never,
        correctionType: 'edit',
        note: body.data.note ?? null,
        correctedBy: 'reviewer',
      }).returning({ id: corrections.id });
      const corr = corrRows[0];
      if (!corr) throw new Error('failed to insert correction');
      const updRows = await tx
        .update(extractions)
        .set({
          extractedJson: currentJson as never,
          perFieldConfidence: confidence.perField as never,
          overallConfidence: confidence.overall.toString(),
          validationResults: validations as never,
          version: extraction.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(extractions.id, extraction.id))
        .returning();
      await appendEvent(tx, {
        eventType: 'correction.applied',
        aggregateType: 'extraction',
        aggregateId: extraction.id,
        payload: {
          documentId: params.data.documentId,
          fieldPath: body.data.fieldPath,
          oldValue,
          newValue: body.data.newValue,
          note: body.data.note ?? null,
        },
      });
      return { updated: updRows[0], correctionId: corr.id };
    });

    // fire-and-forget: hint pipeline picks this up. Failures are logged but
    // don't fail the correction request itself. Document type derived from the
    // extraction's own schema so hints get scoped correctly per domain.
    const docRow = (await app.db.select({ detectedType: documents.detectedType }).from(documents).where(eq(documents.id, params.data.documentId)).limit(1))[0];
    const documentType = docRow?.detectedType ?? 'invoice';
    const rawName = typeof currentJson['vendor_name'] === 'string'
      ? (currentJson['vendor_name'] as string)
      : typeof currentJson['merchant_name'] === 'string'
        ? (currentJson['merchant_name'] as string)
        : '';
    const vendorKey = normalizeVendor(rawName);
    if (vendorKey) {
      app.queue
        .publish(STREAMS.correctionApplied, {
          correctionId,
          extractionId: extraction.id,
          documentId: params.data.documentId,
          documentType,
          vendorKey,
          fieldPath: body.data.fieldPath,
        })
        .catch((err) => app.log.warn({ err }, 'correction.applied publish failed'));
    }

    return responseForExtraction(updated ?? extraction, validations, confidence.overall, confidence.perField);
  });

  app.post('/reviews/:documentId/approve', async (req, reply) => {
    const params = z.object({ documentId: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.badRequest('invalid documentId');
    const extraction = await latestExtraction(app.db, params.data.documentId);
    if (!extraction) return reply.notFound('no extraction to approve');

    await app.db.transaction(async (tx) => {
      await tx
        .update(extractions)
        .set({ status: 'approved', reviewedBy: 'reviewer', reviewedAt: new Date() })
        .where(eq(extractions.id, extraction.id));
      await tx.update(documents).set({ status: 'approved' }).where(eq(documents.id, params.data.documentId));
      await appendEvent(tx, {
        eventType: 'review.approved',
        aggregateType: 'extraction',
        aggregateId: extraction.id,
        payload: { documentId: params.data.documentId },
      });
    });
    return { ok: true };
  });

  app.post('/reviews/:documentId/reject', async (req, reply) => {
    const params = z.object({ documentId: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.badRequest('invalid documentId');
    const body = z.object({ reason: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.badRequest('reason required');
    const extraction = await latestExtraction(app.db, params.data.documentId);
    if (!extraction) return reply.notFound('no extraction to reject');

    await app.db.transaction(async (tx) => {
      await tx
        .update(extractions)
        .set({ status: 'rejected', reviewedBy: 'reviewer', reviewedAt: new Date() })
        .where(eq(extractions.id, extraction.id));
      await tx.update(documents).set({ status: 'rejected' }).where(eq(documents.id, params.data.documentId));
      await appendEvent(tx, {
        eventType: 'review.rejected',
        aggregateType: 'extraction',
        aggregateId: extraction.id,
        payload: { documentId: params.data.documentId, reason: body.data.reason },
      });
    });
    return { ok: true };
  });

  app.get('/documents/:id/pdf', async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.badRequest('invalid id');
    const doc = (await app.db.select().from(documents).where(eq(documents.id, params.data.id)).limit(1))[0];
    if (!doc) return reply.notFound();
    const buf = await app.storage.get(doc.storagePath);
    reply.header('content-type', doc.mimeType || 'application/pdf');
    reply.header('cache-control', 'private, max-age=60');
    return reply.send(buf);
  });
};

async function latestExtraction(db: Database, documentId: string): Promise<ExtractionRow | undefined> {
  return (
    await db
      .select()
      .from(extractions)
      .where(eq(extractions.documentId, documentId))
      .orderBy(desc(extractions.extractedAt))
      .limit(1)
  )[0];
}

function responseForExtraction(
  ex: ExtractionRow,
  validations: unknown,
  overall: number,
  perField: unknown,
) {
  return {
    id: ex.id,
    extractedJson: ex.extractedJson,
    perFieldConfidence: perField,
    overallConfidence: overall,
    validationResults: validations,
    status: ex.status,
    version: ex.version,
  };
}

/** Deep clone via JSON; extracted_json is always JSON-safe. */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Get/set at a lightweight path. Supports:
 *   "foo"              → obj.foo
 *   "foo.bar"          → obj.foo.bar
 *   "line_items[2].amount" → obj.line_items[2].amount
 */
function parsePath(path: string): (string | number)[] {
  const parts: (string | number)[] = [];
  for (const seg of path.split('.')) {
    const m = seg.matchAll(/([^\[\]]+)|\[(\d+)\]/g);
    for (const g of m) {
      if (g[1] !== undefined) parts.push(g[1]);
      else if (g[2] !== undefined) parts.push(Number(g[2]));
    }
  }
  return parts;
}

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of parsePath(path)) {
    if (cur == null) return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

function setPath(obj: unknown, path: string, value: unknown): void {
  const keys = parsePath(path);
  if (keys.length === 0) return;
  let cur: Record<string | number, unknown> = obj as Record<string | number, unknown>;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i]!;
    if (cur[key] == null || typeof cur[key] !== 'object') {
      cur[key] = typeof keys[i + 1] === 'number' ? [] : {};
    }
    cur = cur[key] as Record<string | number, unknown>;
  }
  cur[keys[keys.length - 1]!] = value;
}

// keep drizzle sql tag referenced (used in queue subquery above)
void sql;
