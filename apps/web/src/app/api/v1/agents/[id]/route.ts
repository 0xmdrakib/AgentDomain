import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling, errorResponse } from '@/lib/api-helpers';
import { requireAuthOrApiKey } from '@/lib/auth';
import { agentsRepo } from '@/db';

export const runtime = 'nodejs';

/**
 * GET /api/v1/agents/:id
 *
 * Returns the full identity state for a single agent.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(
    async () => {
      const auth = await requireAuthOrApiKey();
      if (auth instanceof Response) return auth;

      const { id } = await params;

      const agent = await agentsRepo.getById(id);

      if (!agent) return errorResponse(404, 'NOT_FOUND', 'Agent not found');

      return NextResponse.json(agent);
    },
    { route: '/agents/[id]' },
  );
}
