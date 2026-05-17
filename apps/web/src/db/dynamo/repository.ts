import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { batchWriteAll, queryAll, scanAll } from '@agentdomain/storage';
import { getServerEnv } from '@/lib/env';
import { getDynamoClient, getDynamoConfig } from './client';
import {
  apiKeyLookup,
  apiKeyPrefixLookup,
  discountCodeLookup,
  domainLookup,
  emailLookup,
  entities,
  gsiEntity,
  gsiWallet,
  pkAgent,
  pkApiKey,
  pkDiscount,
  pkLookup,
  pkRegistration,
  pkUser,
  providerMessageLookup,
  registrationIdempotencyLookup,
  skAgent,
  skDnsRecord,
  skEmailBlocklist,
  skEmailInbox,
  skEmailMessage,
  skLookup,
  skRenewal,
  skSslHostname,
  userWalletLookup,
} from './keys';
import {
  agentLookupItems,
  agentToItem,
  apiKeyToItem,
  discountCodeToItem,
  dnsRecordToItem,
  emailBlocklistToItem,
  emailInboxToItem,
  emailMessageToItem,
  itemToAgent,
  itemToApiKey,
  itemToDiscountCode,
  itemToDnsRecord,
  itemToEmailBlocklist,
  itemToEmailInbox,
  itemToEmailMessage,
  itemToRegistration,
  itemToRenewal,
  itemToSslHostname,
  itemToUser,
  lookupItem,
  registrationToItem,
  renewalToItem,
  sslHostnameToItem,
  userToItem,
  type AgentItem,
  type ApiKeyItem,
  type DiscountCodeItem,
  type DnsRecordItem,
  type EmailBlocklistItem,
  type EmailInboxItem,
  type EmailMessageItem,
  type LookupItem,
  type RegistrationItem,
  type RenewalItem,
  type SslHostnameItem,
  type UserItem,
} from './mapper';
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
  PlatformStats,
  Registration,
  Renewal,
  RepositoryList,
  SslHostnameRow,
  User,
} from './types';

function table() {
  return getDynamoConfig().tableName;
}

function gsi1() {
  return getDynamoConfig().gsi1Name;
}

function client() {
  return getDynamoClient();
}

function normalizeAddress(value: string) {
  return value.toLowerCase();
}

function hasText(value: unknown, q: string) {
  return typeof value === 'string' && value.toLowerCase().includes(q);
}

async function getLookup(key: string): Promise<LookupItem | null> {
  const res = await client().send(
    new GetCommand({ TableName: table(), Key: { PK: pkLookup(key), SK: skLookup() } }),
  );
  return (res.Item as LookupItem | undefined) ?? null;
}

async function getItemByLookup<T extends Record<string, unknown>>(key: string): Promise<T | null> {
  const lookup = await getLookup(key);
  if (!lookup) return null;
  const res = await client().send(
    new GetCommand({ TableName: table(), Key: { PK: lookup.targetPk, SK: lookup.targetSk } }),
  );
  return (res.Item as T | undefined) ?? null;
}

async function putLookup(key: string, targetPk: string, targetSk: string, targetId?: string) {
  await client().send(
    new PutCommand({
      TableName: table(),
      Item: lookupItem(key, targetPk, targetSk, targetId),
    }),
  );
}

async function deleteLookup(key: string) {
  await client().send(
    new DeleteCommand({ TableName: table(), Key: { PK: pkLookup(key), SK: skLookup() } }),
  );
}

async function getAllEntityItems<T extends Record<string, unknown>>(entity: string): Promise<T[]> {
  return queryAll<T>(client(), {
    TableName: table(),
    IndexName: gsi1(),
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `ENTITY#${entity}` },
  });
}

function sortDesc<T>(items: T[], getDate: (item: T) => Date | null): T[] {
  return [...items].sort((a, b) => (getDate(b)?.getTime() ?? 0) - (getDate(a)?.getTime() ?? 0));
}

function paginate<T>(items: T[], limit: number, offset: number): RepositoryList<T> {
  const page = items.slice(offset, offset + limit);
  return { items: page, total: items.length, hasMore: offset + page.length < items.length };
}

