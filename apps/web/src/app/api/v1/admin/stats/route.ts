import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { platformRepo } from '@/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/admin/stats
 * Admin-only platform statistics.
 */
export async function GET() {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

    const stats = await platformRepo.stats();

    return NextResponse.json({
      ...stats,
      generatedAt: new Date().toISOString(),
    });
  }, { route: '/admin/stats' });
}
