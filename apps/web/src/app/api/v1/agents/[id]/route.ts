import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { withErrorHandling, errorResponse } from '@/lib/api-helpers';
import { requireAuthOrApiKey } from '@/lib/auth';
import { getDb } from '@/db';
import { agents } from '@/db/schema';

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

      const db = getDb();
      const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);

      if (!agent) return errorResponse(404, 'NOT_FOUND', 'Agent not found');

      return NextResponse.json(agent);
    },
    { route: '/agents/[id]' },
  );
}
