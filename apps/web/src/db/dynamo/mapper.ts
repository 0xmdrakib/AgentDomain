import { randomUUID } from 'node:crypto';
import { cleanItem, isoDate, nowIso, toDate, type EntityItem } from '@agentdomain/storage';
import {
  domainLookup,
  emailLookup,
  entities,
  gsiEntity,
  gsiStatus,
  gsiWallet,
  pkAgent,
  pkApiKey,
  pkDiscount,
  pkLookup,
  pkRegistration,
  pkUser,
  skAgent,
  skDnsRecord,
  skEmailBlocklist,
  skEmailInbox,
  skEmailMessage,
  skLookup,
  skRenewal,
  skSslHostname,
} from './keys';
import type {
  Agent,
  ApiKeyRow,
  DiscountCode,
  DnsRecordRow,
  EmailBlocklistRow,
  EmailInboxRow,
  EmailMessageRow,
  NewAgent,
  NewDnsRecord,
  NewEmailInbox,
  NewEmailMessage,
  NewRegistration,
  NewRenewal,
  NewSslHostname,
  Registration,
  Renewal,
  SslHostnameRow,
  User,
} from './types';

export type AgentItem = EntityItem & Omit<Agent, 'createdAt' | 'updatedAt' | 'expiresAt'> & {
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null;
};

export type RegistrationItem = EntityItem &
  Omit<Registration, 'createdAt' | 'completedAt'> & {
    createdAt: string;
    completedAt?: string | null;
  };

export type DnsRecordItem = EntityItem &
  Omit<DnsRecordRow, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
  };

export type SslHostnameItem = EntityItem &
  Omit<SslHostnameRow, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
  };

export type EmailInboxItem = EntityItem &
  Omit<EmailInboxRow, 'createdAt'> & {
    createdAt: string;
  };

export type EmailMessageItem = EntityItem &
  Omit<EmailMessageRow, 'receivedAt'> & {
    receivedAt: string;
  };

export type EmailBlocklistItem = EntityItem &
  Omit<EmailBlocklistRow, 'createdAt'> & {
    createdAt: string;
  };

export type RenewalItem = EntityItem &
  Omit<Renewal, 'scheduledFor' | 'createdAt' | 'completedAt'> & {
    scheduledFor: string;
    createdAt: string;
    completedAt?: string | null;
  };

export type DiscountCodeItem = EntityItem &
  Omit<DiscountCode, 'createdAt' | 'expiresAt'> & {
    createdAt: string;
    expiresAt?: string | null;
  };

export type UserItem = EntityItem &
  Omit<User, 'createdAt'> & {
    createdAt: string;
  };

export type ApiKeyItem = EntityItem &
  Omit<ApiKeyRow, 'lastUsedAt' | 'revokedAt' | 'createdAt'> & {
    lastUsedAt?: string | null;
    revokedAt?: string | null;
    createdAt: string;
  };

export interface LookupItem extends EntityItem {
  targetPk: string;
  targetSk: string;
  targetId?: string;
}

export function agentToItem(value: NewAgent): AgentItem {
  const now = nowIso();
  const id = value.id ?? randomUUID();
  const createdAt = isoDate(value.createdAt) ?? now;
  const updatedAt = isoDate(value.updatedAt) ?? now;
  const item: AgentItem = cleanItem({
    PK: pkAgent(id),
    SK: skAgent(),
    entity: entities.agent,
    ...gsiEntity(entities.agent, `CREATED#${createdAt}#${id}`),
    id,
    walletAddress: value.walletAddress,
    ownerAddress: value.ownerAddress,
    agentIdNft: value.agentIdNft,
    domain: value.domain,
    basename: value.basename ?? null,
    ensName: value.ensName ?? null,
    status: value.status ?? 'pending',
    metadataUri: value.metadataUri ?? null,
    metadataJson: value.metadataJson ?? null,
    sslStatus: value.sslStatus ?? 'pending',
    dnsTarget: value.dnsTarget ?? null,
    framework: value.framework ?? null,
    createdAt,
    updatedAt,
    expiresAt: isoDate(value.expiresAt),
  });
  return item;
}

