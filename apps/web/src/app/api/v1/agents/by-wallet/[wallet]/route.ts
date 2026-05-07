import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { withErrorHandling, errorResponse } from '@/lib/api-helpers';
import { addressSchema } from '@agentdomain/shared';
import { getDb } from '@/db';
import { agents } from '@/db/schema';

export const runtime = 'nodejs';

/**
 * GET /api/v1/agents/by-wallet/{wallet}
 *
 * Returns ALL agent identities owned by a wallet address.
 * A single wallet can own multiple agent identities (multiple domains).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ wallet: string }> },
) {
  return withErrorHandling(async () => {
    const { wallet } = await params;
    const parsed = addressSchema.safeParse(wallet);
    if (!parsed.success) {
      return errorResponse(400, 'INVALID_ADDRESS', 'Wallet must be a valid 0x address');
    }

    const db = getDb();
    const rows = await db
      .select()
      .from(agents)
      .where(eq(agents.ownerAddress, parsed.data.toLowerCase()))
      .orderBy(agents.createdAt);

    // Return array (wallet can own multiple agents)
    return Response.json(rows);
  }, { route: '/agents/by-wallet/[wallet]' });
}
