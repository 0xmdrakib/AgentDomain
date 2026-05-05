import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifySiweAndStartSession } from '@/lib/auth';
import { withErrorHandling, parseBody, errorResponse, applyRateLimit } from '@/lib/api-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  message: z.string().min(1).max(10_000),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

/**
 * POST /api/v1/auth/verify
 *
 * Body: { message, signature }
 *
 * Verifies the SIWE message + signature against the nonce issued by /nonce.
 * On success, sets the session cookie and returns the authenticated address.
 * Rate-limited to prevent brute-force.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    // Rate limit by IP — verify is cheap CPU but expensive if abused
    const rl = await applyRateLimit(req, {
      max: 30,
      windowSeconds: 60,
      key: `auth:${req.headers.get('x-forwarded-for') ?? 'unknown'}`,
    });
    if (rl) return rl;

    const parsed = await parseBody(req, schema);
    if (parsed instanceof Response) return parsed;

    let result;
    try {
      result = await verifySiweAndStartSession(
        parsed.message,
        parsed.signature as `0x${string}`,
      );
    } catch (e) {
      if (e instanceof Error && e.message.includes('SESSION_SECRET')) {
        return errorResponse(
          503,
          'AUTH_CONFIG_ERROR',
          'Sign-in is not configured. Set SESSION_SECRET in the web app environment.',
        );
      }
      throw e;
    }

    if (!result.ok) {
      return errorResponse(401, 'AUTH_FAILED', result.reason);
    }

    return NextResponse.json({
      address: result.address,
      chainId: result.chainId,
    });
  }, { route: '/auth/verify' });
}
