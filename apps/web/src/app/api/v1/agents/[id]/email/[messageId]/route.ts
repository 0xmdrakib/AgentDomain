import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { emailMessages } from '@/db/schema';
import { errorResponse, parseBody, withErrorHandling } from '@/lib/api-helpers';
import { requireAuthOrApiKey } from '@/lib/auth';
import { getOwnedEmailInbox } from '@/lib/email-inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();
const patchSchema = z.object({ read: z.boolean() });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  return withErrorHandling(
    async () => {
      const auth = await requireAuthOrApiKey();
      if (auth instanceof NextResponse) return auth;

      const { id, messageId } = await params;
      if (!idSchema.safeParse(id).success || !idSchema.safeParse(messageId).success) {
        return errorResponse(400, 'BAD_ID', 'Invalid ID');
      }

      const parsed = await parseBody(req, patchSchema);
      if (parsed instanceof NextResponse) return parsed;

      const row = await getOwnedEmailInbox(id, auth.address);
      if (!row) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
      if (!row.inbox) return errorResponse(404, 'EMAIL_NOT_ENABLED', 'Email inbox is not enabled');

      const db = getDb();
      const [message] = await db
        .update(emailMessages)
        .set({ read: parsed.read })
        .where(and(eq(emailMessages.id, messageId), eq(emailMessages.inboxId, row.inbox.id)))
        .returning();

      if (!message) return errorResponse(404, 'MESSAGE_NOT_FOUND', 'Email message not found');
      return NextResponse.json({ message });
    },
    { route: '/agents/[id]/email/[messageId]:PATCH' },
  );
}
