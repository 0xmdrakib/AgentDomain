import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { batchWriteAll, createDocumentClient, type EntityItem } from '@agentdomain/storage';
import {
  agentLookupItems,
  agentToItem,
  apiKeyToItem,
  discountCodeToItem,
  dnsRecordToItem,
  emailBlocklistToItem,
  emailInboxToItem,
  emailMessageToItem,
  lookupItem,
  registrationToItem,
  renewalToItem,
  sslHostnameToItem,
  userToItem,
} from '../src/db/dynamo/mapper';
import {
  apiKeyLookup,
  apiKeyPrefixLookup,
  discountCodeLookup,
  emailLookup,
  providerMessageLookup,
  registrationIdempotencyLookup,
  userWalletLookup,
} from '../src/db/dynamo/keys';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, '..');

loadEnv({ path: resolve(webRoot, '.env.local'), override: true });

type Row = Record<string, unknown>;

async function main() {
  const sourceUrl = process.env.MIGRATION_DATABASE_URL;
  if (!sourceUrl) {
    throw new Error('MIGRATION_DATABASE_URL is required for Neon/Postgres backfill');
  }

  const region = process.env.AWS_REGION ?? 'us-east-1';
  const tableName = process.env.DYNAMODB_TABLE_NAME ?? 'agentdomain-prod';
  const gsi1Name = process.env.DYNAMODB_GSI1_NAME ?? 'GSI1';
  const endpoint = process.env.DYNAMODB_ENDPOINT || undefined;
  const retentionDays = Number(process.env.MAIL_RETENTION_DAYS ?? 180);
  const dryRun = process.argv.includes('--dry-run');

  const sql = postgres(sourceUrl, { max: 1, idle_timeout: 5 });
  const dynamo = createDocumentClient({ region, tableName, gsi1Name, endpoint });
  const items: EntityItem[] = [];
  const counts: Record<string, number> = {};

  try {
    const agents = await queryTable(sql, 'agents');
    for (const row of agents) {
      const item = agentToItem({
        id: str(row.id),
        walletAddress: str(row.wallet_address),
        ownerAddress: str(row.owner_address) || str(row.wallet_address),
        agentIdNft: num(row.agent_id_nft),
        domain: str(row.domain).toLowerCase(),
        basename: nullableString(row.basename),
        ensName: nullableString(row.ens_name),
        status: enumString(row.status, 'pending') as never,
        metadataUri: nullableString(row.metadata_uri),
        metadataJson: json(row.metadata_json),
        sslStatus: enumString(row.ssl_status, 'pending') as never,
        dnsTarget: nullableString(row.dns_target),
        framework: nullableString(row.framework),
        createdAt: date(row.created_at),
        updatedAt: date(row.updated_at),
        expiresAt: dateOrNull(row.expires_at),
      });
      items.push(item, ...agentLookupItems(item));
      bump(counts, 'agents');
    }

    const registrations = await queryTable(sql, 'registrations');
    for (const row of registrations) {
      const item = registrationToItem({
        id: str(row.id),
        agentId: nullableString(row.agent_id),
        idempotencyKey: str(row.idempotency_key),
        txHash: nullableString(row.tx_hash),
        payerAddress: str(row.payer_address),
        paymentAmount: str(row.payment_amount),
        domainCost: str(row.domain_cost),
        basenameCost: str(row.basename_cost) || '0',
        ensCost: str(row.ens_cost) || '0',
        serviceFee: str(row.service_fee),
        status: enumString(row.status, 'pending') as never,
        registrarOrderId: nullableString(row.registrar_order_id),
        errorMessage: nullableString(row.error_message),
        requestParams: json(row.request_params),
        createdAt: date(row.created_at),
        completedAt: dateOrNull(row.completed_at),
      });
      items.push(item, lookupItem(registrationIdempotencyLookup(item.idempotencyKey), item.PK, item.SK, item.id));
      bump(counts, 'registrations');
    }

    const dnsRecords = await queryTable(sql, 'dns_records');
    for (const row of dnsRecords) {
      items.push(dnsRecordToItem(str(row.agent_id), {
        id: str(row.id),
        agentId: str(row.agent_id),
        type: enumString(row.type, 'TXT') as never,
        name: str(row.name),
        value: str(row.value),
        ttl: num(row.ttl, 3600),
        priority: nullableNumber(row.priority),
        providerRecordId: nullableString(row.provider_record_id),
        provider: str(row.provider) || 'spaceship',
        systemManaged: bool(row.system_managed),
        purpose: nullableString(row.purpose),
        createdAt: date(row.created_at),
        updatedAt: date(row.updated_at),
      }));
      bump(counts, 'dns_records');
    }

    const sslHostnames = await queryTable(sql, 'ssl_hostnames');
    for (const row of sslHostnames) {
      items.push(sslHostnameToItem(str(row.agent_id), {
        id: str(row.id),
        agentId: str(row.agent_id),
        hostname: str(row.hostname),
        cloudflareCustomHostnameId: str(row.cloudflare_custom_hostname_id),
        hostnameStatus: str(row.hostname_status) || 'pending',
        sslStatus: str(row.ssl_status) || 'pending',
        validationRecords: jsonArray(row.validation_records),
        validationErrors: jsonArray(row.validation_errors),
        createdAt: date(row.created_at),
        updatedAt: date(row.updated_at),
        lastError: nullableString(row.last_error),
      }));
      bump(counts, 'ssl_hostnames');
    }

    const inboxes = await queryTable(sql, 'email_inboxes');
    const inboxAgentById = new Map<string, string>();
    for (const row of inboxes) {
      const agentId = str(row.agent_id);
      const item = emailInboxToItem(agentId, {
        id: str(row.id),
        agentId,
        emailAddress: str(row.email_address).toLowerCase(),
        sesIdentityArn: nullableString(row.ses_identity_arn),
        sesVerificationStatus: str(row.ses_verification_status) || 'pending',
        sesMailFromDomain: nullableString(row.ses_mail_from_domain),
        dkimConfigured: bool(row.dkim_configured),
        spfConfigured: bool(row.spf_configured),
        dmarcConfigured: bool(row.dmarc_configured),
        createdAt: date(row.created_at),
      });
      inboxAgentById.set(item.id, agentId);
      items.push(item, lookupItem(emailLookup(item.emailAddress), item.PK, item.SK, agentId));
      bump(counts, 'email_inboxes');
    }

    const messages = await queryTable(sql, 'email_messages');
    for (const row of messages) {
      const inboxId = str(row.inbox_id);
      const agentId = inboxAgentById.get(inboxId);
      if (!agentId) continue;
      const item = emailMessageToItem(agentId, {
        id: str(row.id),
        inboxId,
        direction: str(row.direction) || 'inbound',
        providerMessageId: nullableString(row.provider_message_id),
        fromAddress: str(row.from_address),
        toAddress: nullableString(row.to_address),
        subject: nullableString(row.subject),
        text: nullableString(row.text),
        verificationCodes: jsonStringArray(row.verification_codes),
        spamVerdict: nullableString(row.spam_verdict),
        virusVerdict: nullableString(row.virus_verdict),
        receivedAt: date(row.received_at),
        read: bool(row.read),
      }, retentionDays);
      items.push(item);
      if (item.providerMessageId) {
        items.push(lookupItem(providerMessageLookup(item.providerMessageId), item.PK, item.SK, item.id));
      }
      bump(counts, 'email_messages');
    }

    const blocklist = await queryTable(sql, 'email_blocklist');
    for (const row of blocklist) {
      const inboxId = str(row.inbox_id);
      const agentId = inboxAgentById.get(inboxId);
      if (!agentId) continue;
      items.push(emailBlocklistToItem(agentId, {
        id: str(row.id),
        inboxId,
        value: str(row.value),
        reason: nullableString(row.reason),
        createdAt: date(row.created_at),
      }));
      bump(counts, 'email_blocklist');
    }

    const renewals = await queryTable(sql, 'renewals');
    for (const row of renewals) {
      items.push(renewalToItem({
        id: str(row.id),
        agentId: str(row.agent_id),
        scheduledFor: date(row.scheduled_for),
        amount: str(row.amount),
        status: enumString(row.status, 'scheduled') as never,
        txHash: nullableString(row.tx_hash),
        attemptCount: num(row.attempt_count),
        lastError: nullableString(row.last_error),
        createdAt: date(row.created_at),
        completedAt: dateOrNull(row.completed_at),
      }));
      bump(counts, 'renewals');
    }

    const discounts = await queryTable(sql, 'discount_codes');
    for (const row of discounts) {
      const item = discountCodeToItem({
        id: str(row.id),
        code: str(row.code),
        usageLimit: num(row.usage_limit, 1),
        usedCount: num(row.used_count),
        discountPercent: num(row.discount_percent, 90),
        appliesTo: str(row.applies_to) || 'service_fee',
        isActive: bool(row.is_active),
        createdBy: str(row.created_by),
        createdAt: date(row.created_at),
        expiresAt: dateOrNull(row.expires_at),
      });
      items.push(item, lookupItem(discountCodeLookup(item.code), item.PK, item.SK, item.id));
      bump(counts, 'discount_codes');
    }

    const users = await queryTable(sql, 'users');
    for (const row of users) {
      const item = userToItem({
        id: str(row.id),
        walletAddress: str(row.wallet_address).toLowerCase(),
        email: nullableString(row.email),
        createdAt: date(row.created_at),
      });
      items.push(item, lookupItem(userWalletLookup(item.walletAddress), item.PK, item.SK, item.id));
      bump(counts, 'users');
    }

    const apiKeys = await queryTable(sql, 'api_keys');
    for (const row of apiKeys) {
      const item = apiKeyToItem({
        id: str(row.id),
        userId: str(row.user_id),
        keyHash: str(row.key_hash),
        keyPrefix: str(row.key_prefix),
        name: str(row.name),
        lastUsedAt: dateOrNull(row.last_used_at),
        revokedAt: dateOrNull(row.revoked_at),
        createdAt: date(row.created_at),
      });
      items.push(
        item,
        lookupItem(apiKeyLookup(item.keyHash), item.PK, item.SK, item.id),
        lookupItem(apiKeyPrefixLookup(item.keyPrefix), item.PK, item.SK, item.id),
      );
      bump(counts, 'api_keys');
    }

    const unique = dedupeItems(items);
    console.log(JSON.stringify({ sourceCounts: counts, dynamoItems: unique.length, dryRun }, null, 2));

    if (!dryRun) {
      await batchWriteAll(
        dynamo,
        tableName,
        unique.map((item) => ({ PutRequest: { Item: item } })),
      );
      console.log(`Backfilled ${unique.length} DynamoDB items into ${tableName}`);
    }
  } finally {
    await sql.end();
  }
}

