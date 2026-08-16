import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { prompts, type Database } from '@lens/db';
import { z } from 'zod';

const frontMatterSchema = z.object({
  name: z.string(),
  version: z.number().int().positive(),
  model: z.string(),
  temperature: z.number().min(0).max(2).default(0),
});
type FrontMatter = z.infer<typeof frontMatterSchema>;

export type LoadedPrompt = {
  id: string;
  name: string;
  version: number;
  model: string;
  content: string;
  temperature: number;
};

/**
 * Reads pipeline/prompts/*.md, parses YAML front-matter, and upserts each
 * as a new version if the body changed. Returns latest loaded prompts.
 */
export async function loadPromptFiles(
  db: Database,
  promptsDir: string,
): Promise<LoadedPrompt[]> {
  const files = (await readdir(promptsDir)).filter((f) => f.endsWith('.md'));
  const loaded: LoadedPrompt[] = [];

  for (const file of files) {
    const filePath = path.join(promptsDir, file);
    const raw = await readFile(filePath, 'utf8');
    const { front, body } = splitFrontMatter(raw);

    const existing = await db
      .select()
      .from(prompts)
      .where(eq(prompts.name, front.name))
      .orderBy(desc(prompts.version))
      .limit(1);

    const latest = existing[0];
    if (latest && latest.content === body && latest.model === front.model) {
      loaded.push({
        id: latest.id,
        name: latest.name,
        version: latest.version,
        model: latest.model,
        content: latest.content,
        temperature: front.temperature,
      });
      continue;
    }

    const nextVersion = latest ? latest.version + 1 : front.version;
    const inserted = await db
      .insert(prompts)
      .values({ name: front.name, version: nextVersion, content: body, model: front.model })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error(`failed to insert prompt ${front.name}`);
    loaded.push({
      id: row.id,
      name: row.name,
      version: row.version,
      model: row.model,
      content: row.content,
      temperature: front.temperature,
    });
  }

  return loaded;
}

export async function getActivePrompt(
  db: Database,
  name: string,
): Promise<{ id: string; content: string; model: string; version: number } | null> {
  const rows = await db
    .select()
    .from(prompts)
    .where(eq(prompts.name, name))
    .orderBy(desc(prompts.version))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, content: row.content, model: row.model, version: row.version };
}

function splitFrontMatter(raw: string): { front: FrontMatter; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) throw new Error('missing front-matter block');
  const [, header, body] = match;
  const parsed: Record<string, unknown> = {};
  for (const line of (header ?? '').split('\n')) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, k, v] = kv;
    if (!k) continue;
    const trimmed = (v ?? '').trim();
    parsed[k] = /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : trimmed;
  }
  return { front: frontMatterSchema.parse(parsed), body: (body ?? '').trim() };
}

// used by the `and` import — keep it referenced so tree-shakers don't
// prune it before we add the compound filter in Phase 4.
void and;
