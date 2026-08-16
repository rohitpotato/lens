import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import type { ExtractionDetail, DomainSchemaClient, FieldDef, ValidationResult } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ReconciliationCard } from './reconciliation';

type Props = {
  schema: DomainSchemaClient;
  extraction: ExtractionDetail;
  onEdit: (fieldPath: string, newValue: unknown) => Promise<void> | void;
  saving: boolean;
};

export function FieldsPanel({ schema, extraction, onEdit, saving }: Props) {
  // If overall is 0 because required fields are null, that's a MISSING-DATA signal
  // — not "extraction failed." Compute what's actually missing so we can say so.
  const missingRequired: string[] = [];
  for (const [name, def] of Object.entries(schema.fields)) {
    if (!def.required) continue;
    const v = extraction.extractedJson[name];
    if (v == null || v === '') missingRequired.push(name);
  }
  // The average of only the fields that ARE present — a truer "how well did we do
  // on what we found" number when required fields are missing.
  const presentScores = Object.entries(extraction.perFieldConfidence)
    .filter(([name]) => !missingRequired.includes(name))
    .map(([, c]) => c.score);
  const presentAvg =
    presentScores.length > 0
      ? presentScores.reduce((a, s) => a + s, 0) / presentScores.length
      : 0;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <span>Extracted fields</span>
          {missingRequired.length > 0 ? (
            <MissingRequiredBadge count={missingRequired.length} avg={presentAvg} />
          ) : (
            <ConfidenceBadge score={extraction.overallConfidence} />
          )}
        </div>
        {saving ? <span className="text-xs text-muted-foreground">saving…</span> : null}
      </div>
      <div className="flex-1 divide-y divide-border">
        {Object.entries(schema.fields).map(([name, def]) => {
          if (def.type === 'list' && 'element' in def) {
            const rows = Array.isArray(extraction.extractedJson[name])
              ? (extraction.extractedJson[name] as Record<string, unknown>[])
              : [];
            return (
              <LineItemsRow
                key={name}
                name={name}
                element={def.element}
                rows={rows}
                score={extraction.perFieldConfidence[name]?.score}
              />
            );
          }
          const scalar = def as Exclude<FieldDef, { type: 'list' }>;
          const value = extraction.extractedJson[name];
          const failingRule = extraction.validationResults.find(
            (v) => !v.passed && v.suggestsField === name,
          );
          return (
            <FieldRow
              key={name}
              name={name}
              def={scalar}
              value={value}
              confidence={extraction.perFieldConfidence[name]?.score}
              failingRule={failingRule}
              onEdit={onEdit}
            />
          );
        })}
      </div>
    </div>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const variant = score >= 0.9 ? 'default' : score >= 0.7 ? 'secondary' : 'destructive';
  return <Badge variant={variant}>{pct}%</Badge>;
}

function MissingRequiredBadge({ count, avg }: { count: number; avg: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <Badge variant="destructive">
        {count} required missing
      </Badge>
      <span className="text-[10px] tabular-nums text-muted-foreground">
        {Math.round(avg * 100)}% on the rest
      </span>
    </div>
  );
}

type FieldRowProps = {
  name: string;
  def: Exclude<FieldDef, { type: 'list' }>;
  value: unknown;
  confidence: number | undefined;
  failingRule: ValidationResult | undefined;
  onEdit: (fieldPath: string, newValue: unknown) => Promise<void> | void;
};

function FieldRow({ name, def, value, confidence, failingRule, onEdit }: FieldRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(displayString(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(displayString(value));
  }, [value]);

  const enterEdit = useCallback(() => {
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  const commit = useCallback(() => {
    setEditing(false);
    const coerced = coerce(def.type, draft);
    if (!shallowEqual(coerced, value)) {
      void onEdit(name, coerced);
    }
  }, [def.type, draft, name, onEdit, value]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(displayString(value));
  }, [value]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  const bare = !failingRule;

  return (
    <div
      className={cn(
        'px-4 py-3 transition-colors',
        failingRule ? 'bg-amber-500/5' : 'hover:bg-muted/40',
      )}
      data-field={name}
    >
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {humanize(name)}
          {def.required ? <span className="ml-0.5 text-destructive">*</span> : null}
        </label>
        {bare && confidence != null ? (
          <span className={cn('text-[10px] tabular-nums', confidence >= 0.9 ? 'text-muted-foreground' : 'text-amber-600')}>
            {Math.round(confidence * 100)}%
          </span>
        ) : null}
      </div>
      <div className="mt-1">
        {editing ? (
          <Input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            className="h-8 font-mono text-sm"
          />
        ) : (
          <button
            type="button"
            onClick={enterEdit}
            onKeyDown={(e) => {
              if (e.key === 'e' || e.key === 'Enter') {
                e.preventDefault();
                enterEdit();
              }
            }}
            className="w-full rounded px-1 py-1 text-left font-mono text-sm tabular-nums hover:bg-muted focus:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {value == null || value === '' ? (
              <span className="italic text-muted-foreground">(empty)</span>
            ) : (
              displayString(value)
            )}
          </button>
        )}
      </div>
      {failingRule && (
        <ReconciliationCard
          rule={failingRule}
          onAccept={(v) => onEdit(name, v)}
          formatValue={(v) => displayString(v)}
        />
      )}
    </div>
  );
}

function LineItemsRow({
  name,
  element,
  rows,
  score,
}: {
  name: string;
  element: Record<string, FieldDef>;
  rows: Record<string, unknown>[];
  score: number | undefined;
}) {
  const cols = Object.entries(element);
  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {humanize(name)} · {rows.length}
        </label>
        {score != null ? (
          <span className="text-[10px] tabular-nums text-muted-foreground">{Math.round(score * 100)}%</span>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <div className="text-sm italic text-muted-foreground">(no line items)</div>
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {cols.map(([k]) => (
                  <th key={k} className="px-2 py-1 text-left font-medium">
                    {humanize(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {cols.map(([k]) => (
                    <td key={k} className="px-2 py-1 font-mono">
                      {displayString(row[k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function displayString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number') return v.toString();
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function coerce(type: string, raw: string): unknown {
  const s = raw.trim();
  if (s === '') return null;
  switch (type) {
    case 'number':
    case 'money': {
      const n = Number(s.replace(/[,\s]/g, ''));
      return Number.isFinite(n) ? n : s;
    }
    case 'date':
      return s;
    default:
      return s;
  }
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return false;
}

function humanize(s: string): string {
  return s.replaceAll('_', ' ');
}
