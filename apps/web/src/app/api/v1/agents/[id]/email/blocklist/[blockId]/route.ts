import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { emailBlocklist } from '@/db/schema';
import { errorResponse, withErrorHandling } from '@/lib/api-helpers';
import { requireAuthOrApiKey } from '@/lib/auth';
import { getOwnedEmailInbox } from '@/lib/email-inbox';

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

      const db = getDb();
      const [deleted] = await db
        .delete(emailBlocklist)
        .where(and(eq(emailBlocklist.id, blockId), eq(emailBlocklist.inboxId, row.inbox.id)))
        .returning();

      if (!deleted)
        return errorResponse(404, 'BLOCKLIST_ENTRY_NOT_FOUND', 'Blocklist entry not found');
      return NextResponse.json({ ok: true });
    },
    { route: '/agents/[id]/email/blocklist/[blockId]:DELETE' },
  );
}
