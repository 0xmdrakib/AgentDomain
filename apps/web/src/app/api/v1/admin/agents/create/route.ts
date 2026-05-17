import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, parseBody, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { agentsRepo } from '@/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = logger.child({ route: '/admin/agents/create' });

const manualCreateSchema = z.object({
  domain: z.string().min(4).max(253),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  basename: z.string().min(5).max(255).optional(),
  ensName: z.string().min(5).max(255).optional(),
  agentIdNft: z.coerce.number().int().positive().optional(),
  sslStatus: z.enum(['pending', 'provisioning', 'active', 'failed', 'expired']).default('pending'),
  framework: z.string().max(50).optional(),
  status: z.enum(['pending', 'active', 'expired', 'revoked']).default('active'),
  dnsTarget: z.string().url().optional(),
});

/**
 * POST /api/v1/admin/agents/create
 *
 * Manually create an agent identity row. Use when a registration failed
 * but the domain/spaceship registration succeeded, or when you need to
 * backfill an agent for any other reason.
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(
    async () => {
      const auth = await requireAdmin();
      if (auth instanceof NextResponse) return auth;

      const parsed = await parseBody(req, manualCreateSchema);
      if (parsed instanceof Response) return parsed;

      const existing = await agentsRepo.getByDomain(parsed.domain.toLowerCase());
      if (existing) {
        return errorResponse(409, 'DUPLICATE', `Domain ${parsed.domain} is already registered`);
      }

      // Resolve token ID: use provided or find next available
      let tokenId = parsed.agentIdNft;
      if (!tokenId) {
        tokenId = (await agentsRepo.maxTokenId()) + 1;
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

      const agent = await agentsRepo.create({
        walletAddress: parsed.walletAddress.toLowerCase(),
        ownerAddress: parsed.walletAddress.toLowerCase(),
        agentIdNft: tokenId,
        domain: parsed.domain.toLowerCase(),
        basename: parsed.basename?.toLowerCase() ?? null,
        ensName: parsed.ensName?.toLowerCase() ?? null,
        status: parsed.status ?? 'active',
        sslStatus: parsed.sslStatus ?? 'pending',
        framework: parsed.framework ?? null,
        dnsTarget: parsed.dnsTarget ?? null,
        createdAt: now,
        updatedAt: now,
        expiresAt,
        metadataUri: null,
        metadataJson: null,
      });

      log.info('agent manually created', {
        agentId: agent!.id,
        domain: parsed.domain,
        tokenId,
        admin: auth.address,
      });

      return NextResponse.json({ ok: true, agent }, { status: 201 });
    },
    { route: '/admin/agents/create' },
  );
}
