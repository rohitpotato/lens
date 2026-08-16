import fp from 'fastify-plugin';
import { sql } from 'drizzle-orm';
import { extractions } from '@lens/db';

declare module 'fastify' {
  interface FastifyInstance {
    checkCostGuard(): Promise<{ ok: true } | { ok: false; spent: number; cap: number }>;
  }
}

/**
 * Read the day's LLM spend from extractions.cost_usd and compare to the
 * configured daily cap. Called before publishing an upload to the pipeline
 * — a doc that never enters the stream never bills.
 *
 * The check is best-effort: it lags in-flight extractions by a few seconds,
 * so pick a cap that has headroom above real usage.
 */
export const costGuardPlugin = fp<{ dailyCapUsd: number }>(async (app, opts) => {
  app.decorate('checkCostGuard', async () => {
    if (opts.dailyCapUsd <= 0) return { ok: true };
    const rows = await app.db.execute<{ spent: string | null }>(
      sql`SELECT COALESCE(SUM(cost_usd)::text, '0') AS spent
          FROM ${extractions}
          WHERE extracted_at >= NOW() - INTERVAL '24 hours'`,
    );
    const spent = Number(rows[0]?.spent ?? 0);
    return spent >= opts.dailyCapUsd
      ? { ok: false, spent, cap: opts.dailyCapUsd }
      : { ok: true };
  });
});
