import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { emailRepo } from '@/db';
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

      const messages = await emailRepo.listMessages(row.agent.id, {
        limit: query.limit,
        unreadOnly: query.unreadOnly === 'true',
        direction: query.direction,
      });

      return NextResponse.json({
        inbox: row.inbox,
        messages: messages.items.map((message) => ({
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
