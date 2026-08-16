import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { documentsApi } from '@/lib/api';
import { ActivityFeed } from '@/components/activity-feed';

export function DocumentsPage() {
  const docs = useQuery({
    queryKey: ['documents', 'all'],
    queryFn: () => documentsApi.list({ limit: 100 }).then((r) => r.documents),
    refetchInterval: 5_000,
  });

  return (
    <main className="mx-auto flex h-full max-w-4xl flex-col gap-6 px-6 py-10">
      <header>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Lens
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">All documents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything you've uploaded, across every status. Auto-approved docs show up here so
          you can always find where a curl'd upload ended up.
        </p>
      </header>

      <section className="rounded-lg border border-border bg-card p-6">
        {docs.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ActivityFeed items={docs.data ?? []} />
        )}
      </section>
    </main>
  );
}