export const agentsRepo = {
  async getById(id: string): Promise<Agent | null> {
    const res = await client().send(
      new GetCommand({ TableName: table(), Key: { PK: pkAgent(id), SK: skAgent() } }),
    );
    return res.Item ? itemToAgent(res.Item as AgentItem) : null;
  },

  async getByDomainOrId(value: string): Promise<Agent | null> {
    const byId = await this.getById(value);
    if (byId) return byId;
    return this.getByDomain(value);
  },

  async getByDomain(domain: string): Promise<Agent | null> {
    const item = await getItemByLookup<AgentItem>(domainLookup(domain));
    return item ? itemToAgent(item) : null;
  },

  async getManyByDomains(domains: string[]): Promise<Agent[]> {
    const rows = await Promise.all(domains.map((domain) => this.getByDomain(domain)));
    return rows.filter(Boolean) as Agent[];
  },

  async listByWallet(wallet: string): Promise<Agent[]> {
    const items = await queryAll<LookupItem>(client(), {
      TableName: table(),
      IndexName: gsi1(),
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': gsiWallet(wallet, '').GSI1PK },
      ScanIndexForward: false,
    });
    const rows = await Promise.all(items.map((item) => agentsRepo.getById(item.targetId ?? '')));
    return rows.filter(Boolean) as Agent[];
  },

  async list(opts: {
    status?: Agent['status'];
    q?: string;
    framework?: string;
    capability?: string;
    limit: number;
    offset: number;
    publicOnly?: boolean;
  }): Promise<RepositoryList<Agent>> {
    const source = await getAllEntityItems<AgentItem>(entities.agent);
    const q = opts.q?.trim().toLowerCase();
    const agents = source.map(itemToAgent).filter((agent) => {
      if (opts.status && agent.status !== opts.status) return false;
      if (opts.publicOnly && agent.status !== 'active') return false;
      if (opts.framework && agent.framework !== opts.framework) return false;
      if (opts.capability) {
        const capabilities = agent.metadataJson?.capabilities;
        if (!Array.isArray(capabilities) || !capabilities.includes(opts.capability)) return false;
      }
      if (!q) return true;
      return (
        hasText(agent.domain, q) ||
        hasText(agent.basename, q) ||
        hasText(agent.ensName, q) ||
        hasText(agent.walletAddress, q) ||
        String(agent.agentIdNft).includes(q) ||
        JSON.stringify(agent.metadataJson ?? {}).toLowerCase().includes(q)
      );
    });
    return paginate(sortDesc(agents, (agent) => agent.createdAt), opts.limit, opts.offset);
  },

  async create(value: NewAgent): Promise<Agent> {
    const item = agentToItem(value);
    await client().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: table(),
              Item: item,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          ...agentLookupItems(item).map((lookup) => ({
            Put: {
              TableName: table(),
              Item: lookup,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          })),
        ],
      }),
    );
    return itemToAgent(item);
  },

  async update(id: string, patch: Partial<Agent>): Promise<Agent | null> {
    const current = await this.getById(id);
    if (!current) return null;
    const next = agentToItem({ ...current, ...patch, id, updatedAt: patch.updatedAt ?? new Date() });
    await client().send(new PutCommand({ TableName: table(), Item: next }));
    return itemToAgent(next);
  },

  async listExpiringBefore(cutoff: Date, limit: number): Promise<Agent[]> {
    const rows = await getAllEntityItems<AgentItem>(entities.agent);
    return rows
      .map(itemToAgent)
      .filter((agent) => agent.status === 'active' && agent.expiresAt && agent.expiresAt < cutoff)
      .sort((a, b) => (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0))
      .slice(0, limit);
  },

  async listStuckSsl(cutoff: Date, limit: number): Promise<Agent[]> {
    const rows = await getAllEntityItems<AgentItem>(entities.agent);
    return rows
      .map(itemToAgent)
      .filter((agent) => agent.sslStatus === 'provisioning' && agent.updatedAt < cutoff)
      .slice(0, limit);
  },

  async stats() {
    const agents = (await getAllEntityItems<AgentItem>(entities.agent)).map(itemToAgent);
    return {
      total: agents.length,
      active: agents.filter((agent) => agent.status === 'active').length,
      expired: agents.filter((agent) => agent.status === 'expired').length,
      revoked: agents.filter((agent) => agent.status === 'revoked').length,
    };
  },

  async maxTokenId(): Promise<number> {
    const agents = (await getAllEntityItems<AgentItem>(entities.agent)).map(itemToAgent);
    return agents.reduce((max, agent) => Math.max(max, agent.agentIdNft || 0), 0);
  },

  async listMissingDns(limit: number): Promise<Agent[]> {
    const agents = (await getAllEntityItems<AgentItem>(entities.agent)).map(itemToAgent);
    const out: Agent[] = [];
    for (const agent of agents) {
      if (agent.status !== 'active') continue;
      const records = await dnsRepo.list(agent.id);
      if (records.length === 0) out.push(agent);
      if (out.length >= limit) break;
    }
    return out;
  },

  async listMissingBasename(limit: number): Promise<Agent[]> {
    const agents = (await getAllEntityItems<AgentItem>(entities.agent)).map(itemToAgent);
    return agents.filter((agent) => agent.status === 'active' && !agent.basename).slice(0, limit);
  },
};

