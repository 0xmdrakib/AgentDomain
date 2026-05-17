import type { Address } from 'viem';
import { agentsRepo, emailRepo } from '@/db';

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
  const agent = await agentsRepo.getById(agentId);
  if (!agent) return null;
  const wallet = walletAddress.toLowerCase();
  if (agent.ownerAddress.toLowerCase() !== wallet && agent.walletAddress.toLowerCase() !== wallet) {
    return null;
  }
  const inbox = await emailRepo.getInboxByAgent(agentId);
  return { agent, inbox };
}

export async function findInboxByRecipient(emailAddress: string) {
  const normalized = normalizeEmailAddress(emailAddress);
  if (!normalized) return null;

  return emailRepo.getInboxByEmail(normalized);
}

export async function isSenderBlocked(inboxId: string, fromAddress: string): Promise<boolean> {
  const keys = senderBlockKeys(fromAddress);
  const inboxOwner = await findInboxById(inboxId);
  if (!inboxOwner) return false;
  return emailRepo.isSenderBlocked(inboxOwner.agentId, inboxId, keys);
}

async function findInboxById(inboxId: string): Promise<{ agentId: string } | null> {
  const row = await emailRepo.getInboxById(inboxId);
  return row ? { agentId: row.agent.id } : null;
}
