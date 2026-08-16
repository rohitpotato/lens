import { Link } from 'react-router-dom';
import type { DocumentListItem } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; hint?: string }> = {
  uploaded: { label: 'queued', variant: 'outline' },
  classifying: { label: 'classifying', variant: 'outline' },
  extracting: { label: 'extracting', variant: 'outline' },
  needs_manual_classification: { label: 'needs type', variant: 'secondary' },
  pending_review: { label: 'pending review', variant: 'secondary' },
  approved: { label: 'approved', variant: 'default' },
  rejected: { label: 'rejected', variant: 'destructive' },
  failed: { label: 'failed', variant: 'destructive' },
};

function statusBadge(status: string) {
  const meta = STATUS_META[status] ?? { label: status.replace(/_/g, ' '), variant: 'outline' as const };
  return (
    <Badge variant={meta.variant} className="text-[10px]">
      {meta.label}
    </Badge>
  );
}

function destination(doc: DocumentListItem): string {
  if (doc.status === 'pending_review' || doc.status === 'needs_manual_classification') {
    return `/review/${doc.id}`;
  }
  if (doc.extraction) return `/review/${doc.id}`;
  return `/review/${doc.id}`;
}

export function ActivityFeed({ items, compact = false }: { items: DocumentListItem[]; compact?: boolean }) {
  if (items.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        No uploads yet. Try{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">
          curl -F file=@invoice.pdf http://localhost:3001/documents
        </code>
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {items.map((doc) => (
        <li key={doc.id} className={cn('flex items-center justify-between gap-3', compact ? 'py-2' : 'py-3')}>
          <div className="min-w-0 flex-1">
            <Link to={destination(doc)} className="block truncate text-sm font-medium hover:text-primary">
              {doc.extraction?.vendorName ?? doc.filename}
            </Link>
            <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate font-mono">{doc.filename}</span>
              {doc.extraction?.total != null && (
                <span className="whitespace-nowrap tabular-nums">
                  {formatMoney(doc.extraction.total, doc.extraction.currency ?? 'USD')}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            {doc.extraction && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {Math.round(doc.extraction.overallConfidence * 100)}%
              </span>
            )}
            {statusBadge(doc.status)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}
