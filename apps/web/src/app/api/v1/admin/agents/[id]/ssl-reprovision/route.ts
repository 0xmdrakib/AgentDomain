import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { agentsRepo, sslRepo } from '@/db';
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

      const agent = await agentsRepo.getById(id);

      if (!agent) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
      if (agent.domain.startsWith('www.')) {
        return errorResponse(400, 'APEX_ONLY', 'Cloudflare for SaaS hostnames must be apex-only');
      }

      const cf = getCloudflareSaas();
      const existing = await sslRepo.getByAgent(id);

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

      await sslRepo.upsert(id, {
        agentId: id,
        hostname: agent.domain,
        cloudflareCustomHostnameId: hostname.id,
        hostnameStatus: hostname.status,
        sslStatus: hostname.sslStatus,
        validationRecords: hostname.validationRecords,
        validationErrors: hostname.validationErrors,
        lastError: null,
      });

      await agentsRepo.update(id, {
        sslStatus: ready ? 'active' : 'provisioning',
        updatedAt: new Date(),
      });

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
