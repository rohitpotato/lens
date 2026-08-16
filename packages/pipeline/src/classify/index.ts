import { chatJson, type LlmClient } from '@lens/llm';

// pdf-parse has a CJS default export; import lazily to avoid loading its test PDF on module init.
async function extractText(pdf: Buffer): Promise<string> {
  const mod = (await import('pdf-parse')) as { default: (b: Buffer) => Promise<{ text: string }> };
  const res = await mod.default(pdf);
  return res.text ?? '';
}

/** Minimum text length before we trust text-based classification over vision. */
const TEXT_CLASSIFY_MIN_CHARS = 100;

export type ClassifyResult = {
  type: 'invoice' | 'receipt' | 'unknown';
  confidence: number;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  latencyMs: number;
  model: string;
  /** How the doc was seen: extracted text vs. rendered PDF pixels. */
  mode: 'text' | 'vision';
};

export async function classifyDocument(input: {
  llm: LlmClient;
  model: string;
  promptTemplate: string;
  pdf: Buffer;
  /** Character cap on document text handed to the classifier. */
  textLimit?: number;
}): Promise<ClassifyResult> {
  const rawText = await extractText(input.pdf).catch(() => '');
  const text = rawText.slice(0, input.textLimit ?? 6000).trim();

  const useVision = text.length < TEXT_CLASSIFY_MIN_CHARS;
  const mode: 'text' | 'vision' = useVision ? 'vision' : 'text';

  // Vision path: image-only PDFs (from an image upload converted at ingest, or a scanned invoice)
  // have no text layer. Send the PDF pixels to the classifier instead.
  const content = useVision
    ? ([
        {
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data: input.pdf.toString('base64'),
          },
        },
        { type: 'text' as const, text: input.promptTemplate.replace('{document_text}', '(document is an image — classify from what you see)') },
      ])
    : input.promptTemplate.replace('{document_text}', text);

  const { result, value } = await chatJson(
    input.llm,
    { model: input.model, messages: [{ role: 'user', content }] },
    (raw) => {
      const parsed = JSON.parse(raw) as { type?: string; confidence?: number };
      const type =
        parsed.type === 'invoice' || parsed.type === 'receipt' ? parsed.type : 'unknown';
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
      return { type, confidence } as { type: 'invoice' | 'receipt' | 'unknown'; confidence: number };
    },
  );

  const fallback = value ?? { type: 'unknown' as const, confidence: 0 };
  return {
    type: fallback.type,
    confidence: fallback.confidence,
    usage: result.usage,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    model: result.model,
    mode,
  };
}
