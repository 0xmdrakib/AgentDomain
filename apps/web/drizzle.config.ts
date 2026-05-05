import type { Config } from 'drizzle-kit';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// Drizzle-kit doesn't auto-load .env.local like Next.js does.
loadEnv({ path: resolve(process.cwd(), '.env.local'), override: true });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Add it to apps/web/.env.local — get a free DB at neon.tech',
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
