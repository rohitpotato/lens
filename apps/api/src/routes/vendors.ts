import { and, desc, eq, sql } from 'drizzle-orm';
import { corrections, documents, extractions, promptHints } from '@lens/db';
import { normalizeVendor } from '@lens/pipeline';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

/**
 * "Vendor" is joined via the latest extraction's `vendor_name` field, then
 * normalized with the same rules the hint pipeline uses (see
 * @lens/pipeline#normalizeVendor). Normalization lives in JS — SQL would need
 * a duplicated helper function to strip corporate suffixes, and drift is a
 * bug waiting to happen. Aggregations are done in-memory; when this repo has
 * >10k invoices we'll want a materialized `document_vendor` column that
 * carries the normalized key alongside the raw name.
 */
export const vendorRoutes: FastifyPluginAsync = async (app) => {
  app.get('/vendors', async () => {
    const rows = await app.db
      .select({
        documentId: documents.id,
        docStatus: documents.status,
        uploadedAt: documents.uploadedAt,
        extractionStatus: extractions.status,
        vendorName: sql<string>`(${extractions.extractedJson} ->> 'vendor_name')`,
      })
      .from(documents)
      .innerJoin(
        extractions,
        and(
          eq(extractions.documentId, documents.id),
          eq(
            extractions.extractedAt,
            sql`(SELECT MAX(extracted_at) FROM extractions WHERE document_id = ${documents.id})`,
          ),
        ),
      );

    type Bucket = {
      total: number;
      approved: number;
      autoApproved: number;
      pending: number;
      lastSeen: string;
    };
    const byVendor = new Map<string, Bucket>();
    for (const r of rows) {
      const key = normalizeVendor(r.vendorName);
      if (!key) continue;
      const b: Bucket = byVendor.get(key) ?? {
        total: 0,
        approved: 0,
        autoApproved: 0,
        pending: 0,
        lastSeen: r.uploadedAt.toISOString(),
      };
      b.total += 1;
      if (r.docStatus === 'approved') b.approved += 1;
      if (r.extractionStatus === 'auto_approved') b.autoApproved += 1;
      if (r.docStatus === 'pending_review') b.pending += 1;
      const seen = r.uploadedAt.toISOString();
      if (seen > b.lastSeen) b.lastSeen = seen;
      byVendor.set(key, b);
    }

    const vendors = [...byVendor.entries()]
      .map(([vendor, b]) => ({
        vendor,
        total: b.total,
        approved: b.approved,
        autoApproved: b.autoApproved,
        pending: b.pending,
        // Touchless = zero human intervention. `documents.status='approved'`
        // is set for BOTH auto-approved AND human-approved docs, so summing
        // both counters double-counts. Use the extraction status alone.
        touchlessRate: b.total === 0 ? 0 : b.autoApproved / b.total,
        lastSeen: b.lastSeen,
      }))
      .sort((a, b) => b.total - a.total || b.lastSeen.localeCompare(a.lastSeen));

    return { vendors };
  });

  app.get('/vendors/:vendor', async (req, reply) => {
    const params = z.object({ vendor: z.string().min(1) }).safeParse(req.params);
    if (!params.success) return reply.badRequest('vendor required');
    const vendorKey = normalizeVendor(decodeURIComponent(params.data.vendor));

    // Fetch all (docs + latest extraction) rows and filter in JS by normalized vendor.
    const allRows = await app.db
      .select({
        documentId: documents.id,
        filename: documents.filename,
        docStatus: documents.status,
        uploadedAt: documents.uploadedAt,
        extractionId: extractions.id,
        extractionStatus: extractions.status,
        confidence: extractions.overallConfidence,
        vendorName: sql<string>`(${extractions.extractedJson} ->> 'vendor_name')`,
      })
      .from(documents)
      .innerJoin(
        extractions,
        and(
          eq(extractions.documentId, documents.id),
          eq(
            extractions.extractedAt,
            sql`(SELECT MAX(extracted_at) FROM extractions WHERE document_id = ${documents.id})`,
          ),
        ),
      );

    const forVendor = allRows.filter((r) => normalizeVendor(r.vendorName) === vendorKey);

    // Weekly bucket in JS to match normalization semantics.
    type WeeklyBucket = { total: number; autoApproved: number; approved: number };
    const weeklyMap = new Map<string, WeeklyBucket>();
    for (const r of forVendor) {
      const weekStart = startOfWeekIso(new Date(r.uploadedAt));
      const w: WeeklyBucket = weeklyMap.get(weekStart) ?? { total: 0, autoApproved: 0, approved: 0 };
      w.total += 1;
      if (r.extractionStatus === 'auto_approved') w.autoApproved += 1;
      if (r.docStatus === 'approved') w.approved += 1;
      weeklyMap.set(weekStart, w);
    }
    const weekly = [...weeklyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, w]) => ({
        weekStart,
        total: w.total,
        autoApproved: w.autoApproved,
        approved: w.approved,
        // See touchlessRate note in the vendor-list route above.
        touchlessRate: w.total === 0 ? 0 : w.autoApproved / w.total,
      }));

    // Adopted hints for this vendor.
    const adoptedHintsRows = await app.db
      .select()
      .from(promptHints)
      .where(
        and(
          eq(promptHints.matchingKey, vendorKey),
          eq(promptHints.status, 'adopted'),
          eq(promptHints.isActive, true),
        ),
      )
      .orderBy(desc(promptHints.updatedAt));
    const adoptedByField = new Map<string, Date>();
    for (const h of adoptedHintsRows) {
      const cur = adoptedByField.get(h.fieldPath);
      if (!cur || h.updatedAt > cur) adoptedByField.set(h.fieldPath, h.updatedAt);
    }

    // Correction hotspots — join corrections back to the vendor via extraction id set.
    const extractionIds = new Set(forVendor.map((r) => r.extractionId));
    const correctionRows = extractionIds.size === 0
      ? []
      : await app.db
          .select({
            fieldPath: corrections.fieldPath,
            correctedAt: corrections.correctedAt,
            extractionId: corrections.extractionId,
          })
          .from(corrections)
          .where(sql`${corrections.extractionId} = ANY(${sql.raw(`ARRAY[${[...extractionIds].map((id) => `'${id}'::uuid`).join(',')}]`)})`);

    type Hotspot = { total: number; before: number; after: number; adoptedAt: string | null };
    const hotspotMap = new Map<string, Hotspot>();
    for (const c of correctionRows) {
      const h: Hotspot = hotspotMap.get(c.fieldPath) ?? { total: 0, before: 0, after: 0, adoptedAt: null };
      h.total += 1;
      const adoptedAt = adoptedByField.get(c.fieldPath);
      if (adoptedAt && c.correctedAt >= adoptedAt) h.after += 1;
      else h.before += 1;
      if (adoptedAt) h.adoptedAt = adoptedAt.toISOString();
      hotspotMap.set(c.fieldPath, h);
    }
    const hotspots = [...hotspotMap.entries()]
      .map(([fieldPath, h]) => ({
        fieldPath,
        totalCorrections: h.total,
        beforeAdopt: h.before,
        afterAdopt: h.after,
        adoptedAt: h.adoptedAt,
      }))
      .sort((a, b) => b.totalCorrections - a.totalCorrections);

    const recentDocuments = forVendor
      .sort((a, b) => b.uploadedAt.toISOString().localeCompare(a.uploadedAt.toISOString()))
      .slice(0, 10)
      .map((r) => ({
        id: r.documentId,
        filename: r.filename,
        status: r.docStatus,
        uploadedAt: r.uploadedAt.toISOString(),
        confidence: Number(r.confidence ?? 0),
      }));

    return {
      vendor: vendorKey,
      weekly,
      hotspots,
      adoptedHints: adoptedHintsRows.map((h) => ({
        id: h.id,
        hint: h.hint,
        fieldPath: h.fieldPath,
        adoptedAt: h.updatedAt.toISOString(),
      })),
      recentDocuments,
    };
  });
};

function startOfWeekIso(d: Date): string {
  // ISO week starts Monday. Normalize to UTC to avoid drift.
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // days since Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  return monday.toISOString().slice(0, 10);
}
