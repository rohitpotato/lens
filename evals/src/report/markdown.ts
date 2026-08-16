import type { FixtureResult } from '../runner/runner.js';

export type Baseline = {
  ranAt: string;
  overallF1: number;
  perFixture: Record<string, number>;
};

export type Diff = {
  regressions: { fixtureId: string; before: number; after: number }[];
  improvements: { fixtureId: string; before: number; after: number }[];
  newFixtures: string[];
};

const THRESHOLD = 0.02;

export function diffAgainstBaseline(results: FixtureResult[], baseline: Baseline | null): Diff {
  const regressions: Diff['regressions'] = [];
  const improvements: Diff['improvements'] = [];
  const newFixtures: string[] = [];

  for (const r of results) {
    const before = baseline?.perFixture[r.fixtureId];
    if (before == null) {
      newFixtures.push(r.fixtureId);
      continue;
    }
    const after = r.comparison.f1;
    if (after < before - THRESHOLD) regressions.push({ fixtureId: r.fixtureId, before, after });
    else if (after > before + THRESHOLD) improvements.push({ fixtureId: r.fixtureId, before, after });
  }
  return { regressions, improvements, newFixtures };
}

export function renderMarkdown(input: {
  results: FixtureResult[];
  totals: { fixtures: number; passed: number; overallF1: number; costUsd: number };
  diff: Diff;
  baseline: Baseline | null;
  promptVersion: number;
}): string {
  const { results, totals, diff, baseline, promptVersion } = input;
  const beforeF1 = baseline?.overallF1;
  const delta = beforeF1 != null ? totals.overallF1 - beforeF1 : null;

  const rows = results
    .map((r) => {
      const before = baseline?.perFixture[r.fixtureId];
      const arrow = before != null ? (r.comparison.f1 > before ? '↑' : r.comparison.f1 < before ? '↓' : '→') : '·';
      return `| ${r.fixtureId} | ${r.comparison.f1.toFixed(3)} | ${arrow} | ${before?.toFixed(3) ?? '—'} | ${r.comparison.precision.toFixed(3)} | ${r.comparison.recall.toFixed(3)} | ${r.cacheHit ? '💾' : '$' + r.costUsd.toFixed(4)} |`;
    })
    .join('\n');

  const lines: string[] = [];
  lines.push(`# Eval report — extract_invoice v${promptVersion}`);
  lines.push('');
  lines.push(
    `**Overall F1: ${totals.overallF1.toFixed(3)}**` +
      (delta != null ? ` (${delta >= 0 ? '+' : ''}${delta.toFixed(3)} vs baseline)` : ''),
  );
  lines.push(`Fixtures: ${totals.fixtures} · Passed (F1≥0.99): ${totals.passed} · Cost: $${totals.costUsd.toFixed(4)}`);
  lines.push('');
  lines.push('| Fixture | F1 | Δ | Baseline | Precision | Recall | Cost |');
  lines.push('|---|---:|:-:|---:|---:|---:|---:|');
  lines.push(rows);
  lines.push('');

  if (diff.regressions.length > 0) {
    lines.push('## ⚠️ Regressions');
    for (const r of diff.regressions) {
      lines.push(`- **${r.fixtureId}**: F1 ${r.before.toFixed(3)} → ${r.after.toFixed(3)}`);
    }
    lines.push('');
  }

  if (diff.improvements.length > 0) {
    lines.push('## ✅ Improvements');
    for (const r of diff.improvements) {
      lines.push(`- **${r.fixtureId}**: F1 ${r.before.toFixed(3)} → ${r.after.toFixed(3)}`);
    }
    lines.push('');
  }

  if (diff.newFixtures.length > 0) {
    lines.push('## 🆕 New fixtures (no baseline yet)');
    for (const id of diff.newFixtures) lines.push(`- ${id}`);
    lines.push('');
  }

  return lines.join('\n');
}
