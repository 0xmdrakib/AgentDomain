import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { withErrorHandling, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/db';
import { agents, sslHostnames } from '@/db/schema';
import { logger } from '@/lib/logger';
import { getCloudflareSaas } from '@/services/cloudflare-saas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = logger.child({ route: '/admin/agents/ssl-reprovision' });

/**
 * POST /api/v1/admin/agents/{id}/ssl-reprovision
 *
 * Recreate the apex-only Cloudflare for SaaS custom hostname for an agent.
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
      if (agent.domain.startsWith('www.')) {
        return errorResponse(400, 'APEX_ONLY', 'Cloudflare for SaaS hostnames must be apex-only');
      }

      const cf = getCloudflareSaas();
      const [existing] = await db
        .select()
        .from(sslHostnames)
        .where(eq(sslHostnames.agentId, id))
        .limit(1);

      if (existing?.cloudflareCustomHostnameId) {
        try {
          await cf.deleteHostname(existing.cloudflareCustomHostnameId);
        } catch (e) {
          log.warn('existing cloudflare saas hostname delete failed before reprovision', {
            agentId: id,
            cloudflareCustomHostnameId: existing.cloudflareCustomHostnameId,
            err: String(e),
          });
        }
      }

      const hostname = await cf.createApexHostname(agent.domain);
      const ready = hostname.status === 'active' && hostname.sslStatus === 'active';

      await db
        .insert(sslHostnames)
        .values({
          agentId: id,
          hostname: agent.domain,
          cloudflareCustomHostnameId: hostname.id,
          hostnameStatus: hostname.status,
          sslStatus: hostname.sslStatus,
          validationRecords: hostname.validationRecords,
          validationErrors: hostname.validationErrors,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [sslHostnames.agentId],
          set: {
            cloudflareCustomHostnameId: hostname.id,
            hostnameStatus: hostname.status,
            sslStatus: hostname.sslStatus,
            validationRecords: hostname.validationRecords,
            validationErrors: hostname.validationErrors,
            lastError: null,
            updatedAt: new Date(),
          },
        });

      await db
        .update(agents)
        .set({ sslStatus: ready ? 'active' : 'provisioning', updatedAt: new Date() })
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
        newSslStatus: ready ? 'active' : 'provisioning',
        hostname,
      });
    },
    { route: '/admin/agents/ssl-reprovision' },
  );
}
