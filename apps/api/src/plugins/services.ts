import path from 'node:path';
import fp from 'fastify-plugin';
import { createStorage, type Storage } from '@lens/storage';
import { createQueue, type Queue } from '@lens/queue';
import {
  loadDomainSchemas,
  loadPromptFiles,
  type LoadedSchema,
  type LoadedPrompt,
} from '@lens/pipeline';

declare module 'fastify' {
  interface FastifyInstance {
    storage: Storage;
    queue: Queue;
    schemas: LoadedSchema[];
    prompts: LoadedPrompt[];
  }
}

export type ServicesConfig = {
  storage: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    forcePathStyle: boolean;
  };
  redisUrl: string;
  domainsDir: string;
  promptsDir: string;
};

export const servicesPlugin = fp<ServicesConfig>(async (app, opts) => {
  const storage = createStorage(opts.storage);
  const queue = createQueue(opts.redisUrl);
  const schemas = await loadDomainSchemas(app.db, opts.domainsDir);
  const prompts = await loadPromptFiles(app.db, opts.promptsDir);

  app.log.info(
    { schemas: schemas.map((s) => `${s.name}@${s.version}`), prompts: prompts.map((p) => `${p.name}@${p.version}`) },
    'domain artifacts loaded',
  );

  app.decorate('storage', storage);
  app.decorate('queue', queue);
  app.decorate('schemas', schemas);
  app.decorate('prompts', prompts);

  app.addHook('onClose', async () => {
    await queue.close();
  });
});

export function resolveDomainsDir(): string {
  return path.resolve(process.cwd(), '../../domains');
}

export function resolvePromptsDir(): string {
  return path.resolve(process.cwd(), '../../pipeline/prompts');
}
