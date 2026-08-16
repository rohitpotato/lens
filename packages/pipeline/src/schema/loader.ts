import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import { schemas, type Database } from '@lens/db';
import { domainSchemaSchema, type DomainSchema } from './types.js';

export type LoadedSchema = {
  id: string;
  name: string;
  version: number;
  parsed: DomainSchema;
};

/**
 * Reads all domains/<type>/schema.yaml files. For each, parses + validates,
 * compares to the latest active DB version, and inserts a NEW version if the
 * YAML has changed. Returns the currently-active loaded schemas.
 */
export async function loadDomainSchemas(
  db: Database,
  domainsDir: string,
): Promise<LoadedSchema[]> {
  const files = await findSchemaFiles(domainsDir);
  const loaded: LoadedSchema[] = [];

  for (const file of files) {
    const yamlText = await readFile(file, 'utf8');
    const parsed = domainSchemaSchema.parse(parseYaml(yamlText));

    const existing = await db
      .select()
      .from(schemas)
      .where(and(eq(schemas.name, parsed.name), eq(schemas.isActive, true)))
      .orderBy(desc(schemas.version))
      .limit(1);

    const latest = existing[0];
    if (latest && latest.yamlDefinition === yamlText) {
      loaded.push({ id: latest.id, name: latest.name, version: latest.version, parsed });
      continue;
    }

    const nextVersion = latest ? latest.version + 1 : parsed.version;
    if (latest) {
      await db.update(schemas).set({ isActive: false }).where(eq(schemas.id, latest.id));
    }
    const inserted = await db
      .insert(schemas)
      .values({
        name: parsed.name,
        version: nextVersion,
        yamlDefinition: yamlText,
        compiledJson: parsed as never,
        isActive: true,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error(`failed to insert schema ${parsed.name}`);
    loaded.push({ id: row.id, name: row.name, version: row.version, parsed });
  }

  return loaded;
}

async function findSchemaFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(dir, entry.name, 'schema.yaml');
    try {
      await readFile(candidate);
      files.push(candidate);
    } catch {
      // no schema.yaml in this domain dir; skip.
    }
  }
  return files;
}
