/**
 * Greedy assignment: for each expected item, pick the best-matching
 * actual item by description similarity. Not optimal (true Hungarian
 * would be), but adequate for typical <30 line-items with distinct text.
 * Returns pairs [expectedIdx, actualIdx]; unmatched sides get null.
 */
export function alignLineItems(
  expected: Record<string, unknown>[],
  actual: Record<string, unknown>[],
): [number | null, number | null][] {
  const used = new Set<number>();
  const pairs: [number | null, number | null][] = [];

  for (let ei = 0; ei < expected.length; ei += 1) {
    const eDesc = String(expected[ei]?.['description'] ?? '');
    let bestScore = 0;
    let bestIdx = -1;
    for (let ai = 0; ai < actual.length; ai += 1) {
      if (used.has(ai)) continue;
      const aDesc = String(actual[ai]?.['description'] ?? '');
      const s = jaccard(tokens(eDesc), tokens(aDesc));
      if (s > bestScore) {
        bestScore = s;
        bestIdx = ai;
      }
    }
    if (bestIdx >= 0 && bestScore >= 0.4) {
      used.add(bestIdx);
      pairs.push([ei, bestIdx]);
    } else {
      pairs.push([ei, null]);
    }
  }
  for (let ai = 0; ai < actual.length; ai += 1) {
    if (!used.has(ai)) pairs.push([null, ai]);
  }
  return pairs;
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni === 0 ? 0 : inter / uni;
}
