import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, parseQuery, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { renewalsRepo } from '@/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const adminRenewalListSchema = z.object({
  status: z.enum(['scheduled', 'in_progress', 'completed', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/v1/admin/renewals
 * Admin-only list of all renewal jobs with filtering by status.
 */
export async function GET(req: NextRequest) {
  return withErrorHandling(
    async () => {
      const auth = await requireAdmin();
      if (auth instanceof NextResponse) return auth;

      const parsed = parseQuery(req, adminRenewalListSchema);
      if (parsed instanceof Response) return parsed;

      const result = await renewalsRepo.list({
        status: parsed.status,
        limit: parsed.limit,
        offset: parsed.offset,
      });
      return NextResponse.json({
        items: result.items,
        total: result.total,
        hasMore: result.hasMore,
        limit: parsed.limit,
        offset: parsed.offset,
      });
    },
    { route: '/admin/renewals' },
  );
}
