import { retry } from '@agentdomain/shared';

const CF_API = 'https://api.cloudflare.com/client/v4';

export interface CfZone {
  id: string;
  name: string;
  status: 'active' | 'pending' | 'initializing' | 'moved' | 'deleted';
}

export interface CfDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
}

export class CloudflareDnsClient {
  constructor(private readonly token: string) {}

  async getZoneByName(domain: string): Promise<CfZone | null> {
    const res = await fetch(`${CF_API}/zones?name=${encodeURIComponent(domain)}`, {
      headers: this.headers(),
    });
    const body = (await res.json()) as CfApiResponse<CfZone[]>;
    if (!body.success) throw new Error(`Cloudflare getZone failed: ${formatErrors(body.errors)}`);
    return body.result[0] ?? null;
  }

  async listDnsRecords(
    zoneId: string,
    filters: { type?: string; name?: string } = {},
  ): Promise<CfDnsRecord[]> {
    const params = new URLSearchParams({ per_page: '100' });
    if (filters.type) params.set('type', filters.type);
    if (filters.name) params.set('name', filters.name);

    const res = await fetch(`${CF_API}/zones/${zoneId}/dns_records?${params.toString()}`, {
      headers: this.headers(),
    });
    const body = (await res.json()) as CfApiResponse<CfDnsRecord[]>;
    if (!body.success) {
      throw new Error(`Cloudflare listDnsRecords failed: ${formatErrors(body.errors)}`);
    }
    return body.result;
  }

  async createDnsRecord(zoneId: string, record: Omit<CfDnsRecord, 'id'>): Promise<CfDnsRecord> {
    return retry(async () => {
      const res = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(record),
      });
      const body = (await res.json()) as CfApiResponse<CfDnsRecord>;
      if (!body.success) {
        throw new Error(`Cloudflare createDnsRecord failed: ${formatErrors(body.errors)}`);
      }
      return body.result;
    });
  }

  async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
    const res = await fetch(`${CF_API}/zones/${zoneId}/dns_records/${recordId}`, {
      method: 'DELETE',
      headers: this.headers(),
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

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }
}

interface CfApiResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
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

function formatErrors(errors: { code: number; message: string }[]): string {
  return errors.map((error) => `${error.code}: ${error.message}`).join('; ');
}
