import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { runProductionPreflight } from '@/lib/preflight';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/v1/admin/preflight
 *
 * Admin-only production readiness check. Returns only statuses and sanitized
 * failure reasons; it never returns secret env values.
 *
 * Add `?external=1` to verify third-party API credentials too.
 */
export async function GET(req: NextRequest) {
  return withErrorHandling(
    async () => {
      const auth = await requireAdmin();
      if (auth instanceof NextResponse) return auth;

      const external = req.nextUrl.searchParams.get('external') === '1';
      const report = await runProductionPreflight({ external });
      const status = report.status === 'blocked' ? 503 : 200;

      return NextResponse.json(report, { status });
    },
    { route: '/admin/preflight' },
  );
}