export function itemToAgent(item: AgentItem): Agent {
  return {
    ...item,
    createdAt: toDate(item.createdAt) ?? new Date(0),
    updatedAt: toDate(item.updatedAt) ?? new Date(0),
    expiresAt: toDate(item.expiresAt),
  };
}

export function registrationToItem(value: NewRegistration): RegistrationItem {
  const now = nowIso();
  const id = value.id ?? randomUUID();
  const createdAt = isoDate(value.createdAt) ?? now;
  return cleanItem({
    PK: pkRegistration(id),
    SK: 'PROFILE',
    entity: entities.registration,
    ...gsiEntity(entities.registration, `CREATED#${createdAt}#${id}`),
    id,
    agentId: value.agentId ?? null,
    idempotencyKey: value.idempotencyKey,
    txHash: value.txHash ?? null,
    payerAddress: value.payerAddress,
    paymentAmount: String(value.paymentAmount),
    domainCost: String(value.domainCost),
    basenameCost: String(value.basenameCost ?? '0'),
    ensCost: String(value.ensCost ?? '0'),
    serviceFee: String(value.serviceFee),
    status: value.status ?? 'pending',
    registrarOrderId: value.registrarOrderId ?? null,
    errorMessage: value.errorMessage ?? null,
    requestParams: value.requestParams ?? null,
    createdAt,
    completedAt: isoDate(value.completedAt),
  });
}

export function itemToRegistration(item: RegistrationItem): Registration {
  return {
    ...item,
    createdAt: toDate(item.createdAt) ?? new Date(0),
    completedAt: toDate(item.completedAt),
  };
}

export function dnsRecordToItem(agentId: string, value: NewDnsRecord): DnsRecordItem {
  const now = nowIso();
  const id = value.id ?? randomUUID();
  const createdAt = isoDate(value.createdAt) ?? now;
  const updatedAt = isoDate(value.updatedAt) ?? now;
  return cleanItem({
    PK: pkAgent(agentId),
    SK: skDnsRecord(id),
    entity: entities.dnsRecord,
    id,
    agentId,
    type: value.type,
    name: value.name,
    value: value.value,
    ttl: value.ttl ?? 3600,
    priority: value.priority ?? null,
    providerRecordId: value.providerRecordId ?? null,
    provider: value.provider ?? 'spaceship',
    systemManaged: value.systemManaged ?? false,
    purpose: value.purpose ?? null,
    createdAt,
    updatedAt,
  });
}

export function itemToDnsRecord(item: DnsRecordItem): DnsRecordRow {
  return {
    ...item,
    createdAt: toDate(item.createdAt) ?? new Date(0),
    updatedAt: toDate(item.updatedAt) ?? new Date(0),
  };
}

export function sslHostnameToItem(agentId: string, value: NewSslHostname): SslHostnameItem {
  const now = nowIso();
  const id = value.id ?? randomUUID();
  const createdAt = isoDate(value.createdAt) ?? now;
  const updatedAt = isoDate(value.updatedAt) ?? now;
  return cleanItem({
    PK: pkAgent(agentId),
    SK: skSslHostname(),
    entity: entities.sslHostname,
    id,
    agentId,
    hostname: value.hostname,
    cloudflareCustomHostnameId: value.cloudflareCustomHostnameId,
    hostnameStatus: value.hostnameStatus ?? 'pending',
    sslStatus: value.sslStatus ?? 'pending',
    validationRecords: value.validationRecords ?? null,
    validationErrors: value.validationErrors ?? null,
    createdAt,
    updatedAt,
    lastError: value.lastError ?? null,
  });
}

export function itemToSslHostname(item: SslHostnameItem): SslHostnameRow {
  return {
    ...item,
    createdAt: toDate(item.createdAt) ?? new Date(0),
    updatedAt: toDate(item.updatedAt) ?? new Date(0),
  };
}

