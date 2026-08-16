import { Button } from '@/components/ui/button';
import type { ValidationResult } from '@/lib/api';
import { AlertTriangle } from 'lucide-react';

type Props = {
  rule: ValidationResult;
  onAccept: (value: unknown) => void;
  formatValue: (v: unknown) => string;
};

/**
 * The "why we distrust this" card. Shown inline under a field when a
 * validation rule failed and computed a satisfying value. One click = accept.
 */
export function ReconciliationCard({ rule, onAccept, formatValue }: Props) {
  const suggested = rule.suggestsValue;
  return (
    <div className="mt-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
        <div className="flex-1 space-y-1.5">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            {rule.message ?? rule.name.replaceAll('_', ' ')}
          </p>
          {suggested != null && (
            <div className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
              <span className="text-muted-foreground">Rule expects:</span>
              <span className="font-mono tabular-nums">{formatValue(suggested)}</span>
            </div>
          )}
          {suggested != null && (
            <div className="mt-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-amber-500/50 bg-white/70 text-xs hover:bg-white dark:bg-transparent"
                onClick={() => onAccept(suggested)}
              >
                Accept suggested value
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
