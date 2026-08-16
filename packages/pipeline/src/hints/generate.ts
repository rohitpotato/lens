import { chatJson, type LlmClient } from '@lens/llm';

export type CorrectionSample = {
  oldValue: unknown;
  newValue: unknown;
  note?: string | null;
  correctedAt: string;
};

export type GeneratedHint = {
  hint: string;
  note: string | null;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  model: string;
};

export async function generateHint(input: {
  llm: LlmClient;
  model: string;
  promptTemplate: string;
  vendor: string;
  field: string;
  corrections: CorrectionSample[];
}): Promise<GeneratedHint | null> {
  const correctionsBlock = input.corrections
    .map((c, i) => `${i + 1}. old=${format(c.oldValue)} → new=${format(c.newValue)}${c.note ? ` (note: ${c.note})` : ''}`)
    .join('\n');
  const rendered = input.promptTemplate
    .replaceAll('{vendor}', input.vendor)
    .replaceAll('{field}', input.field)
    .replaceAll('{corrections}', correctionsBlock);

  const { result, value } = await chatJson(
    input.llm,
    { model: input.model, messages: [{ role: 'user', content: rendered }] },
    (raw) => {
      const parsed = JSON.parse(raw) as { hint?: unknown; note?: unknown };
      const hint = typeof parsed.hint === 'string' ? parsed.hint.trim() : '';
      const note = typeof parsed.note === 'string' ? parsed.note.trim() : '';
      return { hint, note };
    },
  );
  if (!value || value.hint === '') return null;
  return {
    hint: value.hint,
    note: value.note || null,
    usage: result.usage,
    costUsd: result.costUsd,
    model: result.model,
  };
}

function format(v: unknown): string {
  if (v == null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}
