import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch, documentsApi, reviewApi, rulesApi, vendorsApi } from '@/lib/api';
import { ActivityFeed } from '@/components/activity-feed';
import { Uploader } from '@/components/uploader';

type Health = { status: string; ts: string };

export function DashboardPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<Health>('/health'),
    refetchInterval: 10_000,
  });
  const queue = useQuery({
    queryKey: ['queue'],
    queryFn: () => reviewApi.queue().then((r) => r.queue),
    refetchInterval: 15_000,
  });
  // Same query key + fetch as the /rules page — React Query dedupes the
  // request. `select` transforms just for this consumer without changing the
  // cached data shape (which is the raw array).
  const suggested = useQuery({
    queryKey: ['rules', 'suggested'],
    queryFn: () => rulesApi.list('suggested').then((r) => r.rules),
    select: (rules) => rules.length,
    refetchInterval: 30_000,
  });
  const vendors = useQuery({
    queryKey: ['vendors'],
    queryFn: () => vendorsApi.list().then((r) => r.vendors),
    refetchInterval: 30_000,
  });
  const recent = useQuery({
    queryKey: ['documents', 'recent'],
    queryFn: () => documentsApi.list({ limit: 10 }).then((r) => r.documents),
    refetchInterval: 5_000,
  });

  const backlog = queue.data?.length ?? 0;
  const vendorCount = vendors.data?.length ?? 0;
  // Touchless = auto_approved / total. Manual review approvals aren't touchless.
  const overallTouchless =
    !vendors.data || vendors.data.length === 0
      ? 0
      : vendors.data.reduce((a, v) => a + v.autoApproved, 0) /
        Math.max(1, vendors.data.reduce((a, v) => a + v.total, 0));

  return (
    <main className="mx-auto flex h-full max-w-5xl flex-col gap-6 px-6 py-12">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Lens</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Turn messy invoices into structured, queryable data.
          </p>
        </div>
        <span
          className={
            'h-2.5 w-2.5 rounded-full ' +
            (health.isError ? 'bg-destructive' : health.data ? 'bg-primary' : 'bg-muted')
          }
          aria-label={health.isError ? 'API down' : 'API ok'}
        />
      </header>

      <section className="rounded-lg border border-border bg-card p-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Touchless processing</p>
        <p className="mt-1 text-5xl font-semibold tabular-nums">
          {vendors.isPending ? '…' : `${Math.round(overallTouchless * 100)}%`}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Auto-approved / total, across all vendors
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          to="/review"
          className="group rounded-lg border border-border bg-card p-6 transition-colors hover:border-primary/40"
        >
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Review queue</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{queue.isPending ? '…' : backlog}</p>
          <p className="mt-2 text-xs text-muted-foreground group-hover:text-primary">Open workspace →</p>
        </Link>
        <Link
          to="/rules"
          className="group rounded-lg border border-border bg-card p-6 transition-colors hover:border-primary/40"
        >
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Suggested rules</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{suggested.isPending ? '…' : (suggested.data ?? 0)}</p>
          <p className="mt-2 text-xs text-muted-foreground group-hover:text-primary">Review suggestions →</p>
        </Link>
        <Link
          to="/vendors"
          className="group rounded-lg border border-border bg-card p-6 transition-colors hover:border-primary/40"
        >
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Vendors</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{vendors.isPending ? '…' : vendorCount}</p>
          <p className="mt-2 text-xs text-muted-foreground group-hover:text-primary">See improvement arc →</p>
        </Link>
        <Link
          to="/query"
          className="group rounded-lg border border-border bg-card p-6 transition-colors hover:border-primary/40"
        >
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Query</p>
          <p className="mt-2 text-3xl font-semibold">SQL</p>
          <p className="mt-2 text-xs text-muted-foreground group-hover:text-primary">Insights + console →</p>
        </Link>
      </section>

      <Uploader />

      <section className="rounded-lg border border-border bg-card p-6">
        <div className="mb-3 flex items-baseline justify-between">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Recent activity</p>
          <Link to="/documents" className="text-xs text-muted-foreground hover:text-foreground">
            See all →
          </Link>
        </div>
        {recent.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ActivityFeed items={recent.data ?? []} />
        )}
      </section>
    </main>
  );
}
