import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

declare global {
  // eslint-disable-next-line no-var
  var __agentdomain_db: ReturnType<typeof drizzle> | undefined;
  // eslint-disable-next-line no-var
  var __agentdomain_pg: ReturnType<typeof postgres> | undefined;
}

function buildClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Add the AWS Aurora/RDS PostgreSQL URL to .env.local');
  }
  const pg = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return { pg, db: drizzle(pg, { schema }) };
}

let _db: ReturnType<typeof drizzle> | undefined;

export function getDb() {
  if (process.env.NODE_ENV === 'production') {
    if (!_db) {
      const { db } = buildClient();
      _db = db;
    }
    return _db;
  }
  // In dev, cache on globalThis to survive HMR.
  if (!globalThis.__agentdomain_db) {
    const { pg, db } = buildClient();
    globalThis.__agentdomain_db = db;
    globalThis.__agentdomain_pg = pg;
  }
  return globalThis.__agentdomain_db!;
}

export { schema };
export type {
  Agent,
  Registration,
  DnsRecordRow,
  SslHostnameRow,
  EmailInboxRow,
  Renewal,
} from './schema';
