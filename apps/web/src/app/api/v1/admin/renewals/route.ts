import { NextRequest, NextResponse } from 'next/server';
import { and, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withErrorHandling, parseQuery, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/db';
import { renewals } from '@/db/schema';

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

      if (!process.env.DATABASE_URL) {
        return errorResponse(503, 'NO_DB', 'Database not configured');
      }

      const parsed = parseQuery(req, adminRenewalListSchema);
      if (parsed instanceof Response) return parsed;

      const conditions = [];
      if (parsed.status) conditions.push(eq(renewals.status, parsed.status));
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const db = getDb();
      const [items, totalRows] = await Promise.all([
        db
          .select({
            id: renewals.id,
            agentId: renewals.agentId,
            scheduledFor: renewals.scheduledFor,
            amount: renewals.amount,
            status: renewals.status,
            txHash: renewals.txHash,
            attemptCount: renewals.attemptCount,
            lastError: renewals.lastError,
            createdAt: renewals.createdAt,
            completedAt: renewals.completedAt,
          })
          .from(renewals)
          .where(where)
          .limit(parsed.limit)
          .offset(parsed.offset)
          .orderBy(sql`${renewals.scheduledFor} desc`),
        db.select({ count: count() }).from(renewals).where(where),
      ]);

      const total = Number(totalRows[0]?.count ?? 0);
      return NextResponse.json({
        items,
        total,
        hasMore: parsed.offset + items.length < total,
        limit: parsed.limit,
        offset: parsed.offset,
      });
    },
    { route: '/admin/renewals' },
  );
}
