import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { QueueItem } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

type Props = { items: QueueItem[] };

export function ReviewQueue({ items }: Props) {
  const navigate = useNavigate();
  const params = useParams<{ documentId?: string }>();
  const listRef = useRef<HTMLDivElement>(null);

  const activeIdx = items.findIndex((i) => i.documentId === params.documentId);
  const selectedIdx = activeIdx >= 0 ? activeIdx : 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (items.length === 0) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(items.length - 1, selectedIdx + 1);
        const doc = items[next];
        if (doc) navigate(`/review/${doc.documentId}`);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = Math.max(0, selectedIdx - 1);
        const doc = items[prev];
        if (doc) navigate(`/review/${doc.documentId}`);
      } else if (e.key === 'Enter' && activeIdx < 0 && items[0]) {
        navigate(`/review/${items[0].documentId}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, selectedIdx, activeIdx, navigate]);

  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Queue empty. Upload an invoice to start reviewing.
      </div>
    );
  }

  return (
    <div ref={listRef} className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
        Pending review · {items.length}
      </div>
      {items.map((item, idx) => (
        <button
          key={item.documentId}
          data-idx={idx}
          type="button"
          onClick={() => navigate(`/review/${item.documentId}`)}
          className={cn(
            'flex w-full flex-col items-start gap-1 border-b border-border px-3 py-2 text-left transition-colors',
            idx === activeIdx ? 'bg-primary/10' : 'hover:bg-muted/40',
          )}
        >
          <div className="flex w-full items-center gap-2">
            {item.hasError ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> : null}
            <span className="truncate text-sm font-medium">{item.vendorName ?? item.filename}</span>
          </div>
          <div className="flex w-full items-center justify-between text-xs text-muted-foreground">
            <span className="truncate">
              {item.total != null ? formatMoney(item.total, item.currency ?? 'USD') : '—'}
            </span>
            <span className="tabular-nums">
              {item.missingRequiredCount > 0
                ? `${item.missingRequiredCount} missing`
                : `${Math.round(item.overallConfidence * 100)}%`}
            </span>
          </div>
          <ConfidenceStrip
            value={item.overallConfidence}
            hasError={item.hasError}
            missingRequired={item.missingRequiredCount > 0}
          />
        </button>
      ))}
    </div>
  );
}

function ConfidenceStrip({
  value,
  hasError,
  missingRequired,
}: {
  value: number;
  hasError: boolean;
  missingRequired: boolean;
}) {
  // Full-width but red-tinted when required fields are missing — visually
  // distinct from "extractor is unsure" (partial-width strip).
  const width = missingRequired ? '100%' : `${Math.max(4, Math.round(value * 100))}%`;
  const color = hasError
    ? 'bg-destructive'
    : missingRequired
      ? 'bg-destructive/40'
      : value >= 0.9
        ? 'bg-primary'
        : value >= 0.7
          ? 'bg-amber-500'
          : 'bg-destructive/70';
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full', color)} style={{ width }} />
    </div>
  );
}

function formatMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}
