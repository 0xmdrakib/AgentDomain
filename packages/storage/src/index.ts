import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  type BatchWriteCommandInput,
  type QueryCommandInput,
  type ScanCommandInput,
} from '@aws-sdk/lib-dynamodb';

export interface DynamoStorageConfig {
  region: string;
  tableName: string;
  gsi1Name: string;
  endpoint?: string;
}

export interface TableKey {
  PK: string;
  SK: string;
}

export interface EntityItem extends TableKey {
  entity: string;
  GSI1PK?: string;
  GSI1SK?: string;
  ttl?: number;
  [key: string]: unknown;
}

let cachedClient: DynamoDBDocumentClient | null = null;
let cachedConfigKey = '';

export function createDocumentClient(config: DynamoStorageConfig): DynamoDBDocumentClient {
  const key = JSON.stringify({
    region: config.region,
    endpoint: config.endpoint ?? '',
  });
  if (cachedClient && cachedConfigKey === key) return cachedClient;
  const client = new DynamoDBClient({
    region: config.region,
    endpoint: config.endpoint || undefined,
  });
  cachedClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertEmptyValues: false,
    },
  });
  cachedConfigKey = key;
  return cachedClient;
}

export async function queryAll<T extends Record<string, unknown>>(
  client: DynamoDBDocumentClient,
  input: Omit<QueryCommandInput, 'ExclusiveStartKey'>,
): Promise<T[]> {
  const out: T[] = [];
  let ExclusiveStartKey: QueryCommandInput['ExclusiveStartKey'] | undefined;
  do {
    const res = await client.send(new QueryCommand({ ...input, ExclusiveStartKey }));
    out.push(...((res.Items ?? []) as T[]));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

export async function scanAll<T extends Record<string, unknown>>(
  client: DynamoDBDocumentClient,
  input: Omit<ScanCommandInput, 'ExclusiveStartKey'>,
): Promise<T[]> {
  const out: T[] = [];
  let ExclusiveStartKey: ScanCommandInput['ExclusiveStartKey'] | undefined;
  do {
    const res = await client.send(new ScanCommand({ ...input, ExclusiveStartKey }));
    out.push(...((res.Items ?? []) as T[]));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

export async function batchWriteAll(
  client: DynamoDBDocumentClient,
  tableName: string,
  requests: NonNullable<BatchWriteCommandInput['RequestItems']>[string],
): Promise<void> {
  for (let i = 0; i < requests.length; i += 25) {
    let chunk = requests.slice(i, i + 25);
    do {
      const res = await client.send(
        new BatchWriteCommand({
          RequestItems: { [tableName]: chunk },
        }),
      );
      chunk = res.UnprocessedItems?.[tableName] ?? [];
      if (chunk.length > 0) await sleep(250);
    } while (chunk.length > 0);
  }
}

export function cleanItem<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}

export function isoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
