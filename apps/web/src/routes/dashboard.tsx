import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

type Health = { status: string; ts: string };

export function DashboardPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<Health>('/health'),
    refetchInterval: 10_000,
  });

  return (
    <main className="mx-auto flex h-full max-w-5xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Lens</h1>
        <p className="text-sm text-muted-foreground">
          Turn messy invoices into structured, queryable data.
        </p>
      </header>

      <section className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">API status</p>
            <p className="mt-1 text-lg font-medium">
              {health.isPending ? 'Checking…' : health.isError ? 'Down' : (health.data?.status ?? '—')}
            </p>
          </div>
          <span
            className={
              'h-3 w-3 rounded-full ' +
              (health.isError ? 'bg-destructive' : health.data ? 'bg-primary' : 'bg-muted')
            }
          />
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Phase 0 shell. Upload, review, and query surfaces land in later phases.
      </p>
    </main>
  );
}