export const registrationsRepo = {
  async upsertPending(value: NewRegistration): Promise<Registration> {
    const existing = await getItemByLookup<RegistrationItem>(
      registrationIdempotencyLookup(value.idempotencyKey),
    );
    if (existing) {
      await this.update(existing.id, { status: 'pending' });
      return { ...itemToRegistration(existing), status: 'pending' };
    }
    const item = registrationToItem(value);
    await client().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: table(),
              Item: item,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: table(),
              Item: lookupItem(registrationIdempotencyLookup(item.idempotencyKey), item.PK, item.SK, item.id),
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      }),
    );
    return itemToRegistration(item);
  },

  async getById(id: string): Promise<Registration | null> {
    const res = await client().send(
      new GetCommand({ TableName: table(), Key: { PK: pkRegistration(id), SK: 'PROFILE' } }),
    );
    return res.Item ? itemToRegistration(res.Item as RegistrationItem) : null;
  },

  async getByAgentId(agentId: string): Promise<Registration | null> {
    const rows = await getAllEntityItems<RegistrationItem>(entities.registration);
    const item = rows.find((row) => row.agentId === agentId);
    return item ? itemToRegistration(item) : null;
  },

  async update(id: string, patch: Partial<Registration>): Promise<Registration | null> {
    const current = await this.getById(id);
    if (!current) return null;
    const item = registrationToItem({ ...current, ...patch, id, createdAt: current.createdAt });
    await client().send(new PutCommand({ TableName: table(), Item: item }));
    return itemToRegistration(item);
  },

  async list(opts: {
    status?: Registration['status'];
    limit: number;
    offset: number;
  }): Promise<RepositoryList<Registration>> {
    const rows = (await getAllEntityItems<RegistrationItem>(entities.registration))
      .map(itemToRegistration)
      .filter((row) => !opts.status || row.status === opts.status);
    return paginate(sortDesc(rows, (row) => row.createdAt), opts.limit, opts.offset);
  },

  async listStalePending(cutoff: Date, limit: number): Promise<Registration[]> {
    const rows = (await getAllEntityItems<RegistrationItem>(entities.registration)).map(itemToRegistration);
    return rows.filter((row) => row.status === 'pending' && row.createdAt < cutoff).slice(0, limit);
  },

  async stats() {
    const rows = (await getAllEntityItems<RegistrationItem>(entities.registration)).map(itemToRegistration);
    const now = Date.now();
    return {
      counts: {
        total: rows.length,
        completed: rows.filter((row) => row.status === 'completed').length,
        failed: rows.filter((row) => row.status === 'failed').length,
        pending: rows.filter((row) => row.status === 'pending').length,
        partial: rows.filter((row) => row.progress?.overall === 'partial').length,
        paymentSettled: rows.filter((row) => Boolean(row.paymentTxHash || row.txHash)).length,
        last24h: rows.filter((row) => now - row.createdAt.getTime() < 24 * 60 * 60 * 1000).length,
        last7d: rows.filter((row) => now - row.createdAt.getTime() < 7 * 24 * 60 * 60 * 1000).length,
      },
      totalRevenueUsdc: rows
        .filter((row) => row.status === 'completed')
        .reduce((sum, row) => sum + Number(row.paymentAmount || 0), 0)
        .toFixed(6)
        .replace(/\.?0+$/, ''),
    };
  },
};

