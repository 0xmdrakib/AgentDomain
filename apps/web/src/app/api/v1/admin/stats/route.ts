import { NextResponse } from 'next/server';
import { count, eq, sql, sum } from 'drizzle-orm';
import { withErrorHandling } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/db';
import { agents, registrations, renewals } from '@/db/schema';

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

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'NO_DB' }, { status: 503 });
    }

    const db = getDb();

    const [
      [agentCounts],
      [regCounts],
      [renewalCounts],
      [revenueRow],
    ] = await Promise.all([
      db
        .select({
          total: count(),
          active: sql<number>`count(*) filter (where status = 'active')`,
          expired: sql<number>`count(*) filter (where status = 'expired')`,
          revoked: sql<number>`count(*) filter (where status = 'revoked')`,
        })
        .from(agents),
      db
        .select({
          total: count(),
          completed: sql<number>`count(*) filter (where status = 'completed')`,
          failed: sql<number>`count(*) filter (where status = 'failed')`,
          pending: sql<number>`count(*) filter (where status = 'pending')`,
          last24h: sql<number>`count(*) filter (where created_at > now() - interval '24 hours')`,
          last7d: sql<number>`count(*) filter (where created_at > now() - interval '7 days')`,
        })
        .from(registrations),
      db
        .select({
          total: count(),
          completed: sql<number>`count(*) filter (where status = 'completed')`,
          failed: sql<number>`count(*) filter (where status = 'failed')`,
        })
        .from(renewals),
      db
        .select({ totalRevenueUsdc: sum(registrations.paymentAmount) })
        .from(registrations)
        .where(eq(registrations.status, 'completed')),
    ]);

    return NextResponse.json({
      agents: agentCounts,
      registrations: regCounts,
      renewals: renewalCounts,
      revenue: {
        totalUsdc: revenueRow?.totalRevenueUsdc ?? '0',
      },
      generatedAt: new Date().toISOString(),
    });
  }, { route: '/admin/stats' });
}
