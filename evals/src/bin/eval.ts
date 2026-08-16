#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createAnthropicClient } from '@lens/llm';
import { withFileCache } from '../cache/cache.js';
import { runEval, type FixtureResult } from '../runner/runner.js';
import { diffAgainstBaseline, renderMarkdown, type Baseline } from '../report/markdown.js';
import { REPO_ROOT } from '../schema-loader.js';

type Args = {
  fixture?: string;
  blockOnRegression: boolean;
  updateBaseline: boolean;
  format: 'text' | 'markdown' | 'github';
};

function parseArgs(argv: string[]): Args {
  const args: Args = { blockOnRegression: false, updateBaseline: false, format: 'text' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--fixture' && next) {
      args.fixture = next;
      i += 1;
    } else if (arg === '--block-on-regression') {
      args.blockOnRegression = true;
    } else if (arg === '--update-baseline') {
      args.updateBaseline = true;
    } else if (arg === '--format' && next) {
      if (next === 'text' || next === 'markdown' || next === 'github') args.format = next;
      i += 1;
    }
  }
  return args;
}

async function loadBaseline(): Promise<Baseline | null> {
  try {
    const raw = await readFile(path.join(REPO_ROOT, 'evals/reports/baseline.json'), 'utf8');
    return JSON.parse(raw) as Baseline;
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is required');
    process.exit(2);
  }
  const llm = withFileCache(createAnthropicClient({ apiKey }));

  const runOpts = { llm } as Parameters<typeof runEval>[0];
  if (args.fixture) runOpts.fixtureFilter = args.fixture;
  const run = await runEval(runOpts);
  const baseline = await loadBaseline();
  const diff = diffAgainstBaseline(run.results, baseline);

  const md = renderMarkdown({
    results: run.results,
    totals: run.totals,
    diff,
    baseline,
    promptVersion: run.promptVersion,
  });

  const reportsDir = path.join(REPO_ROOT, 'evals/reports');
  await mkdir(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(reportsDir, `${stamp}.md`);
  await writeFile(reportPath, md);

  if (args.format === 'markdown' || args.format === 'github') {
    process.stdout.write(md + '\n');
    if (args.format === 'github' && process.env['GITHUB_OUTPUT']) {
      const encoded = md.replaceAll('%', '%25').replaceAll('\n', '%0A').replaceAll('\r', '%0D');
      await writeFile(process.env['GITHUB_OUTPUT'], `report<<EOF\n${md}\nEOF\n`, { flag: 'a' });
      void encoded;
    }
  } else {
    printTextSummary(run.results, run.totals, diff, baseline);
  }
  console.error(`\nreport → ${path.relative(REPO_ROOT, reportPath)}`);

  if (args.updateBaseline) {
    const newBaseline: Baseline = {
      ranAt: new Date().toISOString(),
      overallF1: run.totals.overallF1,
      perFixture: Object.fromEntries(run.results.map((r) => [r.fixtureId, r.comparison.f1])),
    };
    await writeFile(
      path.join(reportsDir, 'baseline.json'),
      JSON.stringify(newBaseline, null, 2) + '\n',
    );
    console.error('baseline updated');
  }

  if (args.blockOnRegression && diff.regressions.length > 0) {
    console.error(`\nblocking due to ${diff.regressions.length} regression(s)`);
    process.exit(1);
  }
}

function printTextSummary(
  results: FixtureResult[],
  totals: { fixtures: number; passed: number; overallF1: number; costUsd: number },
  diff: ReturnType<typeof diffAgainstBaseline>,
  baseline: Baseline | null,
) {
  const beforeF1 = baseline?.overallF1;
  const delta = beforeF1 != null ? totals.overallF1 - beforeF1 : null;
  console.log(
    `Overall F1: ${totals.overallF1.toFixed(3)}${delta != null ? ` (${delta >= 0 ? '+' : ''}${delta.toFixed(3)})` : ''}`,
  );
  console.log(`Fixtures: ${totals.fixtures} · Passed: ${totals.passed} · Cost: $${totals.costUsd.toFixed(4)}\n`);
  for (const r of results) {
    const before = baseline?.perFixture[r.fixtureId];
    const arrow = before != null ? (r.comparison.f1 > before ? '↑' : r.comparison.f1 < before ? '↓' : '·') : '·';
    console.log(
      `  ${arrow} ${r.fixtureId.padEnd(28)} F1=${r.comparison.f1.toFixed(3)} P=${r.comparison.precision.toFixed(3)} R=${r.comparison.recall.toFixed(3)} ${r.cacheHit ? 'cache' : '$' + r.costUsd.toFixed(4)}`,
    );
  }
  if (diff.regressions.length > 0) {
    console.log(`\nRegressions: ${diff.regressions.map((r) => r.fixtureId).join(', ')}`);
  }
}

void main();
