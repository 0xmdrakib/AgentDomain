import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { emailMessages } from '@/db/schema';
import { errorResponse, parseQuery, withErrorHandling } from '@/lib/api-helpers';
import { requireAuthOrApiKey } from '@/lib/auth';
import { getOwnedEmailInbox } from '@/lib/email-inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  unreadOnly: z.enum(['true', 'false']).optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(
    async () => {
      const auth = await requireAuthOrApiKey();
      if (auth instanceof NextResponse) return auth;

      const { id } = await params;
      if (!idSchema.safeParse(id).success) return errorResponse(400, 'BAD_ID', 'Invalid agent ID');

      const query = parseQuery(req, querySchema);
      if (query instanceof NextResponse) return query;

      const row = await getOwnedEmailInbox(id, auth.address);
      if (!row) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
      if (!row.inbox) return errorResponse(404, 'EMAIL_NOT_ENABLED', 'Email inbox is not enabled');

      const filters = [eq(emailMessages.inboxId, row.inbox.id)];
      if (query.unreadOnly === 'true') filters.push(eq(emailMessages.read, false));
      if (query.direction) filters.push(eq(emailMessages.direction, query.direction));

      const db = getDb();
      const messages = await db
        .select()
        .from(emailMessages)
        .where(and(...filters))
        .orderBy(desc(emailMessages.receivedAt))
        .limit(query.limit);

      return NextResponse.json({
        inbox: row.inbox,
        messages: messages.map((message) => ({
          id: message.id,
          direction: message.direction,
          providerMessageId: message.providerMessageId,
          fromAddress: message.fromAddress,
          toAddress: message.toAddress,
          subject: message.subject,
          text: message.text,
          verificationCodes: message.verificationCodes ?? [],
          spamVerdict: message.spamVerdict,
          virusVerdict: message.virusVerdict,
          receivedAt: message.receivedAt,
          read: message.read,
        })),
      });
    },
    { route: '/agents/[id]/email:GET' },
  );
}
