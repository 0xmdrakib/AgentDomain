import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { withErrorHandling, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/db';
import { agents } from '@/db/schema';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = logger.child({ route: '/admin/agents/ssl-reprovision' });

/**
 * POST /api/v1/admin/agents/{id}/ssl-reprovision
 *
 * Trigger SSL re-provisioning for a specific agent.
 * Sets sslStatus back to 'pending' so the SSL provisioner service picks it up.
 * Works for agents with any sslStatus (provisioning, failed, expired).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(
    async () => {
      const auth = await requireAdmin();
      if (auth instanceof NextResponse) return auth;

      const { id } = await params;

      if (!process.env.DATABASE_URL) {
        return errorResponse(503, 'NO_DB', 'Database not configured');
      }

      const db = getDb();
      const [agent] = await db
        .select({ id: agents.id, domain: agents.domain, sslStatus: agents.sslStatus })
        .from(agents)
        .where(eq(agents.id, id))
        .limit(1);

      if (!agent) return errorResponse(404, 'NOT_FOUND', 'Agent not found');

      await db
        .update(agents)
        .set({ sslStatus: 'pending', updatedAt: new Date() })
        .where(eq(agents.id, id));

      log.info('ssl reprovision triggered', {
        agentId: id,
        domain: agent.domain,
        previousStatus: agent.sslStatus,
        admin: auth.address,
      });

      return NextResponse.json({
        ok: true,
        agentId: id,
        previousSslStatus: agent.sslStatus,
        newSslStatus: 'pending',
      });
    },
    { route: '/admin/agents/ssl-reprovision' },
  );
}
