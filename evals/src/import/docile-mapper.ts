import type { DomainSchema, FieldDef } from '@lens/pipeline';

type DocileField = { fieldtype: string; text: string | null; line_item_id?: number | null };
type DocileAnnotation = {
  field_extractions?: DocileField[];
  line_item_extractions?: DocileField[];
};

/**
 * DocILE fieldtype → our invoice schema field. Kept HERE, not on the schema,
 * because this mapping is only needed at fixture-import time — the extraction
 * pipeline never consults it, and the schema doesn't care where fixtures came
 * from.
 */
const DOCILE_TO_INVOICE: Record<string, string> = {
  vendor_name: 'vendor_name',
  sender_address: 'vendor_address',
  document_id: 'invoice_number',
  date_issue: 'invoice_date',
  date_due: 'due_date',
  amount_total_net: 'subtotal',
  amount_total_tax: 'tax_amount',
  amount_total_gross: 'total',
};

const DOCILE_TO_INVOICE_LINE_ITEM: Record<string, string> = {
  line_item_description: 'description',
  line_item_quantity: 'quantity',
  line_item_unit_price_gross: 'unit_price',
  line_item_amount_gross: 'amount',
};

/**
 * Turn a DocILE annotation JSON into our expected.yaml shape.
 * Uses the mapping tables above; consults the schema only for field TYPES
 * (so we can coerce string DocILE values to numbers/dates).
 */
export function docileToExpected(
  annotation: DocileAnnotation,
  schema: DomainSchema,
): Record<string, unknown> {
  let lineItemsElement: Record<string, FieldDef> | null = null;
  const scalarDefs = new Map<string, FieldDef>();

  for (const [name, def] of Object.entries(schema.fields)) {
    if (def.type === 'list' && 'element' in def) {
      lineItemsElement = def.element as Record<string, FieldDef>;
    } else {
      scalarDefs.set(name, def);
    }
  }

  const out: Record<string, unknown> = {};

  for (const f of annotation.field_extractions ?? []) {
    const target = DOCILE_TO_INVOICE[f.fieldtype];
    if (!target || f.text == null) continue;
    const def = scalarDefs.get(target);
    if (!def) continue;
    out[target] = coerce(def.type, f.text);
  }

  if (lineItemsElement) {
    const byRow = new Map<number, Record<string, unknown>>();
    for (const f of annotation.line_item_extractions ?? []) {
      const ourKey = DOCILE_TO_INVOICE_LINE_ITEM[f.fieldtype];
      if (!ourKey || f.line_item_id == null || f.text == null) continue;
      const row = byRow.get(f.line_item_id) ?? {};
      const elemDef = lineItemsElement[ourKey];
      row[ourKey] = elemDef ? coerce(elemDef.type, f.text) : f.text;
      byRow.set(f.line_item_id, row);
    }
    if (byRow.size > 0) {
      out['line_items'] = Array.from(byRow.entries())
        .sort(([a], [b]) => a - b)
        .map(([, v]) => v);
    }
  }

  return out;
}

function coerce(type: string, text: string): unknown {
  const trimmed = text.trim();
  switch (type) {
    case 'number':
    case 'money': {
      const cleaned = trimmed.replace(/[^0-9.\-]/g, '');
      const n = Number.parseFloat(cleaned);
      return Number.isFinite(n) ? n : null;
    }
    case 'date':
      return normalizeDate(trimmed);
    default:
      return trimmed;
  }
}

function normalizeDate(s: string): string | null {
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (dmy) {
    let [, d, m, y] = dmy;
    if (y!.length === 2) y = (Number(y) > 50 ? '19' : '20') + y;
    return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }
  return null;
}
