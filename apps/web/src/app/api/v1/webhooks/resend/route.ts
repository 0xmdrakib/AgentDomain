import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { getDb } from '@/db';
import { emailInboxes, emailMessages, emailBlocklist } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    const payloadString = await req.text();
    const headerPayload = await req.headers;
    const svix_id = headerPayload.get('svix-id');
    const svix_timestamp = headerPayload.get('svix-timestamp');
    const svix_signature = headerPayload.get('svix-signature');

    if (!svix_id || !svix_timestamp || !svix_signature) {
      return new NextResponse('Error occured -- no svix headers', {
        status: 400,
      });
    }

    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      logger.error('RESEND_WEBHOOK_SECRET is not set');
      return new NextResponse('Internal Server Error', { status: 500 });
    }

    const wh = new Webhook(secret);
    let evt: any;

    try {
      evt = wh.verify(payloadString, {
        'svix-id': svix_id,
        'svix-timestamp': svix_timestamp,
        'svix-signature': svix_signature,
      });
    } catch (err: any) {
      logger.warn('Webhook verification failed', { err: err.message });
      return new NextResponse('Error occured', {
        status: 400,
      });
    }

    const eventType = evt.type;

    const db = getDb();

    if (eventType === 'email.received') {
      const { id, from, to, subject, text, html } = evt.data;

      // Resend 'to' can be an array
      const toAddress = Array.isArray(to) ? to[0] : to;

      // Find the inbox
      const inboxRow = await db
        .select()
        .from(emailInboxes)
        .where(eq(emailInboxes.emailAddress, toAddress))
        .limit(1);
      const inbox = inboxRow[0];

      if (!inbox) {
        logger.warn('Received email for unknown inbox', { toAddress });
        return new NextResponse('Inbox not found', { status: 200 }); // Return 200 so Resend doesn't retry
      }

      // Check blocklist
      const blockedRow = await db
        .select()
        .from(emailBlocklist)
        .where(and(eq(emailBlocklist.inboxId, inbox.id), eq(emailBlocklist.value, from)))
        .limit(1);
      const isBlocked = blockedRow[0];

      if (isBlocked) {
        logger.info('Blocked incoming email', { from, to: toAddress });
        return new NextResponse('Blocked', { status: 200 });
      }

      // Insert message
      await db.insert(emailMessages).values({
        inboxId: inbox.id,
        direction: 'inbound',
        resendMessageId: id,
        fromAddress: from,
        toAddress: toAddress,
        subject: subject ?? '',
        text: text ?? '',
        html: html ?? '',
        rawPayload: evt,
      });

      logger.info('Successfully stored inbound email', { messageId: id, to: toAddress });
    }

    return new NextResponse('OK', { status: 200 });
  } catch (error) {
    logger.error('Error processing Resend webhook', { error });
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
