import { useEffect, useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

type Props = {
  url: string;
};

export function PdfViewer({ url }: Props) {
  const [numPages, setNumPages] = useState<number>(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.1);

  useEffect(() => {
    setPage(1);
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === '[') setPage((p) => Math.max(1, p - 1));
      else if (e.key === ']') setPage((p) => Math.min(numPages || 1, p + 1));
      else if (e.key === '+' || e.key === '=') setScale((s) => Math.min(2.5, s + 0.1));
      else if (e.key === '-' || e.key === '_') setScale((s) => Math.max(0.5, s - 0.1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [numPages]);

  const file = useMemo(() => ({ url }), [url]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-card px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="previous page"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {page} / {numPages || '—'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="next page"
            onClick={() => setPage((p) => Math.min(numPages || 1, p + 1))}
            disabled={page >= numPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="zoom out" onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="icon" aria-label="zoom in" onClick={() => setScale((s) => Math.min(2.5, s + 0.1))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-muted/30 p-3">
        <div className="flex justify-center">
          <Document
            file={file}
            onLoadSuccess={({ numPages: n }) => setNumPages(n)}
            loading={<div className="p-8 text-sm text-muted-foreground">Loading PDF…</div>}
            error={<div className="p-8 text-sm text-destructive">Failed to load PDF.</div>}
          >
            <Page pageNumber={page} scale={scale} renderTextLayer renderAnnotationLayer={false} />
          </Document>
        </div>
      </div>
    </div>
  );
}
