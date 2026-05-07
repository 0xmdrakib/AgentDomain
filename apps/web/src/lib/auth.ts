import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { SiweMessage } from 'siwe';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAddress, verifyMessage, type Address } from 'viem';
import { logger } from './logger';

/**
 * SIWE (Sign-In with Ethereum) authentication.
 *
 * Flow:
 *   1. Frontend calls POST /api/v1/auth/nonce → server returns a fresh nonce
 *   2. Frontend builds a SIWE message + signs it with wagmi `signMessage`
 *   3. Frontend POSTs message+signature to /api/v1/auth/verify
 *   4. Server verifies, issues a session cookie (HMAC-signed)
 *   5. Subsequent requests authenticate via the cookie
 *
 * Sessions are stateless: the cookie itself is a signed JWT-like token containing
 * (address, expiresAt). No DB lookup required for authentication checks.
 *
 * Why SIWE: it's the EIP-4361 standard, supported natively by wagmi,
 * Coinbase Wallet, MetaMask, etc. No third-party auth providers needed.
 */

const log = logger.child({ component: 'auth' });

const SESSION_COOKIE_NAME = '__agentdomain_session';
const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Get or generate a server secret for signing session tokens.
 * Falls back to a deterministic dev secret if not configured (DEV ONLY).
 */
