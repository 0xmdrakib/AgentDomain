import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { dnsRecords, type Agent, type DnsRecordRow, type NewDnsRecord } from '@/db/schema';
import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { getSpaceship, type SpaceshipDnsRecordInput } from './spaceship';

const log = logger.child({ service: 'dns' });

export type ManagedDnsRecord = Omit<NewDnsRecord, 'id' | 'agentId' | 'createdAt' | 'updatedAt'>;

export function isProtectedDnsRecord(record: Pick<DnsRecordRow, 'systemManaged'>): boolean {
  return record.systemManaged;
}

export function buildBaselineDnsRecords(opts: {
  domain: string;
  emailRecords?: ManagedDnsRecord[];
  cloudflareValidationRecords?: ManagedDnsRecord[];
}): ManagedDnsRecord[] {
  const env = getServerEnv();
  if (!env.CLOUDFLARE_SAAS_FALLBACK_HOSTNAME) {
    throw new Error('CLOUDFLARE_SAAS_FALLBACK_HOSTNAME is required for apex DNS');
  }

  const records: ManagedDnsRecord[] = [
    {
      type: 'ALIAS',
      name: '@',
      value: env.CLOUDFLARE_SAAS_FALLBACK_HOSTNAME,
      ttl: 3600,
      provider: 'spaceship',
      systemManaged: true,
      purpose: 'apex_saas_origin',
    },
    ...(opts.cloudflareValidationRecords ?? []).map<ManagedDnsRecord>((record) => ({
      ...record,
      provider: 'spaceship',
      systemManaged: true,
      purpose: record.purpose ?? 'cloudflare_saas_validation',
    })),
    ...(opts.emailRecords ?? []),
  ];
  return records.map<ManagedDnsRecord>((record) => ({
    ...record,
    name: normalizeRecordName(record.name, opts.domain),
  }));
}

export class SpaceshipDnsService {
  async ensureBasicDns(domain: string): Promise<void> {
    await getSpaceship().useBasicNameservers(domain);
  }

  async syncAgentRecords(agentId: string, domain: string): Promise<DnsRecordRow[]> {
    const db = getDb();
    const records = await db.select().from(dnsRecords).where(eq(dnsRecords.agentId, agentId));
    await this.pushRecords(domain, records);
    return records;
  }

  async replaceAgentRecords(
    agent: Pick<Agent, 'id' | 'domain'>,
    records: ManagedDnsRecord[],
  ): Promise<DnsRecordRow[]> {
    const db = getDb();
    await db.delete(dnsRecords).where(eq(dnsRecords.agentId, agent.id));
    if (records.length > 0) {
      await db.insert(dnsRecords).values(records.map((record) => ({ ...record, agentId: agent.id })));
    }
    return this.syncAgentRecords(agent.id, agent.domain);
  }

  async pushRecords(domain: string, records: DnsRecordRow[]): Promise<void> {
    const desired = records.map(toSpaceshipInput);
    await getSpaceship().replaceDnsRecords(domain, desired);
    log.info('spaceship dns synced', { domain, recordCount: desired.length });
  }
}

function toSpaceshipInput(record: DnsRecordRow): SpaceshipDnsRecordInput {
  return {
    type: record.type,
    name: normalizeRecordName(record.name, ''),
    value: record.value,
    ttl: record.ttl,
    priority: record.priority,
  };
}

export function normalizeRecordName(name: string, domain: string): string {
  const trimmed = name.trim().replace(/\.$/, '');
  if (!trimmed || trimmed === '@') return '@';
  if (domain && trimmed.toLowerCase().endsWith(`.${domain.toLowerCase()}`)) {
    return trimmed.slice(0, -(domain.length + 1)) || '@';
  }
  return trimmed;
}

let _instance: SpaceshipDnsService | null = null;
export function getSpaceshipDns(): SpaceshipDnsService {
  if (!_instance) _instance = new SpaceshipDnsService();
  return _instance;
}
