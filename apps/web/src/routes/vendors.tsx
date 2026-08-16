import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { vendorsApi } from '@/lib/api';
import { cn } from '@/lib/utils';

export function VendorsIndexPage() {
  const vendors = useQuery({
    queryKey: ['vendors'],
    queryFn: () => vendorsApi.list().then((r) => r.vendors),
    refetchInterval: 30_000,
  });

  return (
    <main className="mx-auto flex h-full max-w-4xl flex-col gap-6 px-6 py-10">
      <header>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Lens
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Vendors</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every vendor we've seen an invoice from, ranked by volume. Click through to see how touchless processing has improved as rules are adopted.
        </p>
      </header>

      {vendors.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (vendors.data ?? []).length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          No vendors yet. Upload an invoice to get started.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Vendor</th>
                <th className="px-4 py-2 text-right font-medium">Processed</th>
                <th className="px-4 py-2 text-right font-medium">Touchless</th>
                <th className="px-4 py-2 text-right font-medium">Pending</th>
                <th className="px-4 py-2 text-right font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {(vendors.data ?? []).map((v) => (
                <tr key={v.vendor} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-2">
                    <Link to={`/vendors/${encodeURIComponent(v.vendor)}`} className="font-medium hover:text-primary">
                      {v.vendor}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{v.total}</td>
                  <td className={cn('px-4 py-2 text-right tabular-nums', v.touchlessRate >= 0.8 ? 'text-primary' : 'text-muted-foreground')}>
                    {Math.round(v.touchlessRate * 100)}%
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{v.pending}</td>
                  <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                    {new Date(v.lastSeen).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
