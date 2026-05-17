import type { Config } from 'drizzle-kit';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// Drizzle-kit doesn't auto-load .env.local like Next.js does.
loadEnv({ path: resolve(process.cwd(), '.env.local'), override: true });

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'MIGRATION_DATABASE_URL is not set. This Drizzle config is migration-only.',
  );
}

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
} satisfies Config;
