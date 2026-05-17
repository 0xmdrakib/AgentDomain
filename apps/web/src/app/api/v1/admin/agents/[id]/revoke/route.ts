import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, parseBody, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { agentsRepo, emailRepo, sslRepo } from '@/db';
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

    const agent = await agentsRepo.getById(id);
    if (!agent) {
      return errorResponse(404, 'NOT_FOUND', 'Agent not found');
    }

    await agentsRepo.update(id, { status: 'revoked', updatedAt: new Date() });

    const ssl = await sslRepo.getByAgent(id);
    if (ssl) {
      try {
        const { getCloudflareSaas } = await import('@/services/cloudflare-saas');
        await getCloudflareSaas().deleteHostname(ssl.cloudflareCustomHostnameId);
      } catch (e) {
        log.warn('failed to delete cloudflare saas hostname during revoke', {
          agentId: id,
          err: String(e),
        });
      }
      await sslRepo.delete(id);
    }

    try {
      const { getSesEmail } = await import('@/services/ses');
      await getSesEmail().deleteIdentity(agent.domain);
    } catch (e) {
      log.warn('failed to delete ses identity during revoke', { agentId: id, err: String(e) });
    }
    await emailRepo.deleteInbox(id);

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
