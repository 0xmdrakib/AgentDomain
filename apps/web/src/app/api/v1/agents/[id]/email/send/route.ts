import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db';
import { emailMessages } from '@/db/schema';
import { applyRateLimit, errorResponse, parseBody, withErrorHandling } from '@/lib/api-helpers';
import { requireAuthOrApiKey } from '@/lib/auth';
import { getOwnedEmailInbox } from '@/lib/email-inbox';
import { getSesEmail } from '@/services/ses';
import { recordMetric } from '@/lib/metrics';
import { getServerEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();
const emailSchema = z.string().email().max(255);
const sendSchema = z
  .object({
    to: z.union([emailSchema, z.array(emailSchema).min(1).max(10)]),
    subject: z.string().min(1).max(200),
    text: z.string().min(1).max(20_000),
    replyTo: emailSchema.optional(),
  });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(
    async () => {
      const auth = await requireAuthOrApiKey();
      if (auth instanceof NextResponse) return auth;

      const { id } = await params;
      if (!idSchema.safeParse(id).success) return errorResponse(400, 'BAD_ID', 'Invalid agent ID');

      const env = getServerEnv();
      const parsed = await parseBody(req, sendSchema);
      if (parsed instanceof NextResponse) return parsed;

      const to = Array.isArray(parsed.to) ? parsed.to : [parsed.to];
      const hourlyLimit = await applyRateLimit(req, {
        key: `email-send:${id}:${auth.address.toLowerCase()}:hour`,
        max: Math.max(1, Math.floor(env.EMAIL_SEND_RATE_LIMIT_PER_HOUR / to.length)),
        windowSeconds: 60 * 60,
      });
      if (hourlyLimit) return hourlyLimit;
      const dailyLimit = await applyRateLimit(req, {
        key: `email-send:${id}:${auth.address.toLowerCase()}:day`,
        max: Math.max(1, Math.floor(env.EMAIL_SEND_RATE_LIMIT_PER_DAY / to.length)),
        windowSeconds: 24 * 60 * 60,
      });
      if (dailyLimit) return dailyLimit;

      const row = await getOwnedEmailInbox(id, auth.address);
      if (!row) return errorResponse(404, 'NOT_FOUND', 'Agent not found');
      if (!row.inbox) return errorResponse(404, 'EMAIL_NOT_ENABLED', 'Email inbox is not enabled');
      const result = await getSesEmail().sendTextEmail({
        from: row.inbox.emailAddress,
        to,
        subject: parsed.subject,
        text: parsed.text,
        replyTo: parsed.replyTo,
      });

      const db = getDb();
      const [message] = await db
        .insert(emailMessages)
        .values({
          inboxId: row.inbox.id,
          direction: 'outbound',
          providerMessageId: result.id,
          fromAddress: row.inbox.emailAddress,
          toAddress: to.join(','),
          subject: parsed.subject,
          text: parsed.text,
          read: true,
        })
        .returning();

      recordMetric('email_sent', { agentId: row.agent.id, recipientCount: String(to.length) });
      return NextResponse.json({ id: result.id, message }, { status: 201 });
    },
    { route: '/agents/[id]/email/send:POST' },
  );
}
