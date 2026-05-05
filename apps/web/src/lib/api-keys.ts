import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb } from '@/db';
import { apiKeys, users } from '@/db/schema';
import { logger } from './logger';

/**
 * API Key system for programmatic access (Pro/Fleet tiers).
 *
 * Format: agk_<prefix>_<secret>
 *   - agk_     : product prefix
 *   - prefix   : 8 random chars (visible in dashboard, used to identify the key)
 *   - secret   : 32 random chars (NEVER stored — only the SHA-256 hash is)
 *
 * The full key is shown ONCE at creation time. Lost = revoke + create new.
 *
 * Verification flow:
 *   1. Client sends `Authorization: Bearer agk_<prefix>_<secret>`
 *   2. Server splits prefix + secret
 *   3. Look up by prefix (indexed)
 *   4. Hash secret + timing-safe compare
 *   5. Update lastUsedAt async (non-blocking)
 */

const log = logger.child({ component: 'api-keys' });

const PREFIX_LENGTH = 8;
const SECRET_LENGTH = 32;
const KEY_PREFIX = 'agk_';

export interface CreatedApiKey {
  id: string;
  name: string;
  prefix: string;
  /** Full key — only available at creation time. */
  fullKey: string;
}

export interface ApiKeyAuthResult {
  userId: string;
  keyId: string;
  walletAddress: string;
}

/**
 * Generate a new API key. Returns the full key (shown once) + DB record.
 */
export async function createApiKey(opts: {
  userId: string;
  name: string;
}): Promise<CreatedApiKey> {
  const prefix = randomBytes(PREFIX_LENGTH / 2)
    .toString('hex')
    .slice(0, PREFIX_LENGTH);
  const secret = randomBytes(SECRET_LENGTH).toString('base64url').slice(0, SECRET_LENGTH);
  const fullKey = `${KEY_PREFIX}${prefix}_${secret}`;
  const keyHash = hashKey(secret);

  const db = getDb();
  const [row] = await db
    .insert(apiKeys)
    .values({
      userId: opts.userId,
      keyHash,
      keyPrefix: prefix,
      name: opts.name,
    })
    .returning();

  if (!row) throw new Error('Failed to insert API key');

  log.info('api key created', { userId: opts.userId, prefix, name: opts.name });

  return {
    id: row.id,
    name: opts.name,
    prefix,
    fullKey,
  };
}

/**
 * List all API keys for a user (without secrets).
 */
export async function listApiKeys(userId: string) {
  const db = getDb();
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.keyPrefix,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(apiKeys.createdAt);
}

/**
 * Revoke (soft-delete) an API key.
 */
export async function revokeApiKey(keyId: string, userId: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .returning();
  return result.length > 0;
}

/**
 * Verify an API key from `Authorization: Bearer agk_<prefix>_<secret>`.
 * Returns null on any failure (don't leak which step failed — security through opacity).
 */
export async function verifyApiKey(rawKey: string): Promise<ApiKeyAuthResult | null> {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;

  const body = rawKey.slice(KEY_PREFIX.length);
  const sepIdx = body.indexOf('_');
  if (sepIdx === -1) return null;

  const prefix = body.slice(0, sepIdx);
  const secret = body.slice(sepIdx + 1);
  if (prefix.length !== PREFIX_LENGTH || secret.length !== SECRET_LENGTH) return null;

  let row;
  try {
    const db = getDb();
    [row] = await db
      .select({
        id: apiKeys.id,
        userId: apiKeys.userId,
        keyHash: apiKeys.keyHash,
        revokedAt: apiKeys.revokedAt,
        userWallet: users.walletAddress,
      })
      .from(apiKeys)
      .leftJoin(users, eq(users.id, apiKeys.userId))
      .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)))
      .limit(1);
  } catch (e) {
    log.warn('api key lookup failed', { err: String(e) });
    return null;
  }

  if (!row) return null;
  if (row.revokedAt) return null;
  if (!row.userWallet) return null;

  const expectedHash = hashKey(secret);
  const expectedBuf = Buffer.from(expectedHash, 'utf8');
  const actualBuf = Buffer.from(row.keyHash, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, actualBuf)) return null;

  // Async-update lastUsedAt (don't block the request)
  void updateLastUsed(row.id).catch((e) => log.warn('lastUsedAt update failed', { err: String(e) }));

  return {
    userId: row.userId,
    keyId: row.id,
    walletAddress: row.userWallet,
  };
}

async function updateLastUsed(keyId: string) {
  const db = getDb();
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyId));
}

function hashKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Find or create a user record for a given wallet. Used when a SIWE login
 * for a never-seen-before wallet wants to create their first API key.
 */
export async function findOrCreateUser(walletAddress: string): Promise<{ id: string }> {
  const db = getDb();
  const wallet = walletAddress.toLowerCase();

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.walletAddress, wallet))
    .limit(1);
  if (existing) return existing;

  const [created] = await db.insert(users).values({ walletAddress: wallet }).returning({ id: users.id });
  if (!created) throw new Error('Failed to create user');
  return created;
}
