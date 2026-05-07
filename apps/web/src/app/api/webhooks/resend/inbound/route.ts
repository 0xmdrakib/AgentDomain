import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { emailMessages } from '@/db/schema';
import { getDb } from '@/db';
import { withErrorHandling, errorResponse } from '@/lib/api-helpers';
import { getServerEnv } from '@/lib/env';
import { findInboxByRecipient, isSenderBlocked, normalizeEmailAddress } from '@/lib/email-inbox';
import { logger } from '@/lib/logger';
import { recordMetric } from '@/lib/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = logger.child({ route: 'webhooks/resend/inbound' });

export async function POST(req: NextRequest) {
  return withErrorHandling(
    async () => {
      const authError = authorizeWebhook(req);
      if (authError) return authError;

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return errorResponse(400, 'BAD_JSON', 'Request body is not valid JSON');
      }

      const data = getPayloadData(body);
      const fromAddress = normalizeEmailAddress(readString(data, 'from'));
      const recipients = collectRecipients(data);
      const recipient = recipients[0];

      if (!fromAddress || !recipient) {
        recordMetric('email_inbound_ignored', { reason: 'missing_address' });
        return NextResponse.json(
          { ok: true, ignored: true, reason: 'missing_address' },
          { status: 202 },
        );
      }

      const inboxRow = await findInboxByRecipient(recipient);
      if (!inboxRow?.inbox) {
        recordMetric('email_inbound_ignored', { reason: 'unknown_recipient', recipient });
        return NextResponse.json(
          { ok: true, ignored: true, reason: 'unknown_recipient' },
          { status: 202 },
        );
      }

      if (await isSenderBlocked(inboxRow.inbox.id, fromAddress)) {
        recordMetric('email_inbound_blocked', { recipient, fromDomain: fromAddress.split('@')[1] });
        return NextResponse.json({ ok: true, blocked: true }, { status: 202 });
      }

      const resendMessageId = readString(data, 'id') ?? readString(data, 'messageId');
      const values = {
        inboxId: inboxRow.inbox.id,
        direction: 'inbound',
        resendMessageId,
        fromAddress,
        toAddress: recipient,
        subject: readString(data, 'subject'),
        text: readString(data, 'text') ?? readString(data, 'textBody'),
        html: readString(data, 'html') ?? readString(data, 'htmlBody'),
        rawPayload: body as Record<string, unknown>,
      };

      const db = getDb();
      if (resendMessageId) {
        await db.insert(emailMessages).values(values).onConflictDoNothing({
          target: emailMessages.resendMessageId,
        });
      } else {
        await db.insert(emailMessages).values(values);
      }

      log.info('inbound email stored', {
        inboxId: inboxRow.inbox.id,
        agentId: inboxRow.agent.id,
        from: fromAddress,
        to: recipient,
      });
      recordMetric('email_inbound_stored', { agentId: inboxRow.agent.id });

      return NextResponse.json({ ok: true });
    },
    { route: '/webhooks/resend/inbound:POST' },
  );
}

function authorizeWebhook(req: NextRequest): NextResponse | null {
  const env = getServerEnv();
  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    if (env.NODE_ENV !== 'production') return null;
    return errorResponse(
      503,
      'WEBHOOK_SECRET_NOT_CONFIGURED',
      'Resend webhook secret is not configured',
    );
  }

  const auth = req.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
  const headerSecret = req.headers.get('x-agentdomain-webhook-secret');
  const provided = bearer ?? headerSecret;
  if (!provided || !safeEqual(provided, secret)) {
    return errorResponse(401, 'UNAUTHORIZED_WEBHOOK', 'Invalid webhook secret');
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function getPayloadData(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const record = body as Record<string, unknown>;
  const data = record.data;
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  return record;
}

function readString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function collectRecipients(data: Record<string, unknown>): string[] {
  const candidates: unknown[] = [data.to, data.recipient, data.recipients, data.deliveredTo];
  const envelope = data.envelope;
  if (envelope && typeof envelope === 'object') {
    candidates.push((envelope as Record<string, unknown>).to);
  }

  const out = new Set<string>();
  for (const value of candidates) {
    for (const email of collectEmailValues(value)) out.add(email);
  }
  return [...out];
}

function collectEmailValues(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => normalizeEmailAddress(part))
      .filter((email): email is string => Boolean(email));
  }
  if (Array.isArray(value)) return value.flatMap(collectEmailValues);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return collectEmailValues(record.email ?? record.address ?? record.value);
  }
  return [];
}
