import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db';
import { emailMessages } from '@/db/schema';
import { applyRateLimit, errorResponse, parseBody, withErrorHandling } from '@/lib/api-helpers';
import { requireAuthOrApiKey } from '@/lib/auth';
import { getOwnedEmailInbox } from '@/lib/email-inbox';
import { getResend } from '@/services/resend';
import { recordMetric } from '@/lib/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();
const emailSchema = z.string().email().max(255);
const sendSchema = z
  .object({
    to: z.union([emailSchema, z.array(emailSchema).min(1).max(10)]),
    subject: z.string().min(1).max(200),
    text: z.string().max(20_000).optional(),
    html: z.string().max(50_000).optional(),
    replyTo: emailSchema.optional(),
  })
  .refine((value) => value.text || value.html, {
    message: 'Either text or html is required',
    path: ['text'],
  });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(
    async () => {
      const auth = await requireAuthOrApiKey();
      if (auth instanceof NextResponse) return auth;

      const { id } = await params;
      if (!idSchema.safeParse(id).success) return errorResponse(400, 'BAD_ID', 'Invalid agent ID');

      const limit = await applyRateLimit(req, {
        key: `email-send:${id}:${auth.address.toLowerCase()}`,
        max: 20,
        windowSeconds: 60 * 60,
      });
      if (limit) return limit;

      const parsed = await parseBody(req, sendSchema);
      if (parsed instanceof NextResponse) return parsed;

      const row = await getOwnedEmailInbox(id, auth.address);
      if (!row) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
      if (!row.inbox) return errorResponse(404, 'EMAIL_NOT_ENABLED', 'Email inbox is not enabled');

      const to = Array.isArray(parsed.to) ? parsed.to : [parsed.to];
      const result = await getResend().sendEmail({
        from: row.inbox.emailAddress,
        to,
        subject: parsed.subject,
        text: parsed.text,
        html: parsed.html,
        replyTo: parsed.replyTo,
      });

      const db = getDb();
      const [message] = await db
        .insert(emailMessages)
        .values({
          inboxId: row.inbox.id,
          direction: 'outbound',
          resendMessageId: result.id,
          fromAddress: row.inbox.emailAddress,
          toAddress: to.join(','),
          subject: parsed.subject,
          text: parsed.text,
          html: parsed.html,
          read: true,
        })
        .returning();

      recordMetric('email_sent', { agentId: row.agent.id, recipientCount: String(to.length) });
      return NextResponse.json({ id: result.id, message }, { status: 201 });
    },
    { route: '/agents/[id]/email/send:POST' },
  );
}
