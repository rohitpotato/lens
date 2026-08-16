import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

type Props = {
  onApprove: () => void;
  onReject: (reason: string) => void;
  disabled?: boolean;
};

export function ReviewActions({ onApprove, onReject, disabled }: Props) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <div className="flex items-center gap-2 border-t border-border bg-card px-4 py-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setRejectOpen(true)}
        disabled={disabled}
      >
        Reject
      </Button>
      <div className="flex-1" />
      <span className="text-xs text-muted-foreground">
        <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">⌘ ↵</kbd> approve
      </span>
      <Button size="sm" onClick={onApprove} disabled={disabled}>
        Approve & next
      </Button>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this extraction?</DialogTitle>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this being rejected? (visible in the audit log)"
            rows={4}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length === 0}
              onClick={() => {
                onReject(reason.trim());
                setRejectOpen(false);
                setReason('');
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
