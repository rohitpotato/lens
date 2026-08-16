import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { loadEnv } from './env.js';
import {
  httpRequestDurationSeconds,
  rateLimitHitsTotal,
  setAppLabel,
} from '@lens/metrics';
import { costGuardPlugin } from './plugins/cost-guard.js';
import { dbPlugin } from './plugins/db.js';
import { servicesPlugin, resolveDomainsDir, resolvePromptsDir } from './plugins/services.js';
import { documentRoutes } from './routes/documents.js';
import { healthRoutes } from './routes/health.js';
import { metricsRoutes } from './routes/metrics.js';
import { reviewRoutes } from './routes/reviews.js';
import { ruleRoutes } from './routes/rules.js';
import { queryRoutes } from './routes/query.js';
import { vendorRoutes } from './routes/vendors.js';

async function main() {
  const env = loadEnv();
  setAppLabel('api');

  const isDev = env.NODE_ENV === 'development';
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(isDev
        ? {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
            },
          }
        : {}),
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(sensible);
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, {
    global: false,
    max: env.LENS_UPLOADS_PER_HOUR_PER_IP,
    timeWindow: '1 hour',
  });
  await app.register(dbPlugin, { url: env.DATABASE_URL });
  await app.register(costGuardPlugin, { dailyCapUsd: env.LENS_DAILY_COST_USD });
  await app.register(servicesPlugin, {
    storage: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
    redisUrl: env.REDIS_URL,
    domainsDir: resolveDomainsDir(),
    promptsDir: resolvePromptsDir(),
  });
  // Route-templated HTTP latency histogram. Keeps cardinality bounded by using
  // the fastify route pattern (e.g. /reviews/:documentId) rather than the raw URL.
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? 'unknown';
    if (route === '/metrics') return;
    const seconds = Number(reply.elapsedTime) / 1000;
    httpRequestDurationSeconds.observe(
      { method: req.method, route, status_code: String(reply.statusCode) },
      seconds,
    );
    if (reply.statusCode === 429) rateLimitHitsTotal.inc();
  });

  await app.register(healthRoutes);
  await app.register(metricsRoutes);
  await app.register(documentRoutes);
  await app.register(reviewRoutes);
  await app.register(ruleRoutes);
  await app.register(vendorRoutes);
  await app.register(queryRoutes);

  try {
    await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error({ err }, 'failed to start');
    process.exit(1);
  }
}

void main();
