import { retry } from '@agentdomain/shared';
import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Cloudflare DNS automation.
 *
 * For each agent's domain, we either:
 *   1. Add it as a Cloudflare zone (full DNS management), or
 *   2. Use a CNAME pointing into a shared agentdomain.xyz subdomain
 *
 * v1 uses option (1) for premium UX; option (2) is reserved for Lite tier in v2.
 */

const log = logger.child({ service: 'cloudflare' });
const CF_API = 'https://api.cloudflare.com/client/v4';

export interface CfZone {
  id: string;
  name: string;
  status: 'active' | 'pending' | 'initializing' | 'moved' | 'deleted';
  nameServers: string[];
}

export interface CfDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  priority?: number;
  proxied?: boolean;
}

export class CloudflareClient {
  private readonly token: string;
  private readonly accountId: string;

  constructor() {
    const env = getServerEnv();
    if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
      throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
    }
    this.token = env.CLOUDFLARE_API_TOKEN;
    this.accountId = env.CLOUDFLARE_ACCOUNT_ID;
  }

  /**
   * Create a Cloudflare zone for a newly registered domain.
   * Returns the zone object including the nameservers we must set on the registrar.
   */
  async createZone(domain: string): Promise<CfZone> {
    return retry(async () => {
      const res = await fetch(`${CF_API}/zones`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({
          name: domain,
          account: { id: this.accountId },
          type: 'full',
        }),
      });
      const body = (await res.json()) as CfApiResponse<CfZoneRaw>;
      if (!body.success) {
        log.error('create zone failed', { domain, errors: body.errors });
        throw new Error(`Cloudflare createZone failed: ${JSON.stringify(body.errors)}`);
      }
      return this._normalizeZone(body.result);
    });
  }

  async getZoneByName(domain: string): Promise<CfZone | null> {
    const res = await fetch(`${CF_API}/zones?name=${encodeURIComponent(domain)}`, {
      headers: this._headers(),
    });
    const body = (await res.json()) as CfApiResponse<CfZoneRaw[]>;
    if (!body.success) throw new Error(`Cloudflare getZone failed: ${JSON.stringify(body.errors)}`);
    if (!body.result.length) return null;
    return this._normalizeZone(body.result[0]!);
  }

  async deleteZone(zoneId: string): Promise<void> {
    const res = await fetch(`${CF_API}/zones/${zoneId}`, {
      method: 'DELETE',
      headers: this._headers(),
    });
    if (!res.ok) throw new Error(`Cloudflare deleteZone failed: ${res.status}`);
  }

  // -----------------------------------------------------------------
  // DNS RECORDS
  // -----------------------------------------------------------------

  async listDnsRecords(
    zoneId: string,
    filters: { type?: string; name?: string } = {},
  ): Promise<CfDnsRecord[]> {
    const params = new URLSearchParams({ per_page: '100' });
    if (filters.type) params.set('type', filters.type);
    if (filters.name) params.set('name', filters.name);

    const res = await fetch(`${CF_API}/zones/${zoneId}/dns_records?${params.toString()}`, {
      headers: this._headers(),
    });
    const body = (await res.json()) as CfApiResponse<CfDnsRecord[]>;
    if (!body.success) throw new Error(`Cloudflare listDnsRecords failed`);
    return body.result;
  }

  async createDnsRecord(zoneId: string, record: Omit<CfDnsRecord, 'id'>): Promise<CfDnsRecord> {
    return retry(async () => {
      const res = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify(record),
      });
      const body = (await res.json()) as CfApiResponse<CfDnsRecord>;
      if (!body.success) {
        throw new Error(`Cloudflare createDnsRecord failed: ${JSON.stringify(body.errors)}`);
      }
      return body.result;
    });
  }

  async updateDnsRecord(
    zoneId: string,
    recordId: string,
    patch: Partial<CfDnsRecord>,
  ): Promise<CfDnsRecord> {
    const res = await fetch(`${CF_API}/zones/${zoneId}/dns_records/${recordId}`, {
      method: 'PATCH',
      headers: this._headers(),
      body: JSON.stringify(patch),
    });
    const body = (await res.json()) as CfApiResponse<CfDnsRecord>;
    if (!body.success) throw new Error(`Cloudflare updateDnsRecord failed`);
    return body.result;
  }

  async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
    const res = await fetch(`${CF_API}/zones/${zoneId}/dns_records/${recordId}`, {
      method: 'DELETE',
      headers: this._headers(),
    });
    if (!res.ok) throw new Error(`Cloudflare deleteDnsRecord failed: ${res.status}`);
  }

  async upsertTxtRecord(opts: {
    zoneId: string;
    name: string;
    content: string;
    ttl?: number;
  }): Promise<CfDnsRecord> {
    const existing = await this.listDnsRecords(opts.zoneId, { type: 'TXT', name: opts.name });
    const exact = existing.find((record) => sameTxtContent(record.content, opts.content));
    if (exact) return exact;

    return this.createDnsRecord(opts.zoneId, {
      type: 'TXT',
      name: opts.name,
      content: opts.content,
      ttl: opts.ttl ?? 60,
    });
  }

  async deleteTxtRecord(opts: { zoneId: string; name: string; content: string }): Promise<void> {
    const existing = await this.listDnsRecords(opts.zoneId, { type: 'TXT', name: opts.name });
    const matches = existing.filter((record) => sameTxtContent(record.content, opts.content));
    await Promise.all(matches.map((record) => this.deleteDnsRecord(opts.zoneId, record.id)));
  }

  async presentAcmeDnsChallenge(opts: {
    zoneId: string;
    identifier: string;
    keyAuthorization: string;
    ttl?: number;
  }): Promise<CfDnsRecord> {
    return this.upsertTxtRecord({
      zoneId: opts.zoneId,
      name: acmeChallengeRecordName(opts.identifier),
      content: opts.keyAuthorization,
      ttl: opts.ttl ?? 60,
    });
  }

  async cleanupAcmeDnsChallenge(opts: {
    zoneId: string;
    identifier: string;
    keyAuthorization: string;
  }): Promise<void> {
    await this.deleteTxtRecord({
      zoneId: opts.zoneId,
      name: acmeChallengeRecordName(opts.identifier),
      content: opts.keyAuthorization,
    });
  }

  /**
   * Configure baseline DNS for a newly registered agent domain:
   *   - A record for apex pointing to dnsTarget
   *   - CNAME 'www' to apex
   *   - MX records for email (Resend)
   *   - SPF, DKIM, DMARC TXT records
   */
  async configureBaselineDns(opts: {
    zoneId: string;
    domain: string;
    dnsTarget: string;
    emailEnabled: boolean;
    resendDkimRecords?: { name: string; value: string }[];
  }): Promise<CfDnsRecord[]> {
    const created: CfDnsRecord[] = [];

    // Apex A record (we accept hostname or IP).
    if (opts.dnsTarget) {
      // If target looks like an IP, use A; otherwise use CNAME (but apex doesn't allow CNAME -> use Cloudflare's CNAME-flattening).
      const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(opts.dnsTarget);
      created.push(
        await this.createDnsRecord(opts.zoneId, {
          type: isIp ? 'A' : 'CNAME',
          name: opts.domain,
          content: opts.dnsTarget,
          ttl: 3600,
          proxied: true,
        }),
      );
      // www -> apex
      created.push(
        await this.createDnsRecord(opts.zoneId, {
          type: 'CNAME',
          name: `www.${opts.domain}`,
          content: opts.domain,
          ttl: 3600,
          proxied: true,
        }),
      );
    }

    // Email infrastructure
    if (opts.emailEnabled) {
      // Resend MX
      created.push(
        await this.createDnsRecord(opts.zoneId, {
          type: 'MX',
          name: opts.domain,
          content: 'feedback-smtp.us-east-1.amazonses.com',
          ttl: 3600,
          priority: 10,
        }),
      );
      // SPF
      created.push(
        await this.createDnsRecord(opts.zoneId, {
          type: 'TXT',
          name: opts.domain,
          content: '"v=spf1 include:amazonses.com ~all"',
          ttl: 3600,
        }),
      );
      // DMARC
      created.push(
        await this.createDnsRecord(opts.zoneId, {
          type: 'TXT',
          name: `_dmarc.${opts.domain}`,
          content: '"v=DMARC1; p=quarantine; rua=mailto:dmarc@agentdomain.xyz"',
          ttl: 3600,
        }),
      );
      // DKIM (provided by Resend after domain creation)
      for (const dkim of opts.resendDkimRecords ?? []) {
        created.push(
          await this.createDnsRecord(opts.zoneId, {
            type: 'TXT',
            name: dkim.name,
            content: dkim.value,
            ttl: 3600,
          }),
        );
      }
    }

    log.info('baseline DNS configured', { domain: opts.domain, recordCount: created.length });
    return created;
  }

  private _headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  private _normalizeZone(raw: CfZoneRaw): CfZone {
    return {
      id: raw.id,
      name: raw.name,
      status: raw.status,
      nameServers: raw.name_servers ?? [],
    };
  }
}

interface CfApiResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  messages: { code: number; message: string }[];
  result: T;
}

interface CfZoneRaw {
  id: string;
  name: string;
  status: 'active' | 'pending' | 'initializing' | 'moved' | 'deleted';
  name_servers?: string[];
}

function acmeChallengeRecordName(identifier: string): string {
  return `_acme-challenge.${identifier.replace(/^\*\./, '')}`;
}

function sameTxtContent(a: string, b: string): boolean {
  return normalizeTxtContent(a) === normalizeTxtContent(b);
}

function normalizeTxtContent(value: string): string {
  return value.trim().replace(/^"(.*)"$/, '$1');
}

let _instance: CloudflareClient | null = null;
export function getCloudflare(): CloudflareClient {
  if (!_instance) _instance = new CloudflareClient();
  return _instance;
}
