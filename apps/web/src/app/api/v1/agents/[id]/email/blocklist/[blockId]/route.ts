import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { emailRepo } from '@/db';
import { errorResponse, withErrorHandling } from '@/lib/api-helpers';
import { requireAuthOrApiKey } from '@/lib/auth';
import { getOwnedEmailInbox } from '@/lib/email-inbox';
import { assertWritesAllowed } from '@/lib/maintenance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; blockId: string }> },
) {
  return withErrorHandling(
    async () => {
      const auth = await requireAuthOrApiKey();
      if (auth instanceof NextResponse) return auth;

      const { id, blockId } = await params;
      if (!idSchema.safeParse(id).success || !idSchema.safeParse(blockId).success) {
        return errorResponse(400, 'BAD_ID', 'Invalid ID');
      }

      const row = await getOwnedEmailInbox(id, auth.address);
      if (!row) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
      if (!row.inbox) return errorResponse(404, 'EMAIL_NOT_ENABLED', 'Email inbox is not enabled');

      const frozen = assertWritesAllowed();
      if (frozen) return frozen;

      const deleted = await emailRepo.deleteBlocklist(row.agent.id, blockId);

      if (!deleted)
        return errorResponse(404, 'BLOCKLIST_ENTRY_NOT_FOUND', 'Blocklist entry not found');
      return NextResponse.json({ ok: true });
    },
    { route: '/agents/[id]/email/blocklist/[blockId]:DELETE' },
  );
}
