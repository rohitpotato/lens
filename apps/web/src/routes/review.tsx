import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pdfUrl, reviewApi, type QueueItem } from '@/lib/api';
import { PdfViewer } from '@/components/pdf-viewer';
import { ReviewQueue } from '@/components/review/queue';
import { FieldsPanel } from '@/components/review/fields';
import { ReviewActions } from '@/components/review/actions';
import { Link } from 'react-router-dom';

export function ReviewPage() {
  const params = useParams<{ documentId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sessionStart] = useState(() => Date.now());
  const [sessionReviewed, setSessionReviewed] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - sessionStart), 1000);
    return () => clearInterval(t);
  }, [sessionStart]);

  const queueQuery = useQuery({
    queryKey: ['queue'],
    queryFn: () => reviewApi.queue().then((r) => r.queue),
    refetchInterval: 15_000,
  });

  const items: QueueItem[] = queueQuery.data ?? [];
  const activeId = params.documentId;

  const detailQuery = useQuery({
    queryKey: ['review', activeId],
    queryFn: () => reviewApi.detail(activeId!),
    enabled: !!activeId,
  });

  const detail = detailQuery.data;

  const correctMutation = useMutation({
    mutationFn: (input: { fieldPath: string; newValue: unknown }) =>
      reviewApi.correct(activeId!, {
        fieldPath: input.fieldPath,
        newValue: input.newValue,
        ...(detail?.extraction?.version != null ? { expectedVersion: detail.extraction.version } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['review', activeId] });
      void queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: () => reviewApi.approve(activeId!),
    onSuccess: () => {
      setSessionReviewed((n) => n + 1);
      advanceToNext();
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => reviewApi.reject(activeId!, reason),
    onSuccess: () => {
      setSessionReviewed((n) => n + 1);
      advanceToNext();
    },
  });

  const advanceToNext = () => {
    const currentIdx = items.findIndex((i) => i.documentId === activeId);
    void queryClient.invalidateQueries({ queryKey: ['queue'] });
    const next = items.find((i, idx) => idx > currentIdx && i.documentId !== activeId);
    if (next) navigate(`/review/${next.documentId}`);
    else navigate('/review');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (!activeId) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === 'Enter') {
        e.preventDefault();
        approveMutation.mutate();
      } else if (!isInput && e.key === 'R' && e.shiftKey) {
        // shift+R (uppercase) triggers reject dialog; user finishes in the dialog.
        e.preventDefault();
        document.getElementById('reject-open-trigger')?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, approveMutation]);

  const elapsedText = useMemo(() => formatDuration(elapsed), [elapsed]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-sm font-semibold tracking-tight">
            Lens
          </Link>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Review</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>Reviewed: <span className="tabular-nums text-foreground">{sessionReviewed}</span></span>
          <span>Backlog: <span className="tabular-nums text-foreground">{items.length}</span></span>
          <span>Session: <span className="tabular-nums text-foreground">{elapsedText}</span></span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,20%)_minmax(0,2fr)_minmax(360px,2fr)] overflow-hidden border-t border-border">
        <aside className="min-h-0 overflow-hidden border-r border-border bg-background">
          <ReviewQueue items={items} />
        </aside>

        <main className="min-h-0 overflow-hidden border-r border-border bg-muted/20">
          {activeId ? (
            <PdfViewer url={pdfUrl(activeId)} />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
              Select a document from the queue to begin.
            </div>
          )}
        </main>

        <section className="flex min-h-0 flex-col overflow-hidden bg-background">
          {activeId && detail?.extraction && detail.schema ? (
            <>
              <div className="min-h-0 flex-1 overflow-hidden">
                <FieldsPanel
                  schema={detail.schema}
                  extraction={detail.extraction}
                  saving={correctMutation.isPending}
                  onEdit={(fieldPath, newValue) =>
                    correctMutation.mutateAsync({ fieldPath, newValue }).then(() => undefined)
                  }
                />
              </div>
              <ReviewActions
                onApprove={() => approveMutation.mutate()}
                onReject={(reason) => rejectMutation.mutate(reason)}
                disabled={approveMutation.isPending || rejectMutation.isPending}
              />
            </>
          ) : activeId ? (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
              {detailQuery.isPending ? 'Loading extraction…' : 'No extraction available.'}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
              <div>
                <p className="mb-1 font-medium text-foreground">Nothing selected</p>
                <p>
                  Use <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">j</kbd>/
                  <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">k</kbd> to move
                  in the queue, <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">↵</kbd> to open.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}