export const dnsRepo = {
  async list(agentId: string): Promise<DnsRecordRow[]> {
    const rows = await queryAll<DnsRecordItem>(client(), {
      TableName: table(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pkAgent(agentId), ':sk': 'DNS#' },
    });
    return rows.map(itemToDnsRecord);
  },

  async get(agentId: string, recordId: string): Promise<DnsRecordRow | null> {
    const res = await client().send(
      new GetCommand({ TableName: table(), Key: { PK: pkAgent(agentId), SK: skDnsRecord(recordId) } }),
    );
    return res.Item ? itemToDnsRecord(res.Item as DnsRecordItem) : null;
  },

  async create(agentId: string, record: NewDnsRecord): Promise<DnsRecordRow> {
    const item = dnsRecordToItem(agentId, record);
    await client().send(new PutCommand({ TableName: table(), Item: item }));
    return itemToDnsRecord(item);
  },

  async replace(agentId: string, records: NewDnsRecord[]): Promise<DnsRecordRow[]> {
    const existing = await this.list(agentId);
    const deletes = existing.map((record) => ({ DeleteRequest: { Key: { PK: pkAgent(agentId), SK: skDnsRecord(record.id) } } }));
    const puts = records.map((record) => ({ PutRequest: { Item: dnsRecordToItem(agentId, record) } }));
    await batchWriteAll(client(), table(), [...deletes, ...puts]);
    return this.list(agentId);
  },

  async update(agentId: string, recordId: string, patch: Partial<DnsRecordRow>): Promise<DnsRecordRow | null> {
    const current = await this.get(agentId, recordId);
    if (!current) return null;
    const item = dnsRecordToItem(agentId, { ...current, ...patch, id: recordId, updatedAt: new Date() });
    await client().send(new PutCommand({ TableName: table(), Item: item }));
    return itemToDnsRecord(item);
  },

  async delete(agentId: string, recordId: string): Promise<boolean> {
    const current = await this.get(agentId, recordId);
    if (!current) return false;
    await client().send(
      new DeleteCommand({ TableName: table(), Key: { PK: pkAgent(agentId), SK: skDnsRecord(recordId) } }),
    );
    return true;
  },
};

export const sslRepo = {
  async getByAgent(agentId: string): Promise<SslHostnameRow | null> {
    const res = await client().send(
      new GetCommand({ TableName: table(), Key: { PK: pkAgent(agentId), SK: skSslHostname() } }),
    );
    return res.Item ? itemToSslHostname(res.Item as SslHostnameItem) : null;
  },

  async getById(id: string): Promise<SslHostnameRow | null> {
    const rows = await getAllEntityItems<SslHostnameItem>(entities.sslHostname);
    const item = rows.find((row) => row.id === id);
    return item ? itemToSslHostname(item) : null;
  },

  async upsert(agentId: string, value: NewSslHostname): Promise<SslHostnameRow> {
    const item = sslHostnameToItem(agentId, value);
    await client().send(new PutCommand({ TableName: table(), Item: item }));
    return itemToSslHostname(item);
  },

  async update(agentId: string, patch: Partial<SslHostnameRow>): Promise<SslHostnameRow | null> {
    const current = await this.getByAgent(agentId);
    if (!current) return null;
    const item = sslHostnameToItem(agentId, { ...current, ...patch, updatedAt: new Date() });
    await client().send(new PutCommand({ TableName: table(), Item: item }));
    return itemToSslHostname(item);
  },

  async delete(agentId: string): Promise<void> {
    await client().send(new DeleteCommand({ TableName: table(), Key: { PK: pkAgent(agentId), SK: skSslHostname() } }));
  },
};