export function emailInboxToItem(agentId: string, value: NewEmailInbox): EmailInboxItem {
  const createdAt = isoDate(value.createdAt) ?? nowIso();
  const id = value.id ?? randomUUID();
  return cleanItem({
    PK: pkAgent(agentId),
    SK: skEmailInbox(),
    entity: entities.emailInbox,
    id,
    agentId,
    emailAddress: value.emailAddress,
    sesIdentityArn: value.sesIdentityArn ?? null,
    sesVerificationStatus: value.sesVerificationStatus ?? 'pending',
    sesMailFromDomain: value.sesMailFromDomain ?? null,
    dkimConfigured: value.dkimConfigured ?? false,
    spfConfigured: value.spfConfigured ?? false,
    dmarcConfigured: value.dmarcConfigured ?? false,
    createdAt,
  });
}

export function itemToEmailInbox(item: EmailInboxItem): EmailInboxRow {
  return {
    ...item,
    createdAt: toDate(item.createdAt) ?? new Date(0),
  };
}

export function emailMessageToItem(
  inboxAgentId: string,
  value: NewEmailMessage,
  retentionDays: number,
): EmailMessageItem {
  const id = value.id ?? randomUUID();
  const receivedAt = isoDate(value.receivedAt) ?? nowIso();
  const receivedMs = Date.parse(receivedAt);
  const ttl =
    Number.isFinite(receivedMs) && retentionDays > 0
      ? Math.floor(receivedMs / 1000) + retentionDays * 24 * 60 * 60
      : undefined;
  return cleanItem({
    PK: pkAgent(inboxAgentId),
    SK: skEmailMessage(receivedAt, id),
    entity: entities.emailMessage,
    ...gsiEntity(entities.emailMessage, `RECEIVED#${receivedAt}#${id}`),
    id,
    inboxId: value.inboxId,
    direction: value.direction ?? 'inbound',
    providerMessageId: value.providerMessageId ?? null,
    fromAddress: value.fromAddress,
    toAddress: value.toAddress ?? null,
    subject: value.subject ?? null,
    text: value.text ?? null,
    verificationCodes: value.verificationCodes ?? null,
    spamVerdict: value.spamVerdict ?? null,
    virusVerdict: value.virusVerdict ?? null,
    receivedAt,
    read: value.read ?? false,
    ttl,
  });
}

export function itemToEmailMessage(item: EmailMessageItem): EmailMessageRow {
  return {
    ...item,
    receivedAt: toDate(item.receivedAt) ?? new Date(0),
  };
}

export function emailBlocklistToItem(
  agentId: string,
  value: { id?: string; inboxId: string; value: string; reason?: string | null; createdAt?: Date | string },
): EmailBlocklistItem {
  const id = value.id ?? randomUUID();
  const createdAt = isoDate(value.createdAt) ?? nowIso();
  return cleanItem({
    PK: pkAgent(agentId),
    SK: skEmailBlocklist(id),
    entity: entities.emailBlocklist,
    id,
    inboxId: value.inboxId,
    value: value.value,
    reason: value.reason ?? null,
    createdAt,
  });
}

export function itemToEmailBlocklist(item: EmailBlocklistItem): EmailBlocklistRow {
  return {
    ...item,
    createdAt: toDate(item.createdAt) ?? new Date(0),
  };
}

export function renewalToItem(value: NewRenewal): RenewalItem {
  const id = value.id ?? randomUUID();
  const scheduledFor = isoDate(value.scheduledFor) ?? nowIso();
  const createdAt = isoDate(value.createdAt) ?? nowIso();
  return cleanItem({
    PK: pkAgent(value.agentId),
    SK: skRenewal(scheduledFor, id),
    entity: entities.renewal,
    ...gsiEntity(entities.renewal, `SCHEDULED#${scheduledFor}#${id}`),
    id,
    agentId: value.agentId,
    scheduledFor,
    amount: String(value.amount),
    status: value.status ?? 'scheduled',
    txHash: value.txHash ?? null,
    attemptCount: value.attemptCount ?? 0,
    lastError: value.lastError ?? null,
    createdAt,
    completedAt: isoDate(value.completedAt),
  });
}

export function itemToRenewal(item: RenewalItem): Renewal {
  return {
    ...item,
    scheduledFor: toDate(item.scheduledFor) ?? new Date(0),
    createdAt: toDate(item.createdAt) ?? new Date(0),
    completedAt: toDate(item.completedAt),
  };
}

