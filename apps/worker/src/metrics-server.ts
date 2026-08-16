import { createServer, type Server } from 'node:http';
import { CONTENT_TYPE, serializeMetrics } from '@lens/metrics';
import type { Logger } from 'pino';

/**
 * Minimal HTTP server whose only job is /metrics. Prometheus scrapes this;
 * the worker doesn't need any other HTTP surface.
 */
export function startMetricsServer(opts: { port: number; log: Logger }): Server {
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/metrics') {
      try {
        const body = await serializeMetrics();
        res.writeHead(200, { 'content-type': CONTENT_TYPE });
        res.end(body);
      } catch (err) {
        opts.log.error({ err }, 'failed to serialize metrics');
        res.writeHead(500);
        res.end('metrics serialization failed');
      }
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(opts.port, () => {
    opts.log.info({ port: opts.port }, 'metrics server listening');
  });
  return server;
}
