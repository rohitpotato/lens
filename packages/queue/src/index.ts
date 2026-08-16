import { Redis } from 'ioredis';

export type QueueMessage<T = Record<string, unknown>> = {
  id: string;
  payload: T;
  attempt: number;
};

export type ConsumerHandler<T = Record<string, unknown>> = (msg: QueueMessage<T>) => Promise<void>;

/**
 * Called when a message has been retried maxAttempts times without success.
 * The message is XACK'd after this callback returns (whether it throws or
 * not — we're giving up on the message either way).
 */
export type DeadLetterHandler<T = Record<string, unknown>> = (msg: QueueMessage<T>) => Promise<void>;

export type Queue = {
  publish<T extends Record<string, unknown>>(stream: string, payload: T): Promise<string>;
  createConsumer<T extends Record<string, unknown>>(opts: {
    stream: string;
    group: string;
    name: string;
    handler: ConsumerHandler<T>;
    /** Called when delivery count exceeds maxAttempts. Message is acked after. */
    onDeadLetter?: DeadLetterHandler<T>;
    /** Reclaim messages pending longer than this. Defaults to 60_000 ms. */
    claimIdleMs?: number;
    /** Poll interval when no messages available. Defaults to 1000 ms. */
    idlePollMs?: number;
    /** Max delivery attempts before dead-lettering. Defaults to 2. */
    maxAttempts?: number;
  }): Consumer;
  close(): Promise<void>;
};

export type Consumer = {
  start(): void;
  stop(): Promise<void>;
};

export function createQueue(redisUrl: string): Queue {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

  async function ensureGroup(stream: string, group: string): Promise<void> {
    try {
      await redis.xgroup('CREATE', stream, group, '$', 'MKSTREAM');
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
    }
  }

  return {
    async publish(stream, payload) {
      const id = await redis.xadd(stream, '*', 'data', JSON.stringify(payload));
      if (!id) throw new Error('xadd returned null');
      return id;
    },

    createConsumer(opts) {
      const claimIdleMs = opts.claimIdleMs ?? 60_000;
      const idlePollMs = opts.idlePollMs ?? 1000;
      const maxAttempts = opts.maxAttempts ?? 2;
      let running = false;

      async function fetchPayload(id: string): Promise<Record<string, unknown> | null> {
        // XRANGE stream id id → single-entry read to recover the payload for dead-letter dispatch.
        const res = (await redis.xrange(opts.stream, id, id)) as [string, string[]][] | null;
        const entry = res?.[0];
        if (!entry) return null;
        const [, fields] = entry;
        const dataIdx = fields.indexOf('data');
        const raw = dataIdx >= 0 ? fields[dataIdx + 1] : undefined;
        if (!raw) return null;
        try {
          return JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return null;
        }
      }

      /**
       * Look at the pending-entries list. Any entry whose delivery count has
       * exceeded maxAttempts is a "poison message" — we dead-letter it and
       * ack so it stops burning retries.
       *
       * `XPENDING stream group IDLE min-idle - + count` returns:
       *   [messageId, consumer, idleMs, deliveryCount][]
       */
      async function drainDeadLetters(): Promise<void> {
        const pending = (await redis.xpending(
          opts.stream,
          opts.group,
          'IDLE',
          claimIdleMs,
          '-',
          '+',
          50,
        )) as [string, string, number, number][] | null;
        if (!pending || pending.length === 0) return;

        for (const [id, , , deliveryCount] of pending) {
          if (deliveryCount <= maxAttempts) continue;
          const payload = await fetchPayload(id);
          if (opts.onDeadLetter && payload) {
            try {
              await opts.onDeadLetter({ id, payload: payload as never, attempt: deliveryCount });
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error(`[queue:${opts.stream}] dead-letter handler failed for ${id}`, err);
            }
          } else if (!opts.onDeadLetter) {
            // eslint-disable-next-line no-console
            console.warn(
              `[queue:${opts.stream}] dead-lettering ${id} after ${deliveryCount} attempts (no handler)`,
            );
          }
          // Ack unconditionally — we're giving up on this message either way.
          await redis.xack(opts.stream, opts.group, id);
        }
      }

      async function loop(): Promise<void> {
        await ensureGroup(opts.stream, opts.group);

        while (running) {
          await drainDeadLetters();

          const claimed = await redis.xautoclaim(
            opts.stream,
            opts.group,
            opts.name,
            claimIdleMs,
            '0',
            'COUNT',
            10,
          );
          const claimedEntries = (claimed as unknown as [string, [string, string[]][]])[1];
          for (const entry of claimedEntries) {
            await dispatch(entry);
          }

          const res = (await redis.xreadgroup(
            'GROUP',
            opts.group,
            opts.name,
            'COUNT',
            10,
            'BLOCK',
            idlePollMs,
            'STREAMS',
            opts.stream,
            '>',
          )) as [string, [string, string[]][]][] | null;

          if (!res) continue;
          for (const [, entries] of res) {
            for (const entry of entries) {
              await dispatch(entry);
            }
          }
        }
      }

      async function dispatch(entry: [string, string[]]): Promise<void> {
        const [id, fields] = entry;
        const dataIdx = fields.indexOf('data');
        const raw = dataIdx >= 0 ? fields[dataIdx + 1] : undefined;
        if (!raw) {
          await redis.xack(opts.stream, opts.group, id);
          return;
        }
        try {
          const payload = JSON.parse(raw) as Record<string, unknown>;
          await opts.handler({ id, payload: payload as never, attempt: 1 });
          await redis.xack(opts.stream, opts.group, id);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[queue:${opts.stream}] handler failed for ${id}`, err);
          // Leave unacked; xautoclaim will retry after claimIdleMs.
          // If delivery count exceeds maxAttempts, drainDeadLetters() picks it up.
        }
      }

      return {
        start() {
          if (running) return;
          running = true;
          void loop();
        },
        async stop() {
          running = false;
        },
      };
    },

    async close() {
      await redis.quit();
    },
  };
}

export const STREAMS = {
  documentUploaded: 'lens:document.uploaded',
  documentClassified: 'lens:document.classified',
  extractionCompleted: 'lens:extraction.completed',
  correctionApplied: 'lens:correction.applied',
} as const;