export function discountCodeToItem(value: {
  id?: string;
  code: string;
  usageLimit: number;
  usedCount?: number;
  discountPercent: number;
  appliesTo?: string;
  isActive?: boolean;
  createdBy: string;
  createdAt?: Date | string;
  expiresAt?: Date | string | null;
}): DiscountCodeItem {
  const id = value.id ?? randomUUID();
  const createdAt = isoDate(value.createdAt) ?? nowIso();
  return cleanItem({
    PK: pkDiscount(id),
    SK: 'PROFILE',
    entity: entities.discountCode,
    ...gsiEntity(entities.discountCode, `CREATED#${createdAt}#${id}`),
    id,
    code: value.code.toUpperCase(),
    usageLimit: value.usageLimit,
    usedCount: value.usedCount ?? 0,
    discountPercent: value.discountPercent,
    appliesTo: value.appliesTo ?? 'service_fee',
    isActive: value.isActive ?? true,
    createdBy: value.createdBy,
    createdAt,
    expiresAt: isoDate(value.expiresAt),
  });
}

export function itemToDiscountCode(item: DiscountCodeItem): DiscountCode {
  return {
    ...item,
    createdAt: toDate(item.createdAt) ?? new Date(0),
    expiresAt: toDate(item.expiresAt),
  };
}

export function userToItem(value: { id?: string; walletAddress: string; email?: string | null; createdAt?: Date | string }): UserItem {
  const id = value.id ?? randomUUID();
  const createdAt = isoDate(value.createdAt) ?? nowIso();
  return cleanItem({
    PK: pkUser(id),
    SK: 'PROFILE',
    entity: entities.user,
    id,
    walletAddress: value.walletAddress.toLowerCase(),
    email: value.email ?? null,
    createdAt,
  });
}

export function itemToUser(item: UserItem): User {
  return {
    ...item,
    createdAt: toDate(item.createdAt) ?? new Date(0),
  };
}

export function apiKeyToItem(value: {
  id?: string;
  userId: string;
  keyHash: string;
  keyPrefix: string;
  name: string;
  lastUsedAt?: Date | string | null;
  revokedAt?: Date | string | null;
  createdAt?: Date | string;
}): ApiKeyItem {
  const id = value.id ?? randomUUID();
  const createdAt = isoDate(value.createdAt) ?? nowIso();
  return cleanItem({
    PK: pkApiKey(id),
    SK: 'PROFILE',
    entity: entities.apiKey,
    ...gsiEntity(entities.apiKey, `USER#${value.userId}#${createdAt}#${id}`),
    id,
    userId: value.userId,
    keyHash: value.keyHash,
    keyPrefix: value.keyPrefix,
    name: value.name,
    lastUsedAt: isoDate(value.lastUsedAt),
    revokedAt: isoDate(value.revokedAt),
    createdAt,
  });
}

export function itemToApiKey(item: ApiKeyItem): ApiKeyRow {
  return {
    ...item,
    lastUsedAt: toDate(item.lastUsedAt),
    revokedAt: toDate(item.revokedAt),
    createdAt: toDate(item.createdAt) ?? new Date(0),
  };
}

export function lookupItem(key: string, targetPk: string, targetSk: string, targetId?: string): LookupItem {
  return cleanItem({
    PK: pkLookup(key),
    SK: skLookup(),
    entity: entities.lookup,
    targetPk,
    targetSk,
    targetId,
  });
}

export function agentLookupItems(item: AgentItem): LookupItem[] {
  return [
    lookupItem(domainLookup(item.domain), item.PK, item.SK, item.id),
    lookupItem(emailLookup(`agent@${item.domain}`), item.PK, skEmailInbox(), item.id),
    lookupItem(`NFT#${item.agentIdNft}`, item.PK, item.SK, item.id),
    {
      ...lookupItem(`WALLET_AGENT#${item.walletAddress.toLowerCase()}#${item.id}`, item.PK, item.SK, item.id),
      ...gsiWallet(item.walletAddress, `AGENT#${item.createdAt}#${item.id}`),
    },
    {
      ...lookupItem(`OWNER_AGENT#${item.ownerAddress.toLowerCase()}#${item.id}`, item.PK, item.SK, item.id),
      ...gsiWallet(item.ownerAddress, `AGENT#${item.createdAt}#${item.id}`),
    },
  ];
}
