import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling, parseQuery, errorResponse } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { agentsRepo } from '@/db';

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

    const parsed = parseQuery(req, adminAgentsQuerySchema);
    if (parsed instanceof Response) return parsed;

    const result = await agentsRepo.list({
      q: parsed.q,
      status: parsed.status,
      limit: parsed.limit,
      offset: parsed.offset,
    });
    const items = result.items.map((agent) => ({
      id: agent.id,
      walletAddress: agent.walletAddress,
      agentIdNft: agent.agentIdNft,
      domain: agent.domain,
      basename: agent.basename,
      ensName: agent.ensName,
      status: agent.status,
      sslStatus: agent.sslStatus,
      framework: agent.framework,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      expiresAt: agent.expiresAt,
    }));
    return NextResponse.json({
      items,
      total: result.total,
      hasMore: result.hasMore,
      limit: parsed.limit,
      offset: parsed.offset,
      generatedAt: new Date().toISOString(),
    });
  }, { route: '/admin/agents' });
}
