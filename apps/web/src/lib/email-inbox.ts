import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Address } from 'viem';
import { getDb } from '@/db';
import { agents, emailBlocklist, emailInboxes } from '@/db/schema';

export function normalizeEmailAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const bracketMatch = trimmed.match(/<([^>]+)>/);
  const email = (bracketMatch?.[1] ?? trimmed).trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}

export function normalizeBlocklistValue(value: string): string {
  let normalized = value.trim().toLowerCase();
  if (normalized.startsWith('mailto:')) normalized = normalized.slice('mailto:'.length);
  const email = normalizeEmailAddress(normalized);
  if (email) return email;
  if (normalized.startsWith('@')) normalized = normalized.slice(1);
  return normalized;
}

export function senderBlockKeys(fromAddress: string): string[] {
  const normalized = normalizeEmailAddress(fromAddress) ?? fromAddress.toLowerCase();
  const domain = normalized.includes('@') ? normalized.split('@').pop() : undefined;
  return domain ? [normalized, domain] : [normalized];
}

export async function getOwnedEmailInbox(agentId: string, walletAddress: Address) {
  const db = getDb();
  const [row] = await db
    .select({ agent: agents, inbox: emailInboxes })
    .from(agents)
    .leftJoin(emailInboxes, eq(emailInboxes.agentId, agents.id))
    .where(
      and(
        eq(agents.id, agentId),
        sql`lower(${agents.walletAddress}) = ${walletAddress.toLowerCase()}`,
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function findInboxByRecipient(emailAddress: string) {
  const normalized = normalizeEmailAddress(emailAddress);
  if (!normalized) return null;

  const db = getDb();
  const [row] = await db
    .select({ agent: agents, inbox: emailInboxes })
    .from(emailInboxes)
    .innerJoin(agents, eq(agents.id, emailInboxes.agentId))
    .where(sql`lower(${emailInboxes.emailAddress}) = ${normalized}`)
    .limit(1);

  return row ?? null;
}

export async function isSenderBlocked(inboxId: string, fromAddress: string): Promise<boolean> {
  const keys = senderBlockKeys(fromAddress);
  const db = getDb();
  const [blocked] = await db
    .select({ id: emailBlocklist.id })
    .from(emailBlocklist)
    .where(and(eq(emailBlocklist.inboxId, inboxId), inArray(emailBlocklist.value, keys)))
    .limit(1);
  return Boolean(blocked);
}
