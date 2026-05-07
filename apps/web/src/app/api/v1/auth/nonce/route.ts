import { NextResponse } from 'next/server';
import { generateNonce } from '@/lib/auth';
import { withErrorHandling } from '@/lib/api-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/auth/nonce
 *
 * Returns a fresh SIWE nonce. The frontend includes this in the SIWE message
 * it asks the user to sign. The same nonce is stored in a short-lived cookie
 * and consumed during /verify to prevent replay attacks.
 */
export async function GET() {
  return withErrorHandling(async () => {
    const nonce = await generateNonce();
    return NextResponse.json({ nonce });
  }, { route: '/auth/nonce' });
}