async function queryTable(sql: postgres.Sql, table: string): Promise<Row[]> {
  try {
    return (await sql.unsafe(`select * from ${table}`)) as Row[];
  } catch (e) {
    if (String(e).includes('does not exist')) return [];
    throw e;
  }
}

function dedupeItems(items: EntityItem[]) {
  const map = new Map<string, EntityItem>();
  for (const item of items) map.set(`${item.PK}\u0000${item.SK}`, item);
  return [...map.values()];
}

function bump(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function str(value: unknown): string {
  return value == null ? '' : String(value);
}

function nullableString(value: unknown): string | null {
  const out = str(value);
  return out ? out : null;
}

function num(value: unknown, fallback = 0): number {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function date(value: unknown): Date {
  return dateOrNull(value) ?? new Date();
}

function dateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const out = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(out.getTime()) ? null : out;
}

function json(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function jsonArray(value: unknown): Record<string, unknown>[] | null {
  if (!value) return null;
  const parsed = Array.isArray(value) ? value : safeParse(value);
  return Array.isArray(parsed) ? (parsed.filter((v) => v && typeof v === 'object') as Record<string, unknown>[]) : null;
}

function jsonStringArray(value: unknown): string[] | null {
  if (!value) return null;
  const parsed = Array.isArray(value) ? value : safeParse(value);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null;
}

function safeParse(value: unknown): unknown {
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function enumString(value: unknown, fallback: string): string {
  return str(value) || fallback;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