function getSessionSecret(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (secret) {
    const trimmed = secret.trim();
    if (/^[a-f0-9]{64}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex');
    return createHash('sha256').update(trimmed).digest();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is required in production');
  }
  // Dev-only fallback. NEVER ship this to prod without setting SESSION_SECRET.
  log.warn('SESSION_SECRET not set — using insecure dev fallback');
  return Buffer.from('dev-secret-do-not-use-in-prod-' + 'x'.repeat(32), 'utf8').subarray(0, 32);
}

export interface SessionPayload {
  address: Address;
  expiresAt: number; // unix seconds
  chainId: number;
}

/**
 * Build a signed session token.
 * Format: base64url(payload).base64url(hmac)
 */
export function signSession(payload: SessionPayload): string {
  const secret = getSessionSecret();
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, 'utf8').toString('base64url');
  const hmac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${hmac}`;
}

/**
 * Verify a session token. Returns the payload if valid + not expired,
 * else returns null.
 */
export function verifySession(token: string): SessionPayload | null {
  try {
    const [body, hmac] = token.split('.');
    if (!body || !hmac) return null;

    const secret = getSessionSecret();
    const expected = createHmac('sha256', secret).update(body).digest('base64url');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const givenBuf = Buffer.from(hmac, 'utf8');
    if (expectedBuf.length !== givenBuf.length) return null;
    if (!timingSafeEqual(expectedBuf, givenBuf)) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (payload.expiresAt < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Generate a fresh SIWE nonce for the client to sign.
 * Stored in a short-lived cookie until verify completes.
 */
export async function generateNonce(): Promise<string> {
  const nonce = randomBytes(16).toString('hex');
  const cookieStore = await cookies();
  cookieStore.set('__agentdomain_nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 5 * 60, // 5 minutes
    path: '/',
  });
  return nonce;
}

export async function consumeNonce(): Promise<string | null> {
  const cookieStore = await cookies();
  const nonce = cookieStore.get('__agentdomain_nonce')?.value;
  if (nonce) cookieStore.delete('__agentdomain_nonce');
  return nonce ?? null;
}

/**
 * Verify a SIWE message + signature, then issue a session cookie.
 * Returns the recovered address on success.
 */
export async function verifySiweAndStartSession(
  message: string,
  signature: `0x${string}`,
): Promise<{ ok: true; address: Address; chainId: number } | { ok: false; reason: string }> {
  const expectedNonce = await consumeNonce();
  if (!expectedNonce) return { ok: false, reason: 'nonce_missing_or_expired' };

  let parsed: SiweMessage;
  try {
    parsed = new SiweMessage(message);
  } catch (e) {
    return { ok: false, reason: `bad_message: ${e instanceof Error ? e.message : 'unknown'}` };
  }

  if (parsed.nonce !== expectedNonce) {
    return { ok: false, reason: 'nonce_mismatch' };
  }

  let result;
  try {
    result = await parsed.verify(
      { signature, nonce: expectedNonce },
      { suppressExceptions: true },
    );
  } catch (e) {
    log.warn('siwe verify threw despite suppressExceptions', { err: String(e) });
    return { ok: false, reason: `verify_failed: ${e instanceof Error ? e.message : 'unknown'}` };
  }

  if (!result.success) {
    const reason = result.error?.type ?? 'verification_failed';
    log.warn('siwe verify failed', {
      reason,
      expected: result.error?.expected,
      received: result.error?.received,
    });
    return { ok: false, reason };
  }

  // Always use checksummed address as the canonical identity.
  let address: Address;
  try {
    address = getAddress(parsed.address);
  } catch {
    return { ok: false, reason: 'invalid_address' };
  }
  const chainId = parsed.chainId;
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;

  const token = signSession({ address, expiresAt, chainId });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DURATION_SECONDS,
    path: '/',
  });

  log.info('session created', { address, chainId });
  return { ok: true, address, chainId };
}

/**
 * Clear the session cookie.
 */
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

/**
 * Read the current session from the request, if any.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

/**
 * Authentication middleware for route handlers.
 *
 * Usage:
 *   export async function GET(req: NextRequest) {
 *     const session = await requireAuth();
 *     if (session instanceof NextResponse) return session;
 *     // session.address is authenticated
 *   }
 */
export async function requireAuth(): Promise<SessionPayload | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Sign in with your wallet to continue' },
      { status: 401 },
    );
  }
  return session;
}

/**
 * Admin-only auth: requires the session address to be in the ADMIN_ADDRESSES env list.
 */
export async function requireAdmin(): Promise<SessionPayload | NextResponse> {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;

  const adminList = (process.env.ADMIN_ADDRESSES ?? '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);

  if (!adminList.includes(session.address.toLowerCase())) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: 'Admin access required' },
      { status: 403 },
    );
  }
  return session;
}

/**
 * Authentication via API key (for programmatic Pro/Fleet access).
 * Reads `Authorization: Bearer agk_<prefix>_<secret>` header, validates against DB.
 */
export async function authenticateApiKey(): Promise<{
  userId: string;
  keyId: string;
  walletAddress: string;
} | null> {
  const headerStore = await headers();
  const auth = headerStore.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const key = auth.slice(7).trim();
  if (!key) return null;

  // Lazy-import to avoid pulling DB code into edge bundles.
  const { verifyApiKey } = await import('./api-keys');
  return verifyApiKey(key);
}

/**
 * Authenticate via Autonomous Agent Signature.
 * Reads `X-Agent-Signature` header in the format `walletAddress:timestamp:signature`.
 * Validates the signature matches the message `agentdomain.xyz api auth {timestamp}`
 * and ensures the timestamp is within the last 5 minutes.
 */
export async function authenticateAgentSignature(): Promise<{ walletAddress: string } | null> {
  const headerStore = await headers();
  const authHeader = headerStore.get('x-agent-signature');
  if (!authHeader) return null;

  const parts = authHeader.split(':');
  if (parts.length !== 3) return null;

  const [walletAddress, timestampStr, signature] = parts;
  if (!walletAddress || !timestampStr || !signature) return null;

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return null;

  // Enforce 5-minute replay window
  const now = Date.now();
  if (now - timestamp > 5 * 60 * 1000 || timestamp > now + 60 * 1000) {
    return null; // Expired or too far in the future
  }

  const message = `agentdomain.xyz api auth ${timestamp}`;

  try {
    const isValid = await verifyMessage({
      address: getAddress(walletAddress),
      message,
      signature: signature as `0x${string}`,
    });
    if (isValid) {
      return { walletAddress };
    }
  } catch (err) {
    log.warn('Failed to verify agent signature', { err: String(err) });
  }

  return null;
}

/**
 * Authenticate via SIWE session, API key, OR Agent Signature. Returns the wallet address.
 */
export async function requireAuthOrApiKey(): Promise<
  { address: Address; source: 'session' | 'api_key' | 'signature' } | NextResponse
> {
  const session = await getSession();
  if (session) {
    return { address: session.address, source: 'session' };
  }
  const apiAuth = await authenticateApiKey();
  if (apiAuth) {
    return { address: apiAuth.walletAddress as Address, source: 'api_key' };
  }
  const sigAuth = await authenticateAgentSignature();
  if (sigAuth) {
    return { address: getAddress(sigAuth.walletAddress), source: 'signature' };
  }
  return NextResponse.json(
    { error: 'UNAUTHORIZED', message: 'Sign in, provide an API key, or use an Agent Signature' },
    { status: 401 },
  );
}
