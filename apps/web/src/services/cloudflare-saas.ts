import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import type { ManagedDnsRecord } from './dns';

const CF_API = 'https://api.cloudflare.com/client/v4';
const log = logger.child({ service: 'cloudflare-saas' });

export interface CloudflareCustomHostname {
  id: string;
  hostname: string;
  status: string;
  sslStatus: string;
  validationRecords: Record<string, unknown>[];
  dnsValidationRecords: ManagedDnsRecord[];
  validationErrors: Record<string, unknown>[];
}

export class CloudflareSaasService {
  private readonly token: string;
  private readonly zoneId: string;

  constructor() {
    const env = getServerEnv();
    if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_SAAS_ZONE_ID) {
      throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_SAAS_ZONE_ID are required');
    }
    this.token = env.CLOUDFLARE_API_TOKEN;
    this.zoneId = env.CLOUDFLARE_SAAS_ZONE_ID;
  }

  async createApexHostname(hostname: string): Promise<CloudflareCustomHostname> {
    if (hostname.toLowerCase().startsWith('www.')) {
      throw new Error('Cloudflare for SaaS hostnames must be apex-only');
    }
    const res = await fetch(`${CF_API}/zones/${this.zoneId}/custom_hostnames`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        hostname,
        ssl: {
          method: 'txt',
          type: 'dv',
          settings: { min_tls_version: '1.2' },
        },
      }),
    });
    const body = (await res.json()) as CfResponse<CfCustomHostnameRaw>;
    if (!body.success) {
      throw new Error(`Cloudflare custom hostname create failed: ${JSON.stringify(body.errors)}`);
    }
    log.info('cloudflare saas hostname created', { hostname, id: body.result.id });
    return normalize(body.result);
  }

  async getHostname(id: string): Promise<CloudflareCustomHostname> {
    const res = await fetch(`${CF_API}/zones/${this.zoneId}/custom_hostnames/${id}`, {
      headers: this.headers(),
      cache: 'no-store',
    });
    const body = (await res.json()) as CfResponse<CfCustomHostnameRaw>;
    if (!body.success) {
      throw new Error(`Cloudflare custom hostname read failed: ${JSON.stringify(body.errors)}`);
    }
    return normalize(body.result);
  }

  async deleteHostname(id: string): Promise<void> {
    const res = await fetch(`${CF_API}/zones/${this.zoneId}/custom_hostnames/${id}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`Cloudflare custom hostname delete failed: ${res.status} ${await res.text()}`);
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }
}

interface CfResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}

interface CfCustomHostnameRaw {
  id: string;
  hostname: string;
  status?: string;
  ssl?: {
    status?: string;
    validation_records?: Record<string, unknown>[];
    validation_errors?: Record<string, unknown>[];
  };
}

function normalize(raw: CfCustomHostnameRaw): CloudflareCustomHostname {
  return {
    id: raw.id,
    hostname: raw.hostname,
    status: raw.status ?? 'pending',
    sslStatus: raw.ssl?.status ?? 'pending',
    validationRecords: raw.ssl?.validation_records ?? [],
    dnsValidationRecords: normalizeValidationRecords(raw.ssl?.validation_records ?? []),
    validationErrors: raw.ssl?.validation_errors ?? [],
  };
}

function normalizeValidationRecords(records: Record<string, unknown>[]): ManagedDnsRecord[] {
  const normalized: ManagedDnsRecord[] = [];
  for (const record of records) {
      const rawName = record.txt_name ?? record.name ?? record.hostname;
      const rawValue = record.txt_value ?? record.value ?? record.target;
      if (typeof rawName !== 'string' || typeof rawValue !== 'string') continue;
      normalized.push({
        type: 'TXT' as const,
        name: rawName,
        value: rawValue,
        ttl: 3600,
        provider: 'spaceship',
        systemManaged: true,
        purpose: 'cloudflare_saas_validation',
      });
  }
  return normalized;
}

let _instance: CloudflareSaasService | null = null;
export function getCloudflareSaas(): CloudflareSaasService {
  if (!_instance) _instance = new CloudflareSaasService();
  return _instance;
}
