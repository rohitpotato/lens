import { createHash } from 'node:crypto';
import path from 'node:path';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { appendEvent, documents, extractions } from '@lens/db';
import {
  costCapHitsTotal,
  documentsUploadedTotal,
  uploadRejectedTotal,
} from '@lens/metrics';
import { STREAMS } from '@lens/queue';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg']);

/**
 * Wraps a PNG/JPEG into a single-page PDF sized to the image's aspect ratio.
 * Downstream classify/extract only speak PDF — this normalizes at the door.
 */
async function imageToPdf(imageBytes: Buffer, mime: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const embedded = mime === 'image/png'
    ? await pdf.embedPng(imageBytes)
    : await pdf.embedJpg(imageBytes);
  const { width, height } = embedded.scale(1);
  const page = pdf.addPage([width, height]);
  page.drawImage(embedded, { x: 0, y: 0, width, height });
  const pdfBytes = await pdf.save();
  return Buffer.from(pdfBytes);
}

const uploadResponse = z.object({
  id: z.string().uuid(),
  status: z.string(),
  dedup: z.boolean(),
});

export const documentRoutes: FastifyPluginAsync = async (app) => {
  app.post('/documents', { config: { rateLimit: {} } }, async (req, reply) => {
    const guard = await app.checkCostGuard();
    if (!guard.ok) {
      costCapHitsTotal.inc();
      return reply.code(503).send({
        error: 'daily cost cap reached',
        code: 'cost_cap_reached',
        spent: guard.spent,
        cap: guard.cap,
      });
    }

    const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
    if (!file) {
      uploadRejectedTotal.inc({ reason: 'missing_file' });
      return reply.badRequest('missing file');
    }
    const sourceMime = file.mimetype || 'unknown';

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of file.file) {
      total += chunk.length;
      if (total > MAX_UPLOAD_BYTES) {
        uploadRejectedTotal.inc({ reason: 'too_large' });
        return reply.code(413).send({ error: 'file too large', maxBytes: MAX_UPLOAD_BYTES });
      }
      chunks.push(chunk);
    }
    if (file.file.truncated) {
      uploadRejectedTotal.inc({ reason: 'too_large' });
      return reply.code(413).send({ error: 'file too large', maxBytes: MAX_UPLOAD_BYTES });
    }
    let buffer: Buffer = Buffer.concat(chunks);
    let filename = file.filename;
    let mimeType = file.mimetype;
    if (IMAGE_MIME.has(mimeType)) {
      try {
        buffer = await imageToPdf(buffer, mimeType);
        filename = filename.replace(/\.(png|jpe?g)$/i, '') + '.pdf';
        mimeType = 'application/pdf';
      } catch (err) {
        app.log.error({ err }, 'image-to-pdf conversion failed');
        uploadRejectedTotal.inc({ reason: 'image_conversion_failed' });
        return reply.code(400).send({ error: 'could not read image', code: 'image_conversion_failed' });
      }
    }
    const hash = createHash('sha256').update(buffer).digest('hex');

    const existing = await app.db
      .select()
      .from(documents)
      .where(eq(documents.fileHash, hash))
      .limit(1);
    if (existing.length > 0) {
      const row = existing[0]!;
      documentsUploadedTotal.inc({ dedup: 'hit', source_mime: sourceMime });
      return uploadResponse.parse({ id: row.id, status: row.status, dedup: true });
    }

    const ext = path.extname(filename).replace(/^\./, '').toLowerCase() || 'pdf';
    const key = app.storage.keyFor(hash, ext);
    await app.storage.put(key, buffer, mimeType);

    const inserted = await app.db.transaction(async (tx) => {
      const rows = await tx
        .insert(documents)
        .values({
          filename,
          mimeType,
          storagePath: key,
          fileHash: hash,
          status: 'uploaded',
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('failed to insert document');
      await appendEvent(tx, {
        eventType: 'document.uploaded',
        aggregateType: 'document',
        aggregateId: row.id,
        payload: { filename, sizeBytes: buffer.length, storagePath: key },
      });
      return row;
    });

    await app.queue.publish(STREAMS.documentUploaded, { documentId: inserted.id });
    documentsUploadedTotal.inc({ dedup: 'miss', source_mime: sourceMime });
    return uploadResponse.parse({ id: inserted.id, status: inserted.status, dedup: false });
  });

  app.get('/documents', async (req) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        status: z.string().optional(),
      })
      .parse(req.query ?? {});

    const rows = await app.db
      .select({
        id: documents.id,
        filename: documents.filename,
        status: documents.status,
        detectedType: documents.detectedType,
        detectedTypeConfidence: documents.detectedTypeConfidence,
        uploadedAt: documents.uploadedAt,
      })
      .from(documents)
      .where(q.status ? eq(documents.status, q.status) : undefined)
      .orderBy(desc(documents.uploadedAt))
      .limit(q.limit);

    // Fetch all extractions for these docs and pick the latest per doc in JS.
    // The correlated-subquery form (`extracted_at = (SELECT MAX(...) WHERE doc_id = doc_id)`)
    // was flaky through Drizzle's sql`` tag on some connections.
    const ids = rows.map((r) => r.id);
    const allExtractions =
      ids.length === 0
        ? []
        : await app.db
            .select({
              documentId: extractions.documentId,
              overallConfidence: extractions.overallConfidence,
              extractionStatus: extractions.status,
              vendorName: sql<string | null>`(${extractions.extractedJson} ->> 'vendor_name')`,
              total: sql<string | null>`(${extractions.extractedJson} ->> 'total')`,
              currency: sql<string | null>`(${extractions.extractedJson} ->> 'currency')`,
              extractedAt: extractions.extractedAt,
            })
            .from(extractions)
            .where(inArray(extractions.documentId, ids));

    const byDoc = new Map<string, (typeof allExtractions)[number]>();
    for (const e of allExtractions) {
      const existing = byDoc.get(e.documentId);
      if (!existing || e.extractedAt > existing.extractedAt) byDoc.set(e.documentId, e);
    }

    return {
      documents: rows.map((r) => {
        const e = byDoc.get(r.id);
        return {
          id: r.id,
          filename: r.filename,
          status: r.status,
          detectedType: r.detectedType,
          detectedTypeConfidence: r.detectedTypeConfidence == null ? null : Number(r.detectedTypeConfidence),
          uploadedAt: r.uploadedAt,
          extraction: e
            ? {
                status: e.extractionStatus,
                overallConfidence: Number(e.overallConfidence ?? 0),
                vendorName: e.vendorName,
                total: e.total == null ? null : Number(e.total),
                currency: e.currency,
              }
            : null,
        };
      }),
    };
  });

  app.get('/documents/:id', async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.badRequest('invalid id');
    const rows = await app.db.select().from(documents).where(eq(documents.id, params.data.id)).limit(1);
    const row = rows[0];
    if (!row) return reply.notFound();
    return row;
  });
};
