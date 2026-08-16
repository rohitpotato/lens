import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LlmClient, LlmResult } from '@lens/llm';
import { REPO_ROOT } from '../schema-loader.js';

const CACHE_DIR = path.join(REPO_ROOT, 'evals/.cache');

/**
 * Wraps an LlmClient with a file-based cache. Cache key includes model,
 * temperature, system, and the serialized messages — any prompt or model
 * change invalidates cleanly. `evals/.cache/` is git-ignored.
 */
export function withFileCache(inner: LlmClient, opts: { salt?: string } = {}): LlmClient {
  return {
    async chat(input) {
      const key = hashKey({ ...input, salt: opts.salt ?? '' });
      const filepath = path.join(CACHE_DIR, `${key}.json`);
      const cached = await readCache(filepath);
      if (cached) return cached;
      const result = await inner.chat(input);
      await writeCache(filepath, result);
      return result;
    },
  };
}

function hashKey(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32);
}

async function readCache(filepath: string): Promise<LlmResult | null> {
  try {
    const raw = await readFile(filepath, 'utf8');
    const parsed = JSON.parse(raw) as LlmResult;
    // Cost is a function of pricing at cache-write time; zero it on hit so
    // eval-report cost only reflects real spend.
    return { ...parsed, costUsd: 0 };
  } catch {
    return null;
  }
}

async function writeCache(filepath: string, result: LlmResult): Promise<void> {
  await mkdir(path.dirname(filepath), { recursive: true });
  await writeFile(filepath, JSON.stringify(result));
}