async function listEmailMessageItems(agentId: string): Promise<EmailMessageItem[]> {
  return queryAll<EmailMessageItem>(client(), {
    TableName: table(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': pkAgent(agentId), ':sk': 'EMAIL#MESSAGE#' },
    ScanIndexForward: false,
  });
}

export const emailRepo = {
  async getInboxByAgent(agentId: string): Promise<EmailInboxRow | null> {
    const res = await client().send(
      new GetCommand({ TableName: table(), Key: { PK: pkAgent(agentId), SK: skEmailInbox() } }),
    );
    return res.Item ? itemToEmailInbox(res.Item as EmailInboxItem) : null;
  },

  async getInboxByEmail(email: string): Promise<{ agent: Agent; inbox: EmailInboxRow } | null> {
    const lookup = await getLookup(emailLookup(email));
    if (!lookup?.targetId) return null;
    const [agent, inbox] = await Promise.all([agentsRepo.getById(lookup.targetId), this.getInboxByAgent(lookup.targetId)]);
    return agent && inbox ? { agent, inbox } : null;
  },

  async getInboxById(inboxId: string): Promise<{ agent: Agent; inbox: EmailInboxRow } | null> {
    const rows = await scanAll<EmailInboxItem>(client(), {
      TableName: table(),
      FilterExpression: '#entity = :entity AND id = :id',
      ExpressionAttributeNames: { '#entity': 'entity' },
      ExpressionAttributeValues: { ':entity': entities.emailInbox, ':id': inboxId },
      Limit: 1,
    });
    const item = rows[0];
    if (!item) return null;
    const agent = await agentsRepo.getById(item.agentId);
    return agent ? { agent, inbox: itemToEmailInbox(item) } : null;
  },

  async deleteInboxById(inboxId: string): Promise<void> {
    const row = await this.getInboxById(inboxId);
    if (!row) return;
    await this.deleteInbox(row.agent.id);
  },

  async upsertInbox(agentId: string, value: NewEmailInbox): Promise<EmailInboxRow> {
    const item = emailInboxToItem(agentId, value);
    await client().send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: table(), Item: item } },
          {
            Put: {
              TableName: table(),
              Item: lookupItem(emailLookup(item.emailAddress), item.PK, item.SK, agentId),
              ConditionExpression: 'attribute_not_exists(PK) OR targetId = :agentId',
              ExpressionAttributeValues: { ':agentId': agentId },
            },
          },
        ],
      }),
    );
    return itemToEmailInbox(item);
  },

  async deleteInbox(agentId: string): Promise<void> {
    const inbox = await this.getInboxByAgent(agentId);
    const messages = await listEmailMessageItems(agentId);
    const blocklist = await this.listBlocklist(agentId);
    const deletes = [
      ...(inbox ? [{ DeleteRequest: { Key: { PK: pkAgent(agentId), SK: skEmailInbox() } } }] : []),
      ...messages.map((message) => ({
        DeleteRequest: { Key: { PK: message.PK, SK: message.SK } },
      })),
      ...blocklist.map((entry) => ({
        DeleteRequest: { Key: { PK: pkAgent(agentId), SK: skEmailBlocklist(entry.id) } },
      })),
    ];
    if (deletes.length) await batchWriteAll(client(), table(), deletes);
    if (inbox) await deleteLookup(emailLookup(inbox.emailAddress));
  },

  async insertMessage(agentId: string, value: NewEmailMessage): Promise<EmailMessageRow | null> {
    if (value.providerMessageId) {
      const existing = await getLookup(providerMessageLookup(value.providerMessageId));
      if (existing) return null;
    }
    const env = getServerEnv();
    const item = emailMessageToItem(agentId, value, env.MAIL_RETENTION_DAYS);
    const transactItems: NonNullable<TransactWriteCommandInput['TransactItems']> = [
      {
        Put: {
          TableName: table(),
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
    ];
    if (item.providerMessageId) {
      transactItems.push({
        Put: {
          TableName: table(),
          Item: lookupItem(providerMessageLookup(item.providerMessageId), item.PK, item.SK, item.id),
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      });
    }
    try {
      await client().send(new TransactWriteCommand({ TransactItems: transactItems }));
    } catch (e) {
      if (String(e).includes('ConditionalCheckFailed')) return null;
      throw e;
    }
    return itemToEmailMessage(item);
  },

  async listMessages(
    agentId: string,
    opts: { limit: number; offset?: number; unreadOnly?: boolean; direction?: string },
  ): Promise<RepositoryList<EmailMessageRow>> {
    const rows = await listEmailMessageItems(agentId);
    const messages = rows.map(itemToEmailMessage).filter((message) => {
      if (opts.unreadOnly && message.read) return false;
      if (opts.direction && message.direction !== opts.direction) return false;
      return true;
    });
    return paginate(messages, opts.limit, opts.offset ?? 0);
  },

  async updateMessageRead(agentId: string, messageId: string, read: boolean): Promise<EmailMessageRow | null> {
    const messages = await listEmailMessageItems(agentId);
    const current = messages.find((message) => message.id === messageId);
    if (!current) return null;
    await client().send(
      new UpdateCommand({
        TableName: table(),
        Key: { PK: current.PK, SK: current.SK },
        UpdateExpression: 'SET #read = :read',
        ExpressionAttributeNames: { '#read': 'read' },
        ExpressionAttributeValues: { ':read': read },
      }),
    );
    return itemToEmailMessage({ ...current, read });
  },

  async listBlocklist(agentId: string): Promise<EmailBlocklistRow[]> {
    const rows = await queryAll<EmailBlocklistItem>(client(), {
      TableName: table(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pkAgent(agentId), ':sk': 'EMAIL#BLOCK#' },
    });
    return rows.map(itemToEmailBlocklist);
  },

  async isSenderBlocked(agentId: string, inboxId: string, keys: string[]): Promise<boolean> {
    const rows = await this.listBlocklist(agentId);
    return rows.some((row) => row.inboxId === inboxId && keys.includes(row.value));
  },

  async addBlocklist(agentId: string, value: { inboxId: string; value: string; reason?: string | null }): Promise<EmailBlocklistRow> {
    const existing = (await this.listBlocklist(agentId)).find(
      (row) => row.inboxId === value.inboxId && row.value === value.value,
    );
    if (existing) return existing;
    const item = emailBlocklistToItem(agentId, value);
    await client().send(new PutCommand({ TableName: table(), Item: item }));
    return itemToEmailBlocklist(item);
  },

  async deleteBlocklist(agentId: string, blockId: string): Promise<boolean> {
    const rows = await this.listBlocklist(agentId);
    const current = rows.find((row) => row.id === blockId);
    if (!current) return false;
    await client().send(new DeleteCommand({ TableName: table(), Key: { PK: pkAgent(agentId), SK: skEmailBlocklist(blockId) } }));
    return true;
  },

  async deleteMessagesOlderThan(cutoff: Date): Promise<number> {
    const rows = await getAllEntityItems<EmailMessageItem>(entities.emailMessage);
    const old = rows.filter((message) => (itemToEmailMessage(message).receivedAt < cutoff));
    const deletes = old.map((message) => ({
      DeleteRequest: { Key: { PK: message.PK, SK: message.SK } },
    }));
    if (deletes.length) await batchWriteAll(client(), table(), deletes);
    return old.length;
  },
};

export const renewalsRepo = {
  async create(value: NewRenewal): Promise<Renewal> {
    const item = renewalToItem(value);
    await client().send(new PutCommand({ TableName: table(), Item: item }));
    return itemToRenewal(item);
  },

  async list(opts: { status?: Renewal['status']; limit: number; offset: number }): Promise<RepositoryList<Renewal>> {
    const rows = (await getAllEntityItems<RenewalItem>(entities.renewal))
      .map(itemToRenewal)
      .filter((row) => !opts.status || row.status === opts.status);
    return paginate(sortDesc(rows, (row) => row.scheduledFor), opts.limit, opts.offset);
  },

  async update(agentId: string, id: string, patch: Partial<Renewal>): Promise<Renewal | null> {
    const rows = await queryAll<RenewalItem>(client(), {
      TableName: table(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pkAgent(agentId), ':sk': 'RENEWAL#' },
    });
    const current = rows.find((row) => row.id === id);
    if (!current) return null;
    const item = renewalToItem({
      ...itemToRenewal(current),
      ...patch,
      id,
      agentId,
      createdAt: itemToRenewal(current).createdAt,
    });
    await client().send(new PutCommand({ TableName: table(), Item: item }));
    return itemToRenewal(item);
  },

  async listDue(cutoff: Date, limit: number): Promise<Renewal[]> {
    const rows = (await getAllEntityItems<RenewalItem>(entities.renewal)).map(itemToRenewal);
    return rows
      .filter((row) => row.status === 'scheduled' && row.scheduledFor <= cutoff)
      .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
      .slice(0, limit);
  },

  async stats() {
    const rows = (await getAllEntityItems<RenewalItem>(entities.renewal)).map(itemToRenewal);
    return {
      total: rows.length,
      completed: rows.filter((row) => row.status === 'completed').length,
      failed: rows.filter((row) => row.status === 'failed').length,
    };
  },
};

export const discountsRepo = {
  async getByCode(code: string): Promise<DiscountCode | null> {
    const item = await getItemByLookup<DiscountCodeItem>(discountCodeLookup(code));
    return item ? itemToDiscountCode(item) : null;
  },

  async getById(id: string): Promise<DiscountCode | null> {
    const res = await client().send(
      new GetCommand({ TableName: table(), Key: { PK: pkDiscount(id), SK: 'PROFILE' } }),
    );
    return res.Item ? itemToDiscountCode(res.Item as DiscountCodeItem) : null;
  },

  async create(value: {
    code: string;
    usageLimit: number;
    discountPercent: number;
    createdBy: string;
  }): Promise<DiscountCode> {
    const item = discountCodeToItem(value);
    await client().send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: table(), Item: item, ConditionExpression: 'attribute_not_exists(PK)' } },
          {
            Put: {
              TableName: table(),
              Item: lookupItem(discountCodeLookup(item.code), item.PK, item.SK, item.id),
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      }),
    );
    return itemToDiscountCode(item);
  },

  async getActiveByCode(code: string): Promise<DiscountCode | null> {
    const item = await getItemByLookup<DiscountCodeItem>(discountCodeLookup(code));
    if (!item) return null;
    const codeRow = itemToDiscountCode(item);
    return codeRow.isActive ? codeRow : null;
  },

  async list(opts: { limit: number; offset: number }): Promise<RepositoryList<DiscountCode>> {
    const rows = (await getAllEntityItems<DiscountCodeItem>(entities.discountCode)).map(itemToDiscountCode);
    return paginate(sortDesc(rows, (row) => row.createdAt), opts.limit, opts.offset);
  },

  async update(id: string, patch: Partial<DiscountCode>): Promise<DiscountCode | null> {
    const current = await this.getById(id);
    if (!current) return null;
    const item = discountCodeToItem({ ...current, ...patch, id, createdAt: current.createdAt });
    await client().send(new PutCommand({ TableName: table(), Item: item }));
    return itemToDiscountCode(item);
  },

  async incrementUse(id: string): Promise<void> {
    await client().send(
      new UpdateCommand({
        TableName: table(),
        Key: { PK: pkDiscount(id), SK: 'PROFILE' },
        UpdateExpression: 'ADD usedCount :one',
        ExpressionAttributeValues: { ':one': 1 },
      }),
    );
  },

  async deactivate(id: string): Promise<DiscountCode | null> {
    const current = await this.getById(id);
    if (!current) return null;
    const item = discountCodeToItem({ ...current, isActive: false, id, createdAt: current.createdAt });
    await client().send(new PutCommand({ TableName: table(), Item: item }));
    return itemToDiscountCode(item);
  },
};

