import { createDb, type Database } from '@lens/db';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export const dbPlugin = fp<{ url: string }>(async (app, opts) => {
  const db = createDb(opts.url);
  app.decorate('db', db);
});
