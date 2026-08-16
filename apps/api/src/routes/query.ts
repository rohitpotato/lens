import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const MAX_ROWS = 500;
const STATEMENT_TIMEOUT_MS = 5_000;

type Insight = { slug: string; title: string; description: string; sql: string };

/**
 * Where the pre-baked SQL files live on disk. Resolved from the api's cwd
 * (apps/api when running `pnpm --filter @lens/api dev`).
 */
function queriesDir(): string {
  return path.resolve(process.cwd(), '../../queries');
}

async function loadInsights(): Promise<Insight[]> {
  const dir = queriesDir();
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql'));
  const insights: Insight[] = [];
  for (const file of files) {
    const raw = await readFile(path.join(dir, file), 'utf8');
    const lines = raw.split('\n');
    let title = file;
    let description = '';
    for (const line of lines) {
      const m = line.match(/^--\s*(title|description)\s*:\s*(.*)$/i);
      if (!m) continue;
      const key = m[1]!.toLowerCase();
      const value = m[2]!.trim();
      if (key === 'title') title = value;
      else if (key === 'description') description = value;
    }
    insights.push({
      slug: file.replace(/\.sql$/, ''),
      title,
      description,
      sql: raw,
    });
  }
  return insights.sort((a, b) => a.slug.localeCompare(b.slug));
}

export const queryRoutes: FastifyPluginAsync = async (app) => {
  const insights = await loadInsights();
  const bySlug = new Map(insights.map((i) => [i.slug, i]));

  app.get('/query/insights', async () => ({
    insights: insights.map(({ sql, ...rest }) => (void sql, rest)),
  }));

  app.get('/query/insights/:slug', async (req, reply) => {
    const params = z.object({ slug: z.string() }).parse(req.params);
    const insight = bySlug.get(params.slug);
    if (!insight) return reply.notFound();
    return insight;
  });

  app.post('/query/run', async (req, reply) => {
    const body = z.object({ sql: z.string().min(1).max(20_000) }).safeParse(req.body);
    if (!body.success) return reply.badRequest('sql required');

    try {
      const rows = await app.db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`));
        await tx.execute(sql.raw('SET LOCAL transaction_read_only = ON'));
        const rawResult = await tx.execute(sql.raw(body.data.sql));
        return rawResult as unknown as Record<string, unknown>[];
      });

      const capped = rows.slice(0, MAX_ROWS);
      const columns = capped.length > 0 ? Object.keys(capped[0]!) : [];
      return {
        columns,
        rows: capped,
        totalRows: rows.length,
        truncated: rows.length > MAX_ROWS,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Distinguish read-only violation vs syntax vs timeout vs other.
      let code = 'error';
      if (/read.only/i.test(message)) code = 'read_only_violation';
      else if (/canceling statement due to statement timeout/i.test(message)) code = 'timeout';
      else if (/syntax error/i.test(message)) code = 'syntax_error';
      return reply.code(400).send({ error: message, code });
    }
  });
};
