import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { extractInvoice, type DomainSchema } from '@lens/pipeline';
import type { LlmClient } from '@lens/llm';
import { compareExtraction, type FixtureComparison } from '../compare/compare.js';
import { REPO_ROOT, loadInvoiceSchemaFromDisk, loadPromptFromDisk } from '../schema-loader.js';

export type FixtureResult = {
  fixtureId: string;
  comparison: FixtureComparison;
  costUsd: number;
  latencyMs: number;
  cacheHit: boolean;
};

export type RunOptions = {
  llm: LlmClient;
  fixtureFilter?: string;
};

export async function runEval(opts: RunOptions): Promise<{
  results: FixtureResult[];
  totals: { fixtures: number; passed: number; overallF1: number; costUsd: number };
  schema: DomainSchema;
  promptVersion: number;
}> {
  const schema = await loadInvoiceSchemaFromDisk();
  const prompt = await loadPromptFromDisk('extract_invoice');
  const fixturesDir = path.join(REPO_ROOT, 'evals/fixtures');
  const entries = (await readdir(fixturesDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !opts.fixtureFilter || name === opts.fixtureFilter)
    .sort();

  const results: FixtureResult[] = [];
  for (const name of entries) {
    const dir = path.join(fixturesDir, name);
    const pdf = await readFile(path.join(dir, 'input.pdf'));
    const expected = parseYaml(await readFile(path.join(dir, 'expected.yaml'), 'utf8')) as Record<
      string,
      unknown
    >;

    const before = Date.now();
    const extraction = await extractInvoice({
      llm: opts.llm,
      model: prompt.model,
      promptTemplate: prompt.content,
      schema,
      hints: [],
      pdf,
    });
    const latencyMs = Date.now() - before;

    if (!extraction.json) {
      results.push({
        fixtureId: name,
        comparison: {
          fields: [],
          precision: 0,
          recall: 0,
          f1: 0,
        },
        costUsd: extraction.costUsd,
        latencyMs,
        cacheHit: extraction.costUsd === 0,
      });
      continue;
    }

    const comparison = compareExtraction(schema, expected, extraction.json);
    results.push({
      fixtureId: name,
      comparison,
      costUsd: extraction.costUsd,
      latencyMs,
      cacheHit: extraction.costUsd === 0,
    });
  }

  const passed = results.filter((r) => r.comparison.f1 >= 0.99).length;
  const overallF1 =
    results.length === 0 ? 0 : results.reduce((a, r) => a + r.comparison.f1, 0) / results.length;
  const costUsd = results.reduce((a, r) => a + r.costUsd, 0);

  return {
    results,
    totals: { fixtures: results.length, passed, overallF1, costUsd },
    schema,
    promptVersion: prompt.version,
  };
}
