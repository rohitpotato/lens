import type { DomainSchema, ValidationRule } from '../schema/types.js';

export type ValidationResult = {
  name: string;
  severity: 'error' | 'warning';
  passed: boolean;
  message?: string;
  /** Field the failure is attributed to (from suggests.field, if present). */
  suggestsField?: string;
  /** Pre-computed value that would satisfy this rule (for the reconciliation UX). */
  suggestsValue?: unknown;
};

/**
 * Evaluate all rules against extracted data. Rules and suggests.value
 * expressions come from schema.yaml, which is a trusted in-git artifact —
 * evaluation runs via `new Function` with a sandboxed helper scope.
 *
 * Supported expression sugar:
 *   field[*].subfield   →  numeric array plucked from `field`
 *   abs(x)              →  Math.abs
 *   sum(xs)             →  xs.reduce((a,b) => a + (b||0), 0)
 *   ||, ??, <, >, ===, arithmetic  →  plain JS
 *
 * The optional `schema` arg lets us pre-fill missing keys with null so a rule
 * that references a schema-declared field never throws ReferenceError just
 * because the extractor omitted the key.
 */
export function evaluateRules(
  rules: readonly ValidationRule[],
  data: Record<string, unknown>,
  schema?: DomainSchema,
): ValidationResult[] {
  const scope = withSchemaNulls(data, schema);
  const results: ValidationResult[] = [];
  for (const rule of rules) {
    // applies_if: any throw or falsy return means the rule is skipped as pass.
    if (rule.applies_if) {
      let applies: boolean;
      try {
        applies = Boolean(safeEval<unknown>(rule.applies_if, scope));
      } catch {
        applies = false;
      }
      if (!applies) {
        results.push({ name: rule.name, severity: rule.severity, passed: true });
        continue;
      }
    }
    let passed: boolean;
    try {
      passed = Boolean(safeEval<unknown>(rule.rule, scope));
    } catch {
      passed = false;
    }
    const result: ValidationResult = {
      name: rule.name,
      severity: rule.severity,
      passed,
    };
    if (rule.message !== undefined) result.message = rule.message;
    if (!passed && rule.suggests) {
      let suggestValue: unknown = null;
      try {
        suggestValue = safeEval<unknown>(rule.suggests.value, scope);
      } catch {
        suggestValue = null;
      }
      result.suggestsField = rule.suggests.field;
      result.suggestsValue = suggestValue;
    }
    results.push(result);
  }
  return results;
}

/** Pre-fill every schema-declared field with null when the extractor omitted it. */
function withSchemaNulls(
  data: Record<string, unknown>,
  schema?: DomainSchema,
): Record<string, unknown> {
  if (!schema) return data;
  const scope: Record<string, unknown> = {};
  for (const key of Object.keys(schema.fields)) {
    scope[key] = key in data ? data[key] : null;
  }
  for (const [k, v] of Object.entries(data)) {
    if (!(k in scope)) scope[k] = v;
  }
  return scope;
}

function rewrite(expr: string): string {
  // field[*].subfield → __pluck(field, 'subfield')
  return expr.replace(
    /([a-zA-Z_][a-zA-Z0-9_]*)\[\*\]\.([a-zA-Z_][a-zA-Z0-9_]*)/g,
    "__pluck($1, '$2')",
  );
}

const helpers = {
  __pluck(list: unknown, key: string): unknown[] {
    if (!Array.isArray(list)) return [];
    return list.map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined));
  },
  sum(xs: unknown): number {
    if (!Array.isArray(xs)) return 0;
    return xs.reduce<number>((acc, v) => acc + (typeof v === 'number' ? v : 0), 0);
  },
  abs(x: unknown): number {
    return typeof x === 'number' ? Math.abs(x) : NaN;
  },
};

function safeEval<T>(expr: string, data: Record<string, unknown>): T {
  const rewritten = rewrite(expr);
  const dataKeys = Object.keys(data);
  const helperKeys = Object.keys(helpers) as (keyof typeof helpers)[];
  const fn = new Function(
    ...dataKeys,
    ...helperKeys,
    `"use strict"; return (${rewritten});`,
  );
  const args = [
    ...dataKeys.map((k) => data[k]),
    ...helperKeys.map((k) => helpers[k]),
  ];
  return fn(...args) as T;
}
