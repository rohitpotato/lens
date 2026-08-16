import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { vendorsApi } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function VendorDetailPage() {
  const params = useParams<{ vendor: string }>();
  const vendor = params.vendor ? decodeURIComponent(params.vendor) : '';

  const detail = useQuery({
    queryKey: ['vendor', vendor],
    queryFn: () => vendorsApi.detail(vendor),
    enabled: !!vendor,
  });

  const d = detail.data;

  const weekly = d?.weekly ?? [];
  // Touchless counts extraction.status='auto_approved' only. Human-approved
  // docs are NOT touchless — they had a reviewer's attention.
  const overallTouchless =
    weekly.length === 0
      ? 0
      : weekly.reduce((a, w) => a + w.autoApproved, 0) / Math.max(1, weekly.reduce((a, w) => a + w.total, 0));

  const maxTotal = Math.max(1, ...weekly.map((w) => w.total));

  return (
    <main className="mx-auto flex h-full max-w-4xl flex-col gap-6 px-6 py-10">
      <header>
        <Link to="/vendors" className="text-sm text-muted-foreground hover:text-foreground">
          ← Vendors
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight capitalize">{vendor}</h1>
        {d && (
          <p className="mt-1 text-sm text-muted-foreground">
            {weekly.reduce((a, w) => a + w.total, 0)} invoice{weekly.length === 1 ? '' : 's'} processed ·{' '}
            {d.adoptedHints.length} adopted rule{d.adoptedHints.length === 1 ? '' : 's'}
          </p>
        )}
      </header>

      {detail.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !d ? (
        <p className="text-sm text-destructive">Vendor not found.</p>
      ) : (
        <>
          <section className="rounded-lg border border-border bg-card p-6">
            <div className="flex items-baseline justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Touchless processing</p>
                <p className="mt-1 text-4xl font-semibold tabular-nums">
                  {Math.round(overallTouchless * 100)}%
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Auto-approved / total, all time</p>
              </div>
            </div>
            {weekly.length === 0 ? (
              <p className="mt-4 text-sm italic text-muted-foreground">Not enough history yet.</p>
            ) : (
              <div className="mt-6 flex items-end gap-2" style={{ minHeight: '120px' }}>
                {weekly.map((w) => {
                  const heightPct = Math.max(6, (w.total / maxTotal) * 100);
                  const rate = w.touchlessRate;
                  const color = rate >= 0.9 ? 'bg-primary' : rate >= 0.7 ? 'bg-amber-500' : 'bg-destructive/70';
                  return (
                    <div key={w.weekStart} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {Math.round(rate * 100)}%
                      </span>
                      <div
                        className={cn('w-full rounded-t transition-all', color)}
                        style={{ height: `${heightPct}px` }}
                        title={`${w.total} processed, ${w.autoApproved} touchless`}
                      />
                      <span className="text-[10px] text-muted-foreground">
                        {formatWeek(w.weekStart)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Corrections that stuck</p>
            {d.hotspots.length === 0 ? (
              <p className="mt-3 text-sm italic text-muted-foreground">
                No corrections yet for this vendor.
              </p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="pb-2 text-left font-medium">Field</th>
                    <th className="pb-2 text-right font-medium">Before adopt</th>
                    <th className="pb-2 text-center font-medium">→</th>
                    <th className="pb-2 text-right font-medium">After adopt</th>
                    <th className="pb-2 pl-4 text-left font-medium">Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {d.hotspots.map((h) => (
                    <tr key={h.fieldPath} className="border-t border-border">
                      <td className="py-2 font-mono text-xs">{h.fieldPath}</td>
                      <td className="py-2 text-right tabular-nums">{h.beforeAdopt}</td>
                      <td className="py-2 text-center text-muted-foreground">→</td>
                      <td className={cn('py-2 text-right tabular-nums', h.afterAdopt < h.beforeAdopt ? 'text-primary' : '')}>
                        {h.afterAdopt}
                      </td>
                      <td className="py-2 pl-4">
                        {h.adoptedAt ? (
                          <Badge variant="default" className="text-[10px]">adopted</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">no rule</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {d.adoptedHints.length > 0 && (
            <section className="rounded-lg border border-border bg-card p-6">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Active rules</p>
              <ul className="mt-3 space-y-2">
                {d.adoptedHints.map((h) => (
                  <li key={h.id} className="rounded border border-border bg-background p-3 text-sm">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <code className="rounded bg-muted px-1 py-0.5">{h.fieldPath}</code>
                      <span>·</span>
                      <span>adopted {new Date(h.adoptedAt).toLocaleDateString()}</span>
                    </div>
                    <p className="mt-1.5">{h.hint}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-lg border border-border bg-card p-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Recent invoices</p>
            {d.recentDocuments.length === 0 ? (
              <p className="mt-3 text-sm italic text-muted-foreground">None yet.</p>
            ) : (
              <ul className="mt-3 space-y-1">
                {d.recentDocuments.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between text-sm">
                    <Link to={`/review/${doc.id}`} className="font-mono text-xs hover:text-primary">
                      {doc.filename}
                    </Link>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="tabular-nums">{Math.round(doc.confidence * 100)}%</span>
                      <Badge variant={doc.status === 'approved' ? 'default' : 'outline'} className="text-[10px]">
                        {doc.status.replace('_', ' ')}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function formatWeek(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
