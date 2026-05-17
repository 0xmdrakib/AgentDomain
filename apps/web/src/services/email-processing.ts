import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { emailRepo } from '@/db';
import { getServerEnv } from '@/lib/env';
import {
  findInboxByRecipient,
  isSenderBlocked,
  normalizeEmailAddress,
} from '@/lib/email-inbox';
import { logger } from '@/lib/logger';

const log = logger.child({ service: 'email-processing' });

export interface SesInboundPayload {
  mail?: {
    messageId?: string;
    source?: string;
    destination?: string[];
    commonHeaders?: { subject?: string; from?: string[]; to?: string[] };
  };
  receipt?: {
    spamVerdict?: { status?: string };
    virusVerdict?: { status?: string };
    action?: { type?: string; bucketName?: string; objectKey?: string };
  };
}

export async function processSesInbound(payload: SesInboundPayload): Promise<{ stored: boolean; reason?: string }> {
  const mail = payload.mail;
  const receipt = payload.receipt;
  const messageId = mail?.messageId;
  const from = normalizeEmailAddress(mail?.source ?? mail?.commonHeaders?.from?.[0]);
  const recipient = collectRecipient(mail?.destination, mail?.commonHeaders?.to);
  if (!messageId || !from || !recipient) return { stored: false, reason: 'missing_addresses' };

  const spamVerdict = receipt?.spamVerdict?.status ?? 'UNKNOWN';
  const virusVerdict = receipt?.virusVerdict?.status ?? 'UNKNOWN';
  if (spamVerdict === 'FAIL' || virusVerdict === 'FAIL') {
    await deleteRawMessage(receipt).catch((err) =>
      log.warn('failed to delete rejected transient raw email', { err: String(err), messageId }),
    );
    return { stored: false, reason: 'failed_ses_verdict' };
  }

  const inboxRow = await findInboxByRecipient(recipient);
  if (!inboxRow?.inbox) return { stored: false, reason: 'unknown_recipient' };
  if (await isSenderBlocked(inboxRow.inbox.id, from)) return { stored: false, reason: 'blocked_sender' };

  const raw = await readRawMessage(receipt);
  const text = extractTextFromRawEmail(raw);
  if (!text) {
    await deleteRawMessage(receipt).catch((err) =>
      log.warn('failed to delete transient raw email with no text content', {
        err: String(err),
        messageId,
      }),
    );
    return { stored: false, reason: 'no_text_content' };
  }
  const subject = mail?.commonHeaders?.subject ?? extractHeader(raw, 'subject') ?? '';
  const verificationCodes = extractVerificationCodes(`${subject}\n${text}`);

  await emailRepo.insertMessage(inboxRow.agent.id, {
    inboxId: inboxRow.inbox.id,
    direction: 'inbound',
    providerMessageId: messageId,
    fromAddress: from,
    toAddress: recipient,
    subject,
    text,
    verificationCodes,
    spamVerdict,
    virusVerdict,
    read: false,
  });

  await deleteRawMessage(receipt).catch((err) =>
    log.warn('failed to delete transient raw email', { err: String(err), messageId }),
  );

  return { stored: true };
}

function collectRecipient(destinations?: string[], headers?: string[]): string | null {
  for (const value of [...(destinations ?? []), ...(headers ?? [])]) {
    const normalized = normalizeEmailAddress(value);
    if (normalized) return normalized;
  }
  return null;
}

async function readRawMessage(receipt?: SesInboundPayload['receipt']): Promise<string> {
  const action = receipt?.action;
  if (!action?.bucketName || !action.objectKey) return '';
  const env = getServerEnv();
  const client = new S3Client({ region: env.AWS_REGION });
  const result = await client.send(
    new GetObjectCommand({ Bucket: action.bucketName, Key: action.objectKey }),
  );
  return result.Body ? await result.Body.transformToString() : '';
}

async function deleteRawMessage(receipt?: SesInboundPayload['receipt']): Promise<void> {
  const action = receipt?.action;
  if (!action?.bucketName || !action.objectKey) return;
  const env = getServerEnv();
  const client = new S3Client({ region: env.AWS_REGION });
  await client.send(new DeleteObjectCommand({ Bucket: action.bucketName, Key: action.objectKey }));
}

export function extractVerificationCodes(input: string): string[] {
  const candidates = new Set<string>();
  const patterns = [
    /\b(?:code|otp|verification|verify|pin)\D{0,24}([A-Z0-9]{4,10})\b/gi,
    /\b([0-9]{4,8})\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of input.matchAll(pattern)) {
      const code = match[1]?.trim();
      if (code) candidates.add(code);
    }
  }
  return [...candidates].slice(0, 10);
}

function extractHeader(raw: string, name: string): string | null {
  const pattern = new RegExp(`^${name}:\\s*(.+)$`, 'im');
  return raw.match(pattern)?.[1]?.trim() ?? null;
}

export function extractTextFromRawEmail(raw: string): string {
  if (!raw) return '';
  const plainPart = raw.match(/Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?:\r?\n--|$)/i);
  const body = plainPart?.[1] ?? raw.split(/\r?\n\r?\n/).slice(1).join('\n\n') ?? raw;
  return decodeQuotedPrintable(stripHtml(body)).trim().slice(0, 200_000);
}

function stripHtml(value: string): string {
  return value.replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function decodeQuotedPrintable(value: string): string {
  return value
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}
