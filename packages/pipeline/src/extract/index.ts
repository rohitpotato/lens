import { chatJson, type LlmClient } from '@lens/llm';
import type { DomainSchema } from '../schema/types.js';

export type ExtractResult = {
  json: Record<string, unknown> | null;
  parseError?: string;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  latencyMs: number;
  model: string;
};

export async function extractInvoice(input: {
  llm: LlmClient;
  model: string;
  promptTemplate: string;
  schema: DomainSchema;
  hints: string[];
  pdf: Buffer;
}): Promise<ExtractResult> {
  const schemaJson = JSON.stringify(compileForPrompt(input.schema), null, 2);
  const hintsBlock = input.hints.length
    ? input.hints.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : '(none)';
  const rendered = input.promptTemplate
    .replace('{schema_json}', schemaJson)
    .replace('{prompt_hints}', hintsBlock);

  const expectedKeys = Object.keys(input.schema.fields);

  const { result, value, ...rest } = await chatJson(
    input.llm,
    {
      model: input.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: input.pdf.toString('base64'),
              },
            },
            { type: 'text', text: rendered },
          ],
        },
      ],
      maxTokens: 4096,
    },
    (raw) => {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return unwrapExtractionShape(parsed, expectedKeys);
    },
  );

  const output: ExtractResult = {
    json: value,
    usage: result.usage,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    model: result.model,
  };
  if ('error' in rest && typeof rest.error === 'string') {
    output.parseError = rest.error;
  }
  return output;
}

/**
 * Defensive unwrap: if the LLM returned `{name, description, fields: {...}}`
 * (mirroring our schema wrapper) or any shape where the actual fields are one
 * level deep, promote them to top level. Belt-and-braces for prompt drift.
 */
function unwrapExtractionShape(
  parsed: Record<string, unknown>,
  expectedKeys: string[],
): Record<string, unknown> {
  const topKeys = new Set(Object.keys(parsed));
  const topOverlap = expectedKeys.filter((k) => topKeys.has(k)).length;

  // Look for a candidate nested object whose keys overlap the schema better than the top level.
  for (const [k, v] of Object.entries(parsed)) {
    if (v == null || typeof v !== 'object' || Array.isArray(v)) continue;
    const nested = v as Record<string, unknown>;
    const nestedKeys = new Set(Object.keys(nested));
    const nestedOverlap = expectedKeys.filter((ek) => nestedKeys.has(ek)).length;
    if (nestedOverlap > topOverlap && nestedOverlap >= Math.min(3, expectedKeys.length)) {
      // Merge: nested wins for schema keys; keep top-level non-schema keys we don't care about.
      // eslint-disable-next-line no-console
      console.warn(`[extract] unwrapped nested key "${k}" — LLM wrapped output`);
      return nested;
    }
  }
  return parsed;
}

/**
 * Reduce the domain schema to the compact shape the model sees.
 * Returns a flat map of {fieldName: def} — NOT wrapped in {name, fields:{...}}.
 * Wrapping caused Sonnet to mirror the shape and nest the extraction under
 * `fields`, silently zeroing every top-level field read on our side.
 * Drops docile mappings, normalize hints, and other metadata that don't help
 * the extractor.
 */
function compileForPrompt(schema: DomainSchema): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(schema.fields)) {
    if (def.type === 'list' && 'element' in def) {
      const element: Record<string, unknown> = {};
      for (const [ename, edef] of Object.entries(def.element)) {
        element[ename] = pickPromptRelevant(edef as Record<string, unknown>);
      }
      fields[name] = { type: 'list', required: def.required ?? false, element };
    } else {
      fields[name] = pickPromptRelevant(def as Record<string, unknown>);
    }
  }
  return fields;
}

function pickPromptRelevant(def: Record<string, unknown>): Record<string, unknown> {
  const keep: Record<string, unknown> = {};
  for (const k of ['type', 'required', 'description', 'pattern', 'format', 'values', 'default']) {
    if (def[k] !== undefined) keep[k] = def[k];
  }
  return keep;
}
