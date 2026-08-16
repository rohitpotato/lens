import Anthropic from '@anthropic-ai/sdk';
import {
  llmCostUsdTotal,
  llmRequestDurationSeconds,
  llmRequestsTotal,
  llmTokensTotal,
} from '@lens/metrics';
import { computeCostUsd } from './pricing.js';

export type LlmMessage = {
  role: 'user' | 'assistant';
  content: string | LlmContentPart[];
};

export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg'; data: string } };

export type LlmUsage = { inputTokens: number; outputTokens: number };

export type LlmResult = {
  text: string;
  usage: LlmUsage;
  costUsd: number;
  latencyMs: number;
  model: string;
  stopReason: string | null;
};

export type LlmClient = {
  chat(input: {
    model: string;
    system?: string;
    messages: LlmMessage[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<LlmResult>;
};

export function createAnthropicClient(opts: { apiKey: string }): LlmClient {
  const sdk = new Anthropic({ apiKey: opts.apiKey });

  return {
    async chat(input) {
      const start = Date.now();
      const timer = llmRequestDurationSeconds.startTimer({ model: input.model });
      try {
        const res = await sdk.messages.create({
          model: input.model,
          ...(input.system !== undefined ? { system: input.system } : {}),
          messages: input.messages as Anthropic.MessageParam[],
          max_tokens: input.maxTokens ?? 4096,
          temperature: input.temperature ?? 0,
        });
        const latencyMs = Date.now() - start;
        const text = res.content
          .filter((c): c is Anthropic.TextBlock => c.type === 'text')
          .map((c) => c.text)
          .join('');
        const usage: LlmUsage = {
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
        };
        const costUsd = computeCostUsd(input.model, usage.inputTokens, usage.outputTokens);

        llmRequestsTotal.inc({ model: input.model, outcome: 'success' });
        llmTokensTotal.inc({ model: input.model, direction: 'input' }, usage.inputTokens);
        llmTokensTotal.inc({ model: input.model, direction: 'output' }, usage.outputTokens);
        llmCostUsdTotal.inc({ model: input.model }, costUsd);
        timer();

        return {
          text,
          usage,
          costUsd,
          latencyMs,
          model: res.model,
          stopReason: res.stop_reason,
        };
      } catch (err) {
        timer();
        const outcome =
          err instanceof Anthropic.APIError && err.status === 429 ? 'rate_limited' : 'error';
        llmRequestsTotal.inc({ model: input.model, outcome });
        throw err;
      }
    },
  };
}

/**
 * Parse JSON from an LLM response. If it fails once, retry the whole call
 * with the parse error appended to the prompt. Returns null on second failure.
 */
export async function chatJson<T>(
  client: LlmClient,
  input: Parameters<LlmClient['chat']>[0],
  parse: (text: string) => T,
): Promise<{ result: LlmResult; value: T } | { result: LlmResult; value: null; error: string }> {
  const first = await client.chat(input);
  try {
    return { result: first, value: parse(stripFences(first.text)) };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const retry = await client.chat({
      ...input,
      messages: [
        ...input.messages,
        { role: 'assistant', content: first.text },
        {
          role: 'user',
          content: `The response above was not valid JSON. Parse error: ${errorMsg}\n\nReturn only the JSON object, no prose, no fences.`,
        },
      ],
    });
    try {
      return { result: retry, value: parse(stripFences(retry.text)) };
    } catch (err2) {
      return {
        result: retry,
        value: null,
        error: err2 instanceof Error ? err2.message : String(err2),
      };
    }
  }
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}
