import { eq } from 'drizzle-orm';
import { appendEvent, documents, createDb, type Database } from '@lens/db';
import { createAnthropicClient } from '@lens/llm';
import { setAppLabel } from '@lens/metrics';
import { createQueue, STREAMS } from '@lens/queue';
import { createStorage } from '@lens/storage';
import pino, { type Logger } from 'pino';
import { loadEnv } from './env.js';
import { makeClassifyConsumer } from './consumers/classify.js';
import { makeExtractConsumer } from './consumers/extract.js';
import { makeHintConsumer } from './consumers/hint.js';
import { startMetricsServer } from './metrics-server.js';

/**
 * Dead-letter handler for pipeline consumers that operate on a document.
 * Marks the doc failed + records an event so the reviewer can see why it
 * went dark instead of the message retrying invisibly forever.
 */
function makeDocumentDeadLetter(deps: { db: Database; log: Logger; step: string }) {
  return async (msg: { id: string; payload: { documentId?: string }; attempt: number }) => {
    const documentId = msg.payload.documentId;
    const log = deps.log.child({ step: deps.step, documentId, messageId: msg.id, attempts: msg.attempt });
    if (!documentId) {
      log.warn('dead-letter with no documentId — dropping');
      return;
    }
    await deps.db.transaction(async (tx) => {
      await tx.update(documents).set({ status: 'failed' }).where(eq(documents.id, documentId));
      await appendEvent(tx, {
        eventType: 'document.failed',
        aggregateType: 'document',
        aggregateId: documentId,
        payload: {
          step: deps.step,
          attempts: msg.attempt,
          messageId: msg.id,
          reason: 'exceeded max retry attempts',
        },
      });
    });
    log.error('document dead-lettered');
  };
}

async function main() {
  const env = loadEnv();
  setAppLabel('worker');
  const isDev = env.NODE_ENV === 'development';

  const log = pino({
    level: env.LOG_LEVEL,
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
    base: { app: 'worker', name: env.WORKER_NAME },
  });

  const db = createDb(env.DATABASE_URL);
  const llm = createAnthropicClient({ apiKey: env.ANTHROPIC_API_KEY });
  const storage = createStorage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
  const queue = createQueue(env.REDIS_URL);

  const classify = queue.createConsumer<{ documentId: string }>({
    stream: STREAMS.documentUploaded,
    group: 'classify',
    name: env.WORKER_NAME,
    handler: makeClassifyConsumer({ db, llm, storage, queue, log: log.child({ consumer: 'classify' }) }),
    maxAttempts: 2,
    onDeadLetter: makeDocumentDeadLetter({ db, log: log.child({ consumer: 'classify' }), step: 'classify' }),
  });

  const extract = queue.createConsumer<{ documentId: string }>({
    stream: STREAMS.documentClassified,
    group: 'extract',
    name: env.WORKER_NAME,
    handler: makeExtractConsumer({ db, llm, storage, queue, log: log.child({ consumer: 'extract' }) }),
    maxAttempts: 2,
    onDeadLetter: makeDocumentDeadLetter({ db, log: log.child({ consumer: 'extract' }), step: 'extract' }),
  });

  const hint = queue.createConsumer<{
    correctionId: string;
    extractionId: string;
    documentId: string;
    documentType: string;
    vendorKey: string;
    fieldPath: string;
  }>({
    stream: STREAMS.correctionApplied,
    group: 'hint',
    name: env.WORKER_NAME,
    handler: makeHintConsumer({ db, llm, log: log.child({ consumer: 'hint' }) }),
    maxAttempts: 2,
    // Hint gen failure isn't user-facing; the queue logs + acks. No doc state to update.
  });

  const metricsServer = startMetricsServer({ port: env.METRICS_PORT, log });

  classify.start();
  extract.start();
  hint.start();
  log.info('worker started');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    metricsServer.close();
    await classify.stop();
    await extract.stop();
    await hint.stop();
    await queue.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
