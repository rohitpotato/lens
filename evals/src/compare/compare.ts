import type { DomainSchema, FieldDef } from '@lens/pipeline';
import { alignLineItems } from './list-align.js';

export type FieldMatch = {
  field: string;
  expected: unknown;
  actual: unknown;
  match: boolean;
  reason?: string;
};

export type FixtureComparison = {
  fields: FieldMatch[];
  precision: number;
  recall: number;
  f1: number;
};

/**
 * Compare an extraction to expected values field-by-field using type-aware
 * matching. F1 treats each field as one binary decision (correct / not).
 * Missing expected fields don't count against precision; missing actual
 * fields count against recall.
 */
export function compareExtraction(
  schema: DomainSchema,
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): FixtureComparison {
  const fields: FieldMatch[] = [];
  let tp = 0;
  let fp = 0;
  let fn = 0;

  for (const [name, def] of Object.entries(schema.fields)) {
    const e = expected[name];
    const a = actual[name];
    const eNull = e == null;
    const aNull = a == null;
    if (eNull && aNull) continue;

    let matched: { match: boolean; reason?: string };
    if (def.type === 'list' && 'element' in def) {
      matched = compareList(def.element as Record<string, FieldDef>, e, a);
    } else {
      matched = compareScalar(def.type, e, a);
    }

    fields.push({ field: name, expected: e, actual: a, ...matched });
    if (matched.match) tp += 1;
    else if (!aNull) fp += 1;
    else fn += 1;
    if (!matched.match && !eNull && aNull) fn = fn; // already counted above
  }

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { fields, precision, recall, f1 };
}

function compareScalar(type: string, expected: unknown, actual: unknown): { match: boolean; reason?: string } {
  if (expected == null && actual == null) return { match: true };
  if (expected == null || actual == null) return { match: false, reason: 'one side null' };

  switch (type) {
    case 'string':
    case 'enum':
      return typeof expected === 'string' && typeof actual === 'string'
        ? matchStrings(expected, actual)
        : { match: false, reason: 'type mismatch' };
    case 'number':
    case 'money':
      return typeof expected === 'number' && typeof actual === 'number'
        ? { match: Math.abs(expected - actual) < 0.01, reason: `|Δ|=${Math.abs(expected - actual).toFixed(3)}` }
        : { match: false, reason: 'type mismatch' };
    case 'date':
      return typeof expected === 'string' && typeof actual === 'string'
        ? { match: expected === actual }
        : { match: false, reason: 'type mismatch' };
    default:
      return { match: JSON.stringify(expected) === JSON.stringify(actual) };
  }
}

function matchStrings(a: string, b: string): { match: boolean; reason?: string } {
  if (a === b) return { match: true };
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
  return { match: norm(a) === norm(b), reason: 'normalized' };
}

function compareList(
  element: Record<string, FieldDef>,
  expected: unknown,
  actual: unknown,
): { match: boolean; reason?: string } {
  const eArr = Array.isArray(expected) ? (expected as Record<string, unknown>[]) : [];
  const aArr = Array.isArray(actual) ? (actual as Record<string, unknown>[]) : [];
  if (eArr.length === 0 && aArr.length === 0) return { match: true };

  const pairs = alignLineItems(eArr, aArr);
  let matched = 0;
  const total = Math.max(eArr.length, aArr.length);
  for (const [eIdx, aIdx] of pairs) {
    if (eIdx == null || aIdx == null) continue;
    const eRow = eArr[eIdx]!;
    const aRow = aArr[aIdx]!;
    let allMatch = true;
    for (const [ek, edef] of Object.entries(element)) {
      const sub = compareScalar(edef.type, eRow[ek], aRow[ek]);
      if (!sub.match) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) matched += 1;
  }
  return {
    match: matched === total,
    reason: `${matched}/${total} rows matched`,
  };
}
