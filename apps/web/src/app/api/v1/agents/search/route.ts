import { NextRequest } from 'next/server';
import { and, eq, or, ilike, sql, count } from 'drizzle-orm';
import { withErrorHandling, parseQuery } from '@/lib/api-helpers';
import { searchQuerySchema } from '@agentdomain/shared';
import { getDb } from '@/db/index';
import { agents } from '@/db/schema';

export const runtime = 'nodejs';

/**
 * GET /api/v1/agents/search
 * Searches the public registry of registered agents.
 */
export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const parsed = parseQuery(req, searchQuerySchema);
    if (parsed instanceof Response) return parsed;

    const db = getDb();
    const conditions = [eq(agents.status, 'active')];

    if (parsed.q) {
      const q = `%${parsed.q.toLowerCase()}%`;
      conditions.push(
        or(
          ilike(agents.domain, q),
          ilike(agents.basename, q),
          sql`${agents.metadataJson}::text ILIKE ${q}`,
        )!,
      );
    }
    if (parsed.framework) {
      conditions.push(eq(agents.framework, parsed.framework));
    }
    if (parsed.capability) {
      conditions.push(sql`${agents.metadataJson}->'capabilities' ? ${parsed.capability}`);
    }

    const where = and(...conditions);
    const limit = parsed.limit ?? 20;
    const offset = parsed.offset ?? 0;

    const [items, totalRows] = await Promise.all([
      db
        .select({
          id: agents.id,
          domain: agents.domain,
          basename: agents.basename,
          ensName: agents.ensName,
          walletAddress: agents.walletAddress,
          ownerAddress: agents.ownerAddress,
          metadataUri: agents.metadataUri,
          framework: agents.framework,
          createdAt: agents.createdAt,
        })
        .from(agents)
        .where(where)
        .limit(limit)
        .offset(offset)
        .orderBy(sql`${agents.createdAt} desc`),
      db.select({ count: count() }).from(agents).where(where),
    ]);

    const total = Number(totalRows[0]?.count ?? 0);

    return Response.json({
      items,
      total,
      hasMore: offset + items.length < total,
    });
  }, { route: '/agents/search' });
}
