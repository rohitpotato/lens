import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Load repo-root .env for local dev. In prod (k8s / docker) the file is
// absent and env comes from envFrom; this branch is a no-op then.
const envPath = resolve(process.cwd(), '../../.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('DATABASE_URL is required');
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
