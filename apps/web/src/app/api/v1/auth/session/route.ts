import { NextResponse } from 'next/server';
import { getSession, clearSession } from '@/lib/auth';
import { withErrorHandling } from '@/lib/api-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAdminAddress(address: string): boolean {
  const adminList = (process.env.ADMIN_ADDRESSES ?? '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  return adminList.includes(address.toLowerCase());
}

/**
 * GET /api/v1/auth/session
 * Returns the current session (or 401 if no session).
 */
export async function GET() {
  return withErrorHandling(
    async () => {
      const session = await getSession();
      if (!session) {
        return NextResponse.json({ authenticated: false }, { status: 200 });
      }
      return NextResponse.json({
        authenticated: true,
        address: session.address,
        chainId: session.chainId,
        expiresAt: session.expiresAt,
        isAdmin: isAdminAddress(session.address),
      });
    },
    { route: '/auth/session' },
  );
}

/**
 * DELETE /api/v1/auth/session
 * Clears the session (logout).
 */
export async function DELETE() {
  return withErrorHandling(
    async () => {
      await clearSession();
      return NextResponse.json({ ok: true });
    },
    { route: '/auth/session' },
  );
}
