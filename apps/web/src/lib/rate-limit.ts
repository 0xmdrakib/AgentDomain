/**
 * Token-bucket rate limiter using Redis (Upstash) for distributed limits.
 * Falls back to in-memory if Redis isn't configured.
 */
import Redis from 'ioredis';
import { getServerEnv } from './env';
import { logger } from './logger';

const log = logger.child({ component: 'rate-limit' });

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  const env = getServerEnv();
  if (!env.REDIS_URL) return null;
  if (!_redis) {
    _redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    _redis.on('error', (err) => log.warn('redis error', { err: err.message }));
  }
  return _redis;
}

const memoryStore = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Sliding-window-ish rate limit: at most `max` calls per `windowSeconds`.
 */
export async function rateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const resetAt = (Math.floor(now / windowSeconds) + 1) * windowSeconds;
  const bucketKey = `rl:${key}:${Math.floor(now / windowSeconds)}`;

  const redis = getRedis();
  if (redis) {
    try {
      const count = await redis.incr(bucketKey);
      if (count === 1) await redis.expire(bucketKey, windowSeconds * 2);
      return {
        allowed: count <= max,
        remaining: Math.max(0, max - count),
        resetAt,
      };
    } catch (e) {
      log.warn('redis rate-limit failed, falling back', { err: String(e) });
    }
  }

  // Memory fallback
  const existing = memoryStore.get(bucketKey);
  const count = (existing?.count ?? 0) + 1;
  memoryStore.set(bucketKey, { count, resetAt });
  // Clean old entries
  if (memoryStore.size > 1000) {
    for (const [k, v] of memoryStore.entries()) {
      if (v.resetAt < now) memoryStore.delete(k);
    }
  }
  return {
    allowed: count <= max,
    remaining: Math.max(0, max - count),
    resetAt,
  };
}
