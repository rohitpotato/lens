import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rulesApi, type Rule } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const TABS: { key: Rule['status']; label: string }[] = [
  { key: 'suggested', label: 'Suggested' },
  { key: 'adopted', label: 'Adopted' },
  { key: 'ignored', label: 'Ignored' },
];

export function RulesPage() {
  const [tab, setTab] = useState<Rule['status']>('suggested');
  const queryClient = useQueryClient();

  const rules = useQuery({
    queryKey: ['rules', tab],
    queryFn: () => rulesApi.list(tab).then((r) => r.rules),
    refetchInterval: 15_000,
  });

  const adopt = useMutation({
    mutationFn: (id: string) => rulesApi.adopt(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rules'] }),
  });
  const ignore = useMutation({
    mutationFn: (id: string) => rulesApi.ignore(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rules'] }),
  });
  const modify = useMutation({
    mutationFn: ({ id, hint }: { id: string; hint: string }) => rulesApi.modify(id, hint),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rules'] }),
  });

  return (
    <main className="mx-auto flex h-full max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="flex items-baseline justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
              ← Lens
            </Link>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Extraction rules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Patterns we noticed from your corrections. Adopt one to bake it into future extractions for that vendor.
          </p>
        </div>
      </header>

      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {rules.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (rules.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {tab === 'suggested'
              ? "No pending suggestions. Corrections that repeat across a vendor's invoices will show up here."
              : `No ${tab} rules.`}
          </p>
        ) : (
          (rules.data ?? []).map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onAdopt={() => adopt.mutate(rule.id)}
              onIgnore={() => ignore.mutate(rule.id)}
              onModify={(hint) => modify.mutate({ id: rule.id, hint })}
              busy={adopt.isPending || ignore.isPending || modify.isPending}
            />
          ))
        )}
      </div>
    </main>
  );
}

function RuleCard({
  rule,
  onAdopt,
  onIgnore,
  onModify,
  busy,
}: {
  rule: Rule;
  onAdopt: () => void;
  onIgnore: () => void;
  onModify: (hint: string) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rule.hint);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <span>{rule.documentType}</span>
        <span aria-hidden>·</span>
        <span className="text-foreground">{rule.vendor}</span>
        <span aria-hidden>·</span>
        <code className="rounded bg-muted px-1 py-0.5 text-[10px] normal-case tracking-normal">{rule.fieldPath}</code>
        <div className="flex-1" />
        <Badge variant={rule.status === 'adopted' ? 'default' : rule.status === 'ignored' ? 'secondary' : 'outline'}>
          seen in {rule.evidenceCount} correction{rule.evidenceCount === 1 ? '' : 's'}
        </Badge>
      </div>
      <div className="mt-3">
        {editing ? (
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="font-medium"
          />
        ) : (
          <p className="text-sm font-medium leading-snug">{rule.hint}</p>
        )}
        {!editing && rule.note && (
          <p className="mt-1.5 text-xs italic text-muted-foreground">— {rule.note}</p>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2">
        {editing ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setDraft(rule.hint);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <div className="flex-1" />
            <Button
              size="sm"
              onClick={() => {
                onModify(draft.trim());
                setEditing(false);
              }}
              disabled={busy || draft.trim().length === 0}
            >
              Save
            </Button>
          </>
        ) : rule.status === 'suggested' ? (
          <>
            <Button size="sm" variant="ghost" onClick={onIgnore} disabled={busy}>
              Ignore
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={busy}>
              Modify
            </Button>
            <div className="flex-1" />
            <Button size="sm" onClick={onAdopt} disabled={busy}>
              Adopt
            </Button>
          </>
        ) : rule.status === 'adopted' ? (
          <>
            <Button size="sm" variant="ghost" onClick={onIgnore} disabled={busy}>
              Retire
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={busy}>
              Modify
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={onAdopt} disabled={busy}>
            Restore
          </Button>
        )}
      </div>
    </div>
  );
}
