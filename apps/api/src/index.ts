import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { loadEnv } from './env.js';
import { costGuardPlugin } from './plugins/cost-guard.js';
import { dbPlugin } from './plugins/db.js';
import { servicesPlugin, resolveDomainsDir, resolvePromptsDir } from './plugins/services.js';
import { documentRoutes } from './routes/documents.js';
import { healthRoutes } from './routes/health.js';
import { reviewRoutes } from './routes/reviews.js';
import { ruleRoutes } from './routes/rules.js';
import { queryRoutes } from './routes/query.js';
import { vendorRoutes } from './routes/vendors.js';

async function main() {
  const env = loadEnv();

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
  await app.register(healthRoutes);
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