export const usersRepo = {
  async findOrCreate(walletAddress: string): Promise<{ id: string }> {
    const wallet = normalizeAddress(walletAddress);
    const existing = await getItemByLookup<UserItem>(userWalletLookup(wallet));
    if (existing) return { id: existing.id };
    const item = userToItem({ walletAddress: wallet });
    await client().send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: table(), Item: item, ConditionExpression: 'attribute_not_exists(PK)' } },
          {
            Put: {
              TableName: table(),
              Item: lookupItem(userWalletLookup(wallet), item.PK, item.SK, item.id),
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      }),
    );
    return { id: item.id };
  },

  async getById(id: string): Promise<User | null> {
    const res = await client().send(new GetCommand({ TableName: table(), Key: { PK: pkUser(id), SK: 'PROFILE' } }));
    return res.Item ? itemToUser(res.Item as UserItem) : null;
  },
};

export const apiKeysRepo = {
  async create(value: { userId: string; keyHash: string; keyPrefix: string; name: string }): Promise<ApiKeyRow> {
    const item = apiKeyToItem(value);
    await client().send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: table(), Item: item, ConditionExpression: 'attribute_not_exists(PK)' } },
          {
            Put: {
              TableName: table(),
              Item: lookupItem(apiKeyPrefixLookup(item.keyPrefix), item.PK, item.SK, item.id),
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: table(),
              Item: lookupItem(apiKeyLookup(item.keyHash), item.PK, item.SK, item.id),
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      }),
    );
    return itemToApiKey(item);
  },

  async listForUser(userId: string): Promise<ApiKeyRow[]> {
    const rows = (await getAllEntityItems<ApiKeyItem>(entities.apiKey)).filter((row) => row.userId === userId);
    return rows.map(itemToApiKey).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  },

  async getByPrefix(prefix: string): Promise<ApiKeyRow | null> {
    const item = await getItemByLookup<ApiKeyItem>(apiKeyPrefixLookup(prefix));
    return item ? itemToApiKey(item) : null;
  },

  async updateLastUsed(id: string): Promise<void> {
    await client().send(
      new UpdateCommand({
        TableName: table(),
        Key: { PK: pkApiKey(id), SK: 'PROFILE' },
        UpdateExpression: 'SET lastUsedAt = :now',
        ExpressionAttributeValues: { ':now': new Date().toISOString() },
      }),
    );
  },

  async revoke(id: string, userId: string): Promise<boolean> {
    const res = await client().send(new GetCommand({ TableName: table(), Key: { PK: pkApiKey(id), SK: 'PROFILE' } }));
    const item = res.Item as ApiKeyItem | undefined;
    if (!item || item.userId !== userId) return false;
    await client().send(
      new UpdateCommand({
        TableName: table(),
        Key: { PK: pkApiKey(id), SK: 'PROFILE' },
        UpdateExpression: 'SET revokedAt = :now',
        ExpressionAttributeValues: { ':now': new Date().toISOString() },
      }),
    );
    return true;
  },
};

export const platformRepo = {
  async stats(): Promise<PlatformStats> {
    const [agentCounts, reg, renewalCounts] = await Promise.all([
      agentsRepo.stats(),
      registrationsRepo.stats(),
      renewalsRepo.stats(),
    ]);
    return {
      agents: agentCounts,
      registrations: reg.counts,
      renewals: renewalCounts,
      revenue: { totalUsdc: reg.totalRevenueUsdc },
    };
  },

  async ping(): Promise<void> {
    await client().send(new QueryCommand({
      TableName: table(),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': '__health__' },
      Limit: 1,
    }));
  },

  async countsByEntity(): Promise<Record<string, number>> {
    const rows = await scanAll<{ entity?: string }>(client(), {
      TableName: table(),
      ProjectionExpression: 'entity',
    });
    return rows.reduce<Record<string, number>>((acc, row) => {
      if (row.entity) acc[row.entity] = (acc[row.entity] ?? 0) + 1;
      return acc;
    }, {});
  },
};
