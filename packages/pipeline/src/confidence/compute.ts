import type { DomainSchema, FieldDef } from '../schema/types.js';
import type { ValidationResult } from '../validate/engine.js';

export type FieldConfidence = {
  score: number;
  signals: Record<string, number>;
};

export type ConfidenceReport = {
  perField: Record<string, FieldConfidence>;
  overall: number;
};

const WEIGHTS = {
  typeMatch: 0.3,
  requiredPresent: 0.3,
  rulesPassed: 0.25,
  patternMatch: 0.15,
} as const;

/**
 * Combines four structural signals into a per-field confidence.
 * Weights renormalize when a signal doesn't apply to a given field
 * (e.g. no pattern declared → patternMatch is dropped from the denominator).
 *
 * Overall confidence is min(perField) — weakest link — because a document
 * with one bad field cannot be auto-approved.
 */
export function computeConfidence(
  schema: DomainSchema,
  extracted: Record<string, unknown>,
  validations: readonly ValidationResult[],
): ConfidenceReport {
  const perField: Record<string, FieldConfidence> = {};

  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    const value = extracted[fieldName];
    const scalar = fieldDef.type !== 'list' ? (fieldDef as Exclude<FieldDef, { type: 'list' }>) : null;

    const signals: Record<string, number> = {};
    const active: (keyof typeof WEIGHTS)[] = [];

    // Signal 1: type match
    signals.typeMatch = typeMatches(fieldDef, value) ? 1 : 0;
    active.push('typeMatch');

    // Signal 2: required-present
    if (fieldDef.required) {
      signals.requiredPresent = value == null || value === '' ? 0 : 1;
      active.push('requiredPresent');
    }

    // Signal 3: rules passed (rules that mention this field via suggests.field or by name substring)
    const relevant = validations.filter(
      (v) => v.suggestsField === fieldName || v.name.includes(fieldName),
    );
    if (relevant.length > 0) {
      const passed = relevant.filter((v) => v.passed).length;
      signals.rulesPassed = passed / relevant.length;
      active.push('rulesPassed');
    }

    // Signal 4: regex pattern match
    if (scalar?.pattern && typeof value === 'string') {
      signals.patternMatch = new RegExp(scalar.pattern).test(value) ? 1 : 0;
      active.push('patternMatch');
    }

    const denom = active.reduce((acc, k) => acc + WEIGHTS[k], 0) || 1;
    const numer = active.reduce((acc, k) => acc + WEIGHTS[k] * (signals[k] ?? 0), 0);
    perField[fieldName] = { score: numer / denom, signals };
  }

  const scores = Object.values(perField).map((f) => f.score);
  const overall = scores.length ? Math.min(...scores) : 0;
  return { perField, overall };
}

function typeMatches(def: FieldDef, value: unknown): boolean {
  if (value == null) return !def.required;
  switch (def.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
    case 'money':
      return typeof value === 'number' && Number.isFinite(value);
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    case 'enum':
      return typeof value === 'string' && (def.values ?? []).includes(value);
    case 'list':
      return Array.isArray(value);
  }
}
