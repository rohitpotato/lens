import { and, desc, eq } from 'drizzle-orm';
import { promptHints } from '@lens/db';
import { hintsTotal } from '@lens/metrics';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const STATUSES = ['suggested', 'adopted', 'ignored'] as const;

export const ruleRoutes: FastifyPluginAsync = async (app) => {
  app.get('/rules', async (req) => {
    const q = z
      .object({
        status: z.enum(STATUSES).optional(),
        documentType: z.string().optional(),
      })
      .parse(req.query ?? {});

    const clauses = [eq(promptHints.isActive, true)];
    if (q.status) clauses.push(eq(promptHints.status, q.status));
    if (q.documentType) clauses.push(eq(promptHints.documentType, q.documentType));

    const rows = await app.db
      .select()
      .from(promptHints)
      .where(and(...clauses))
      .orderBy(desc(promptHints.createdAt));

    return {
      rules: rows.map((r) => ({
        id: r.id,
        documentType: r.documentType,
        vendor: r.matchingKey,
        fieldPath: r.fieldPath,
        hint: r.hint,
        note: r.note,
        status: r.status,
        evidenceCount: r.evidenceCount,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  });

  app.post('/rules/:id/adopt', async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await app.db
      .update(promptHints)
      .set({ status: 'adopted', updatedAt: new Date() })
      .where(eq(promptHints.id, params.id))
      .returning();
    if (rows.length === 0) return reply.notFound();
    hintsTotal.inc({ document_type: rows[0]!.documentType, action: 'adopted' });
    return { ok: true, id: rows[0]!.id };
  });

  app.post('/rules/:id/ignore', async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await app.db
      .update(promptHints)
      .set({ status: 'ignored', updatedAt: new Date() })
      .where(eq(promptHints.id, params.id))
      .returning();
    if (rows.length === 0) return reply.notFound();
    hintsTotal.inc({ document_type: rows[0]!.documentType, action: 'ignored' });
    return { ok: true, id: rows[0]!.id };
  });

  app.patch('/rules/:id', async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ hint: z.string().min(1) }).parse(req.body);
    const rows = await app.db
      .update(promptHints)
      .set({ hint: body.hint, updatedAt: new Date() })
      .where(eq(promptHints.id, params.id))
      .returning();
    if (rows.length === 0) return reply.notFound();
    hintsTotal.inc({ document_type: rows[0]!.documentType, action: 'modified' });
    return { ok: true, id: rows[0]!.id, hint: rows[0]!.hint };
  });
};
