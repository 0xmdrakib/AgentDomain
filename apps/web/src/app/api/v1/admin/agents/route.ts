import { NextRequest, NextResponse } from 'next/server';
import { and, count, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withErrorHandling, parseQuery, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/db';
import { agents } from '@/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const adminAgentsQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(['pending', 'active', 'expired', 'revoked']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/v1/admin/agents
 * Admin-only list/search endpoint for operating registered agents.
 */
export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

    if (!process.env.DATABASE_URL) {
      return errorResponse(503, 'NO_DB', 'Database not configured');
    }

    const parsed = parseQuery(req, adminAgentsQuerySchema);
    if (parsed instanceof Response) return parsed;

    const conditions = [];
    if (parsed.status) {
      conditions.push(eq(agents.status, parsed.status));
    }
    if (parsed.q) {
      const q = `%${parsed.q.trim()}%`;
      conditions.push(
        or(
          ilike(agents.domain, q),
          ilike(agents.basename, q),
          ilike(agents.ensName, q),
          ilike(agents.walletAddress, q),
          sql`${agents.agentIdNft}::text ILIKE ${q}`,
        )!,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const db = getDb();

    const [items, totalRows] = await Promise.all([
      db
        .select({
          id: agents.id,
          walletAddress: agents.walletAddress,
          agentIdNft: agents.agentIdNft,
          domain: agents.domain,
          basename: agents.basename,
          ensName: agents.ensName,
          status: agents.status,
          sslStatus: agents.sslStatus,
          framework: agents.framework,
          createdAt: agents.createdAt,
          updatedAt: agents.updatedAt,
          expiresAt: agents.expiresAt,
        })
        .from(agents)
        .where(where)
        .limit(parsed.limit)
        .offset(parsed.offset)
        .orderBy(sql`${agents.createdAt} desc`),
      db.select({ count: count() }).from(agents).where(where),
    ]);

    const total = Number(totalRows[0]?.count ?? 0);
    return NextResponse.json({
      items,
      total,
      hasMore: parsed.offset + items.length < total,
      limit: parsed.limit,
      offset: parsed.offset,
      generatedAt: new Date().toISOString(),
    });
  }, { route: '/admin/agents' });
}
