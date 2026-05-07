import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { withErrorHandling, parseBody, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/db';
import { agents } from '@/db/schema';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = logger.child({ route: '/admin/agents/revoke' });

const schema = z.object({
  reason: z.string().min(3).max(200),
});

/**
 * POST /api/v1/admin/agents/{id}/revoke
 *
 * Revoke an agent identity. This does:
 *   1. Mark the DB row as 'revoked'
 *   2. (TODO) Call AgentIdentityRegistry.revokeIdentity() on-chain
 *
 * Used to handle ToS violations, abuse reports, court orders.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withErrorHandling(async () => {
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;
    const parsed = await parseBody(req, schema);
    if (parsed instanceof Response) return parsed;

    if (!process.env.DATABASE_URL) {
      return errorResponse(503, 'NO_DB', 'Database not configured');
    }

    const db = getDb();
    const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (!agent) {
      return errorResponse(404, 'NOT_FOUND', 'Agent not found');
    }

    await db
      .update(agents)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(eq(agents.id, id));

    log.info('agent revoked', {
      agentId: id,
      domain: agent.domain,
      adminAddress: auth.address,
      reason: parsed.reason,
    });

    // TODO: Call registry.revokeIdentity(tokenId, reason) on-chain.
    // Deferred until contract owner multisig is configured.

    return NextResponse.json({ ok: true, agentId: id });
  }, { route: '/admin/agents/revoke' });
}
