import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { emailRepo } from '@/db';
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

      const message = await emailRepo.updateMessageRead(row.agent.id, messageId, parsed.read);

      if (!message) return errorResponse(404, 'MESSAGE_NOT_FOUND', 'Email message not found');
      return NextResponse.json({
        message: {
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
        },
      });
    },
    { route: '/agents/[id]/email/[messageId]:PATCH' },
  );
}
