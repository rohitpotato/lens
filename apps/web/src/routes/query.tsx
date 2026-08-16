import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import Editor from '@monaco-editor/react';
import { queryApi, type QueryResult } from '@/lib/api';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'insights', label: 'Insights' },
  { key: 'sql', label: 'SQL console' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const STARTER_SQL = `-- read-only. Try:
--   SELECT status, COUNT(*) FROM documents GROUP BY status;
--   SELECT * FROM extractions ORDER BY extracted_at DESC LIMIT 5;
SELECT status, COUNT(*) AS n
FROM documents
GROUP BY status
ORDER BY n DESC;
`;

const SCHEMA_HINTS = [
  { table: 'documents', cols: ['id', 'filename', 'status', 'detected_type', 'uploaded_at'] },
  { table: 'extractions', cols: ['id', 'document_id', 'extracted_json', 'overall_confidence', 'status', 'model_used', 'cost_usd', 'latency_ms', 'extracted_at'] },
  { table: 'corrections', cols: ['id', 'extraction_id', 'field_path', 'old_value', 'new_value', 'corrected_at'] },
  { table: 'prompt_hints', cols: ['id', 'matching_key', 'field_path', 'hint', 'status', 'evidence_count', 'created_at'] },
  { table: 'events', cols: ['id', 'event_type', 'aggregate_id', 'payload', 'created_at'] },
];

export function QueryPage() {
  const [tab, setTab] = useState<TabKey>('insights');
  const [editorValue, setEditorValue] = useState(STARTER_SQL);

  const insights = useQuery({
    queryKey: ['insights'],
    queryFn: () => queryApi.insights().then((r) => r.insights),
  });

  return (
    <main className="mx-auto flex h-full max-w-5xl flex-col gap-6 px-6 py-10">
      <header>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Lens
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Query</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Structured extractions live in Postgres. Insights are pre-baked SQL. The console runs your own SELECTs, read-only.
        </p>
      </header>

      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'insights' ? (
        <section className="grid gap-3">
          {insights.isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            (insights.data ?? []).map((i) => <InsightCard key={i.slug} slug={i.slug} title={i.title} description={i.description} />)
          )}
        </section>
      ) : (
        <SqlConsole value={editorValue} onChange={setEditorValue} />
      )}
    </main>
  );
}

function InsightCard({ slug, title, description }: { slug: string; title: string; description: string }) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: async () => {
      const detail = await queryApi.insight(slug);
      return queryApi.run(detail.sql);
    },
    onSuccess: (r) => {
      setResult(r);
      setError(null);
    },
    onError: (e) => {
      setError(e instanceof ApiError ? String((e.body as { error?: string })?.error ?? e.message) : String(e));
      setResult(null);
    },
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? 'Running…' : result ? 'Re-run' : 'Run'}
        </Button>
      </div>
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      {result && <ResultTable result={result} />}
    </div>
  );
}

function SqlConsole({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => queryApi.run(value),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
    },
    onError: (e) => {
      setError(e instanceof ApiError ? String((e.body as { error?: string })?.error ?? e.message) : String(e));
      setResult(null);
    },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
      <div className="flex flex-col gap-3">
        <div className="overflow-hidden rounded border border-border" style={{ height: '260px' }}>
          <Editor
            language="sql"
            theme="vs"
            value={value}
            onChange={(v) => onChange(v ?? '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">read-only · 5s timeout · 500 row cap</Badge>
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">⌘ ↵</kbd> run
          </span>
          <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? 'Running…' : 'Run'}
          </Button>
        </div>
        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        )}
        {result && <ResultTable result={result} />}
      </div>
      <aside className="text-xs">
        <p className="mb-2 uppercase tracking-wide text-muted-foreground">Schema</p>
        <ul className="space-y-2">
          {SCHEMA_HINTS.map((s) => (
            <li key={s.table}>
              <p className="font-mono text-[11px] font-semibold">{s.table}</p>
              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                {s.cols.join(', ')}
              </p>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function ResultTable({ result }: { result: QueryResult }) {
  const cols = useMemo(() => result.columns, [result]);
  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {result.rows.length} row{result.rows.length === 1 ? '' : 's'}
        {result.truncated && <span className="ml-2 text-amber-600">(truncated to {result.rows.length} of {result.totalRows})</span>}
      </p>
      {result.rows.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">No rows.</p>
      ) : (
        <div className="max-h-[400px] overflow-auto rounded border border-border">
          <table className="w-full text-xs tabular-nums">
            <thead className="sticky top-0 bg-muted/60 text-left uppercase tracking-wide text-muted-foreground">
              <tr>
                {cols.map((c) => (
                  <th key={c} className="px-2 py-1 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {cols.map((c) => (
                    <td key={c} className="px-2 py-1 font-mono">
                      {formatCell(row[c])}
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

function formatCell(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}
