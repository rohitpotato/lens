import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { domainSchemaSchema, type DomainSchema } from '@lens/pipeline';

/**
 * File-based schema / prompt loading for eval scripts.
 * Deliberately skips the DB upsert path the API uses — eval reads git as
 * source of truth so runs are deterministic and don't require a booted DB.
 */
export const REPO_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '../..');

export async function loadInvoiceSchemaFromDisk(): Promise<DomainSchema> {
  const yaml = await readFile(path.join(REPO_ROOT, 'domains/invoice/schema.yaml'), 'utf8');
  return domainSchemaSchema.parse(parseYaml(yaml));
}

/**
 * Find the highest-versioned prompt file matching `<name>.v<n>.md` on disk.
 * Filename version is the tiebreaker; front-matter `version` is the source of
 * truth inside the file.
 */
export async function loadPromptFromDisk(name: string): Promise<{ content: string; model: string; version: number }> {
  const dir = path.join(REPO_ROOT, 'pipeline/prompts');
  const files = await readdir(dir);
  const re = new RegExp(`^${name}\\.v(\\d+)\\.md$`);
  let bestFile: string | null = null;
  let bestVer = -1;
  for (const f of files) {
    const m = f.match(re);
    if (!m) continue;
    const v = Number(m[1]);
    if (v > bestVer) {
      bestVer = v;
      bestFile = f;
    }
  }
  if (!bestFile) throw new Error(`no prompt file for "${name}" in ${dir}`);
  const p = path.join(dir, bestFile);
  const raw = await readFile(p, 'utf8');
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) throw new Error(`missing front-matter in ${p}`);
  const [, header, body] = match;
  const fields: Record<string, string> = {};
  for (const line of (header ?? '').split('\n')) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv && kv[1]) fields[kv[1]] = (kv[2] ?? '').trim();
  }
  return {
    content: (body ?? '').trim(),
    model: fields['model'] ?? 'claude-sonnet-4-6',
    version: Number(fields['version'] ?? bestVer),
  };
}
