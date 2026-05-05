/**
 * Database migration runner.
 *
 * Run with:
 *   pnpm --filter @agentdomain/web db:migrate
 *
 * Loads .env.local explicitly because tsx doesn't read it automatically.
 */
import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, '..');

loadEnv({ path: resolve(webRoot, '.env.local'), override: true });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set in apps/web/.env.local');
    process.exit(1);
  }

  console.log('Connecting to database...');
  const client = postgres(url, { max: 1, idle_timeout: 5 });
  const db = drizzle(client);

  const migrationsFolder = resolve(webRoot, 'drizzle');
  console.log(`Running migrations from ${migrationsFolder}...`);
  const start = Date.now();

  try {
    await migrate(db, { migrationsFolder });
    console.log(`✓ Migrations complete in ${Date.now() - start}ms`);
  } catch (err) {
    console.error('✗ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
