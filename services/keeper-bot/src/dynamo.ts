import {
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { createDocumentClient, queryAll } from '@agentdomain/storage';

export interface KeeperAgent {
  id: string;
  agentIdNft: number;
  domain: string;
  basename: string | null;
  ensName: string | null;
  status: string;
  expiresAt: Date | null;
}

interface AgentItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  entity: string;
  id: string;
  agentIdNft: number;
  domain: string;
  basename?: string | null;
  ensName?: string | null;
  status: string;
  expiresAt?: string | null;
}

export interface RenewalWrite {
  id: string;
  agentId: string;
  scheduledFor: Date;
  amount: string;
  status: 'completed' | 'failed';
  txHash?: string | null;
  lastError?: string | null;
  completedAt?: Date | null;
}

export class KeeperDynamoRepo {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly gsiName: string;

  constructor(opts: { region: string; tableName: string; gsiName: string; endpoint?: string }) {
    this.client = createDocumentClient({
      region: opts.region,
      tableName: opts.tableName,
      gsi1Name: opts.gsiName,
      endpoint: opts.endpoint,
    });
    this.tableName = opts.tableName;
    this.gsiName = opts.gsiName;
  }

  async ping(): Promise<void> {
    await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': '__health__' },
        Limit: 1,
      }),
    );
  }

  async listExpiringBefore(cutoff: Date, limit: number): Promise<KeeperAgent[]> {
    const rows = await queryAll<AgentItem>(this.client, {
      TableName: this.tableName,
      IndexName: this.gsiName,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': 'ENTITY#AGENT' },
    });
    return rows
      .map(itemToAgent)
      .filter((agent) => agent.status === 'active' && agent.expiresAt && agent.expiresAt < cutoff)
      .sort((a, b) => (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0))
      .slice(0, limit);
  }

  async createRenewal(value: RenewalWrite): Promise<void> {
    const scheduledFor = value.scheduledFor.toISOString();
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `AGENT#${value.agentId}`,
          SK: `RENEWAL#${scheduledFor}#${value.id}`,
          entity: 'RENEWAL',
          GSI1PK: 'ENTITY#RENEWAL',
          GSI1SK: `SCHEDULED#${scheduledFor}#${value.id}`,
          id: value.id,
          agentId: value.agentId,
          scheduledFor,
          amount: value.amount,
          status: value.status,
          txHash: value.txHash ?? null,
          attemptCount: 1,
          lastError: value.lastError ?? null,
          createdAt: new Date().toISOString(),
          completedAt: value.completedAt?.toISOString() ?? null,
        },
      }),
    );
  }

  async updateAgentExpiry(agentId: string, expiresAt: Date): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `AGENT#${agentId}`, SK: 'PROFILE' },
        UpdateExpression: 'SET expiresAt = :expiresAt, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':expiresAt': expiresAt.toISOString(),
          ':updatedAt': new Date().toISOString(),
        },
      }),
    );
  }
}

function itemToAgent(item: AgentItem): KeeperAgent {
  return {
    id: item.id,
    agentIdNft: item.agentIdNft,
    domain: item.domain,
    basename: item.basename ?? null,
    ensName: item.ensName ?? null,
    status: item.status,
    expiresAt: toDate(item.expiresAt),
  };
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}
