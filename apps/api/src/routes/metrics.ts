import type { FastifyPluginAsync } from 'fastify';
import { CONTENT_TYPE, serializeMetrics } from '@lens/metrics';

export const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/metrics', async (_req, reply) => {
    reply.type(CONTENT_TYPE);
    return await serializeMetrics();
  });
};
