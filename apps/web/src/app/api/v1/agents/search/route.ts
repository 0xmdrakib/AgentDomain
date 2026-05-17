import { NextRequest } from 'next/server';
import { withErrorHandling, parseQuery } from '@/lib/api-helpers';
import { searchQuerySchema } from '@agentdomain/shared';
import { agentsRepo } from '@/db';

export const runtime = 'nodejs';

/**
 * GET /api/v1/agents/search
 * Searches the public registry of registered agents.
 */
export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const parsed = parseQuery(req, searchQuerySchema);
    if (parsed instanceof Response) return parsed;

    const limit = parsed.limit ?? 20;
    const offset = parsed.offset ?? 0;

    const result = await agentsRepo.list({
      q: parsed.q,
      framework: parsed.framework,
      capability: parsed.capability,
      publicOnly: true,
      limit,
      offset,
    });

    const items = result.items.map((agent) => ({
      id: agent.id,
      domain: agent.domain,
      basename: agent.basename,
      ensName: agent.ensName,
      walletAddress: agent.walletAddress,
      ownerAddress: agent.ownerAddress,
      metadataUri: agent.metadataUri,
      framework: agent.framework,
      createdAt: agent.createdAt,
    }));

    return Response.json({
      items,
      total: result.total,
      hasMore: result.hasMore,
    });
  }, { route: '/agents/search' });
}
