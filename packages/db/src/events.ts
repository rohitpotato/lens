import { events } from './schema.js';

type Tx = {
  insert: (table: typeof events) => {
    values: (row: {
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      payload: unknown;
      traceId?: string | null;
    }) => Promise<unknown>;
  };
};

/**
 * Append an event within an existing transaction. Every mutation that changes
 * aggregate state must be paired with an appendEvent() in the same tx.
 */
export async function appendEvent(
  tx: Tx,
  input: {
    eventType: string;
    aggregateType: 'document' | 'extraction' | 'correction' | 'entity';
    aggregateId: string;
    payload: unknown;
    traceId?: string | null;
  },
): Promise<void> {
  await tx.insert(events).values({
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    payload: input.payload as never,
    traceId: input.traceId ?? null,
  });
}
