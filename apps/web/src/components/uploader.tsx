import { useCallback, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, FileText } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

const MAX_BYTES = 50 * 1024 * 1024;
const ACCEPT = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
};

type UploadResponse = { id: string; status: string; dedup: boolean };

/**
 * shadcn-styled dropzone card. Client-side gates on MIME + size before
 * hitting the API, then renders the API's error `code` (413, cost_cap_reached,
 * rate-limit) as friendly text via toast.
 */
export function Uploader() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const onDrop = useCallback(
    async (accepted: File[], rejections: FileRejection[]) => {
      for (const r of rejections) {
        const first = r.errors[0];
        toast.error(`${r.file.name}: ${first?.message ?? 'invalid file'}`);
      }
      const file = accepted[0];
      if (!file) return;
      setBusy(true);
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/documents', { method: 'POST', body: form });
        const text = await res.text();
        const body = (text ? JSON.parse(text) : null) as UploadResponse | { error?: string; code?: string } | null;
        if (!res.ok) {
          throw new ApiError(`API ${res.status}`, res.status, body);
        }
        const uploadRes = body as UploadResponse;
        if (uploadRes.dedup) {
          toast.info(`${file.name} was already uploaded — reopening.`);
        } else {
          toast.success(`Uploaded ${file.name}. Processing…`);
        }
        // refresh dashboard feeds
        void queryClient.invalidateQueries({ queryKey: ['documents'] });
        void queryClient.invalidateQueries({ queryKey: ['queue'] });
        setTimeout(() => navigate(`/review/${uploadRes.id}`), 400);
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [navigate, queryClient],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxSize: MAX_BYTES,
    maxFiles: 1,
    multiple: false,
    disabled: busy,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-card p-8 text-center transition-colors',
        isDragActive && 'border-primary bg-primary/5',
        busy && 'pointer-events-none opacity-60',
      )}
    >
      <input {...getInputProps()} />
      <div className="rounded-full bg-muted p-3">
        {busy ? <FileText className="h-5 w-5 text-muted-foreground" /> : <Upload className="h-5 w-5 text-muted-foreground" />}
      </div>
      <p className="text-sm font-medium">
        {busy ? 'Uploading…' : isDragActive ? 'Drop it here' : 'Drop an invoice or click to browse'}
      </p>
      <p className="text-xs text-muted-foreground">PDF, PNG, or JPEG · up to 50MB</p>
    </div>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; code?: string; maxBytes?: number; cap?: number } | null;
    if (body?.code === 'cost_cap_reached') {
      return `Daily processing budget reached ($${body.cap?.toFixed(2)}). Try again after midnight UTC.`;
    }
    if (err.status === 413) {
      return `File too large (max 50MB).`;
    }
    if (err.status === 429) {
      return `Too many uploads from this address. Try again in an hour.`;
    }
    return body?.error ?? `Upload failed (${err.status}).`;
  }
  return err instanceof Error ? err.message : 'Upload failed.';
}
