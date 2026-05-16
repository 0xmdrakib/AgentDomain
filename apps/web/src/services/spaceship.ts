import { retry, usesRenewalPriceForFirstYear } from '@agentdomain/shared';
import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { rateLimit } from '@/lib/rate-limit';

/**
 * Spaceship registrar integration.
 *
 * Spaceship (spaceship.com) is our primary ICANN registrar partner.
 * Why Spaceship over alternatives:
 *   - Modern OpenAPI 3.1 REST API with async-operation pattern
 *   - Aggressive wholesale pricing (.com ~$8.99, .ai ~$45, .xyz ~$2)
 *   - Native USDC/crypto top-up support via Coinbase Commerce
 *   - Self-serve API key generation, no sales gatekeeping
 *   - Contact-ID based registration model — perfect for per-customer registrant
 *   - Sister company to Namecheap (same parent), inherits their TLD coverage
 *
 * Docs: https://docs.spaceship.dev
 * API base: https://spaceship.dev/api
 *
 * Auth: X-Api-Key + X-Api-Secret headers
 * Long-running ops (registration) return 202 + spaceship-async-operationid
 *   header. Poll /v1/async-operations/{id} until status === 'success' | 'failed'.
 */

const log = logger.child({ service: 'spaceship' });
const SPACESHIP_API_BASE = 'https://spaceship.dev/api';

export interface DomainAvailabilityResponse {
  domain: string;
  available: boolean;
  premium: boolean;
  /** Price in USD as a decimal string (e.g. "10.99"). */
  priceUsd: string;
  /** Renewal price in USD as a decimal string. */
  renewPriceUsd?: string;
  currency: string;
  /** Registration period in years. */
  period?: number;
  /** ICANN fee in USD. */
  icannFee?: string;
}

export interface SpaceshipContact {
  /** Spaceship-generated contact ID (27-32 alphanumeric chars). */
  id: string;
}

export interface SpaceshipContactInput {
  firstName: string;
  lastName: string;
  organization?: string;
  email: string;
  phone: string; // Format: +X.NNNNNNNNNN
  address1: string;
  address2?: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string; // ISO 3166-1 alpha-2 (e.g. "US")
}

export interface RegisterDomainResponse {
  /** Async operation ID. Use to poll status. */
  operationId: string;
  domain: string;
}

export interface AsyncOperationStatus {
  status: 'pending' | 'success' | 'failed';
  type: string;
  details?: Record<string, unknown>;
  createdAt: string;
  modifiedAt: string;
}

export interface DomainInfo {
  name: string;
  unicodeName: string;
  isPremium: boolean;
  autoRenew: boolean;
  registrationDate: string;
  expirationDate: string;
  lifecycleStatus: string;
  nameservers: { provider: string; hosts?: string[] };
}

export type SpaceshipDnsRecordType = 'A' | 'AAAA' | 'ALIAS' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SRV';

export interface SpaceshipDnsRecordInput {
  type: SpaceshipDnsRecordType;
  name: string;
  value: string;
  ttl?: number;
  priority?: number | null;
}

type SpaceshipDnsWireRecord = Record<string, string | number | null | undefined>;

let cachedTldPrices: Record<string, { register_price: number; renew_price?: number }> | null = null;
let cachedTldPricesTime = 0;

export class SpaceshipClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly apiBase: string;

  constructor() {
    const env = getServerEnv();
    if (!env.SPACESHIP_API_KEY || !env.SPACESHIP_API_SECRET) {
      throw new Error(
        'SPACESHIP_API_KEY and SPACESHIP_API_SECRET are required. ' +
          'Get them at https://www.spaceship.com/application/api-manager/',
      );
    }
    this.apiKey = env.SPACESHIP_API_KEY;
    this.apiSecret = env.SPACESHIP_API_SECRET;
    this.apiBase = (env.SPACESHIP_API_BASE || SPACESHIP_API_BASE).replace(/\/+$/, '');
  }

  private async _getTldPrices() {
    if (cachedTldPrices && Date.now() - cachedTldPricesTime < 1000 * 60 * 60) {
      return cachedTldPrices;
    }
    try {
      const res = await fetch('https://api.tldspy.com/api/v1/client/prices/spaceship');
      if (res.ok) {
        const json = await res.json();
        if (json.results) {
          cachedTldPrices = json.results;
          cachedTldPricesTime = Date.now();
          return cachedTldPrices;
        }
      }
    } catch (e) {
      log.warn('failed to fetch TLD prices from TLDSpy', { err: String(e) });
    }
    return null;
  }

  private async _resolveStandardPricing(domain: string, priceNum: number, isPremium: boolean) {
    if (isPremium) {
      return { priceNum, renewPriceNum: priceNum };
    }

    const tld = domain.split('.').pop()?.toLowerCase() || '';
    const tldPrices = await this._getTldPrices();
    const tldPrice = tldPrices?.[tld];
    if (!tldPrice) {
      return { priceNum, renewPriceNum: priceNum };
    }

    const renewPriceNum = tldPrice.renew_price ?? tldPrice.register_price;
    const firstYearPrice = usesRenewalPriceForFirstYear(tld)
      ? renewPriceNum
      : priceNum > 0
        ? priceNum
        : tldPrice.register_price;

    return {
      priceNum: firstYearPrice,
      renewPriceNum,
    };
  }

  /**
   * Check whether a single domain is available for registration.
   *
   * Tries the new /availability endpoint first (returns price.amount for every domain).
   * Falls back to the legacy /available endpoint if the new one is not deployed yet.
   */
  async checkAvailability(domain: string): Promise<DomainAvailabilityResponse> {
    // --- Try new /availability endpoint first ---
    try {
      const res = await fetch(
        `${this.apiBase}/v1/domains/${encodeURIComponent(domain)}/availability`,
        { headers: this._headers() },
      );
      if (res.ok) {
        const json = (await res.json()) as {
          domain: string;
          isAvailable?: boolean;
          available?: boolean;
          price?: {
            amount: string;
            currency: string;
            period: number;
            icannFee: string;
          };
        };
        return {
          domain: json.domain,
          available: json.isAvailable ?? json.available ?? false,
          premium: false,
          priceUsd: json.price?.amount || '0',
          renewPriceUsd: json.price?.amount || '0', // Assume same for fallback if not provided
          currency: json.price?.currency ?? 'USD',
        };
      }
    } catch (e) {
      log.warn('new /availability endpoint failed, falling back to /available', {
        domain,
        err: String(e),
      });
    }

    // --- Fallback to legacy /available endpoint ---
    return retry(async () => {
      const res = await fetch(
        `${this.apiBase}/v1/domains/${encodeURIComponent(domain)}/available`,
        { headers: this._headers() },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Spaceship availability check failed: ${res.status} ${body}`);
      }
      const json = (await res.json()) as {
        domain: string;
        result: 'available' | 'unavailable' | 'premium' | 'invalid' | 'taken';
        premiumPricing?: { operation: string; price: number; currency: string }[];
        price?: { amount: number; currency: string; period: number; icannFee?: number };
      };

      const isAvailable = json.result === 'available';
      const isPremium = Array.isArray(json.premiumPricing) && json.premiumPricing.length > 0;

      const apiPrice = json.price?.amount ?? 0;
      const premiumRegisterPrice = json.premiumPricing?.find((p) => p.operation === 'register');
      let priceNum = premiumRegisterPrice?.price ?? apiPrice;

      const resolved = await this._resolveStandardPricing(domain, priceNum, isPremium);
      priceNum = resolved.priceNum;
      const renewPriceNum = resolved.renewPriceNum;

      return {
        domain: json.domain,
        available: isAvailable,
        premium: isPremium,
        priceUsd: priceNum > 0 ? priceNum.toFixed(2) : '0',
        renewPriceUsd: renewPriceNum > 0 ? renewPriceNum.toFixed(2) : '0',
        currency: 'USD',
      };
    });
  }

  /**
   * Bulk availability check (up to 20 domains per request).
   *
   * Tries the new /availability endpoint first, falls back to legacy /available.
   */
  async checkBulkAvailability(domains: string[]): Promise<DomainAvailabilityResponse[]> {
    if (domains.length === 0) return [];
    if (domains.length > 20) {
      throw new Error('Spaceship bulk availability supports max 20 domains per call');
    }

    // --- Try new /availability endpoint first ---
    try {
      const res = await fetch(`${this.apiBase}/v1/domains/availability`, {
        method: 'POST',
        headers: { ...this._headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains }),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          domains?: {
            domain: string;
            isAvailable?: boolean;
            available?: boolean;
            price?: {
              amount: string;
              currency: string;
              period: number;
              icannFee: string;
            };
          }[];
        };
        const items = json.domains ?? [];
        return items.map((d) => ({
          domain: d.domain,
          available: d.isAvailable ?? d.available ?? false,
          premium: false,
          priceUsd: d.price?.amount ?? '',
          currency: d.price?.currency ?? 'USD',
          period: d.price?.period,
          icannFee: d.price?.icannFee,
        }));
      }
    } catch (e) {
      log.warn('new bulk /availability endpoint failed, falling back to /available', {
        err: String(e),
      });
    }

    // --- Fallback to legacy /available endpoint ---
    return retry(async () => {
      const res = await fetch(`${this.apiBase}/v1/domains/available`, {
        method: 'POST',
        headers: { ...this._headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains }),
      });
      if (!res.ok) {
        throw new Error(`Spaceship bulk availability failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as {
        domains: {
          domain: string;
          result: string;
          premiumPricing?: { operation: string; price: number; currency: string }[];
          pricing?: { register?: number; renew?: number; transfer?: number };
        }[];
      };

      return Promise.all(
        json.domains.map(async (d) => {
          const registerPrice = d.premiumPricing?.find((p) => p.operation === 'register');
          const standardPrice = d.pricing?.register;

          const isAvailable = d.result === 'available';
          const isPremium = Array.isArray(d.premiumPricing) && d.premiumPricing.length > 0;

          let priceNum = registerPrice ? registerPrice.price : standardPrice ? standardPrice : 0;

          const resolved = await this._resolveStandardPricing(d.domain, priceNum, isPremium);
          priceNum = resolved.priceNum;

          const priceUsd = priceNum > 0 ? priceNum.toFixed(2) : '';
          return {
            domain: d.domain,
            available: isAvailable,
            premium: isPremium,
            priceUsd,
            currency: 'USD' as const,
          };
        }),
      );
    });
  }

  /**
   * Create a contact record. Returns the contact ID for use in domain registration.
   * Contacts can be reused across multiple registrations — typically you'll have
   * one platform-level contact for AgentDomain itself plus per-customer contacts.
   */
  async createContact(input: SpaceshipContactInput): Promise<SpaceshipContact> {
    return retry(async () => {
      const res = await fetch(`${this.apiBase}/v1/contacts`, {
        method: 'PUT',
        headers: { ...this._headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        throw new Error(`Spaceship createContact failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as { contactId: string };
      log.info('contact created', { id: json.contactId });
      return { id: json.contactId };
    });
  }

  /**
   * Register a domain. This is asynchronous — returns an operation ID that
   * must be polled via getAsyncOperation() until status === 'success'.
   *
   * @param domain  Fully-qualified domain name (e.g. "myagent.ai")
   * @param years   Registration duration (1-10)
   * @param contactId The contact ID returned by createContact() — same ID is
   *                  used for registrant/admin/tech/billing in the v1 model.
   */
  async registerDomain(opts: {
    domain: string;
    years: number;
    contactId: string;
    autoRenew?: boolean;
    privacyLevel?: 'public' | 'high';
  }): Promise<RegisterDomainResponse> {
    return retry(
      async () => {
        const res = await fetch(
          `${this.apiBase}/v1/domains/${encodeURIComponent(opts.domain)}`,
          {
            method: 'POST',
            headers: { ...this._headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
              autoRenew: opts.autoRenew ?? true,
              years: opts.years,
              privacyProtection: {
                level: opts.privacyLevel ?? 'high',
                userConsent: true,
              },
              contacts: {
                registrant: opts.contactId,
                admin: opts.contactId,
                tech: opts.contactId,
                billing: opts.contactId,
              },
            }),
          },
        );

        if (res.status !== 202) {
          const body = await res.text();
          log.error('register domain failed', { status: res.status, body, domain: opts.domain });
          throw new Error(`Spaceship register failed: ${res.status} ${body}`);
        }

        const operationId = res.headers.get('spaceship-async-operationid');
        if (!operationId) {
          throw new Error('Spaceship register: missing async operation ID in response');
        }

        log.info('domain registration initiated', { domain: opts.domain, operationId });
        return { operationId, domain: opts.domain };
      },
      { attempts: 2, baseDelayMs: 1000 },
    );
  }

  /**
   * Poll an async operation by ID. Returns once status moves out of 'pending'
   * or until maxWaitSeconds elapses.
   */
  async waitForOperation(
    operationId: string,
    opts: { maxWaitSeconds?: number; pollIntervalMs?: number } = {},
  ): Promise<AsyncOperationStatus> {
    const maxWait = (opts.maxWaitSeconds ?? 120) * 1000;
    const pollMs = opts.pollIntervalMs ?? 3000;
    const started = Date.now();

    while (Date.now() - started < maxWait) {
      const status = await this.getAsyncOperation(operationId);
      if (status.status !== 'pending') return status;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error(`Spaceship operation ${operationId} timed out after ${maxWait}ms`);
  }

  async getAsyncOperation(operationId: string): Promise<AsyncOperationStatus> {
    const res = await fetch(
      `${this.apiBase}/v1/async-operations/${encodeURIComponent(operationId)}`,
      { headers: this._headers() },
    );
    if (!res.ok) {
      throw new Error(`Spaceship getAsyncOperation failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as AsyncOperationStatus;
  }

  /**
   * Renew an existing domain.
   */
  async renewDomain(opts: {
    domain: string;
    years: number;
    currentExpirationDate: string;
  }): Promise<{ operationId: string }> {
    return retry(async () => {
      const res = await fetch(
        `${this.apiBase}/v1/domains/${encodeURIComponent(opts.domain)}/renew`,
        {
          method: 'POST',
          headers: { ...this._headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            years: opts.years,
            currentExpirationDate: opts.currentExpirationDate,
          }),
        },
      );
      if (res.status !== 202) {
        throw new Error(`Spaceship renew failed: ${res.status} ${await res.text()}`);
      }
      const operationId = res.headers.get('spaceship-async-operationid');
      if (!operationId) throw new Error('Spaceship renew: missing operation ID');
      return { operationId };
    });
  }

  /**
   * Update the nameservers for a domain (legacy custom-provider path).
   */
  async setNameservers(domain: string, nameservers: string[]): Promise<void> {
    return retry(async () => {
      const res = await fetch(
        `${this.apiBase}/v1/domains/${encodeURIComponent(domain)}/nameservers`,
        {
          method: 'PUT',
          headers: { ...this._headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'custom',
            hosts: nameservers,
          }),
        },
      );
      if (!res.ok) {
        throw new Error(`Spaceship setNameservers failed: ${res.status} ${await res.text()}`);
      }
    });
  }

  /**
   * Move a domain back onto Spaceship Basic DNS. New registrations use this so
   * DNS remains authoritative in Spaceship, while Cloudflare only handles SaaS
   * custom hostname SSL/proxying.
   */
  async useBasicNameservers(domain: string): Promise<void> {
    return retry(async () => {
      const res = await fetch(
        `${this.apiBase}/v1/domains/${encodeURIComponent(domain)}/nameservers`,
        {
          method: 'PUT',
          headers: { ...this._headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'basic' }),
        },
      );
      if (!res.ok) {
        throw new Error(`Spaceship useBasicNameservers failed: ${res.status} ${await res.text()}`);
      }
    });
  }

  async listDnsRecords(domain: string): Promise<SpaceshipDnsRecordInput[]> {
    const url = new URL(
      `${this.apiBase}/v1/dns/records/${encodeURIComponent(domain)}`,
    );
    url.searchParams.set('take', '500');
    url.searchParams.set('skip', '0');

    const res = await fetch(url, {
      headers: this._headers(),
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`Spaceship listDnsRecords failed: ${res.status} ${await res.text()}`);
    }
    const json = await res.json();
    return extractSpaceshipRecords(json).map(fromSpaceshipDnsRecord).filter(Boolean) as SpaceshipDnsRecordInput[];
  }

  /**
   * Spaceship DNS updates are destructive for records sharing the same
   * host/type. To keep the database authoritative, replace the custom resource
   * record set with the full desired package every time.
   */
  async replaceDnsRecords(
    domain: string,
    records: SpaceshipDnsRecordInput[],
  ): Promise<SpaceshipDnsRecordInput[]> {
    const providerLimit = await rateLimit(`spaceship-dns-provider:${domain}`, 250, 300);
    if (!providerLimit.allowed) {
      throw new Error('Spaceship DNS provider limit guard tripped; retry after the window resets');
    }

    const existing = await this.listDnsRecords(domain);
    if (existing.length > 0) {
      const del = await fetch(`${this.apiBase}/v1/dns/records/${encodeURIComponent(domain)}`, {
        method: 'DELETE',
        headers: { ...this._headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(existing.map((record) => toSpaceshipDnsRecord(record, false))),
      });
      if (!del.ok) {
        throw new Error(`Spaceship deleteDnsRecords failed: ${del.status} ${await del.text()}`);
      }
    }

    if (records.length > 0) {
      const put = await fetch(`${this.apiBase}/v1/dns/records/${encodeURIComponent(domain)}`, {
        method: 'PUT',
        headers: { ...this._headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          force: true,
          items: records.map((record) => toSpaceshipDnsRecord(record, true)),
        }),
      });
      if (!put.ok) {
        throw new Error(`Spaceship replaceDnsRecords failed: ${put.status} ${await put.text()}`);
      }
    }

    return this.listDnsRecords(domain);
  }

  async getDomainInfo(domain: string): Promise<DomainInfo> {
    const res = await fetch(`${this.apiBase}/v1/domains/${encodeURIComponent(domain)}`, {
      headers: this._headers(),
    });
    if (!res.ok) {
      throw new Error(`Spaceship getDomainInfo failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as DomainInfo;
  }

  private _headers(): Record<string, string> {
    return {
      'X-Api-Key': this.apiKey,
      'X-Api-Secret': this.apiSecret,
      Accept: 'application/json',
      'User-Agent': 'AgentDomain/0.1.0',
    };
  }
}

let _instance: SpaceshipClient | null = null;
export function getSpaceship(): SpaceshipClient {
  if (!_instance) _instance = new SpaceshipClient();
  return _instance;
}

function extractSpaceshipRecords(value: unknown): SpaceshipDnsWireRecord[] {
  if (Array.isArray(value)) return value as SpaceshipDnsWireRecord[];
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const candidates = [record.records, record.items, record.data, record.result];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as SpaceshipDnsWireRecord[];
  }
  return [];
}

function fromSpaceshipDnsRecord(record: SpaceshipDnsWireRecord): SpaceshipDnsRecordInput | null {
  const type = String(record.type ?? '').toUpperCase() as SpaceshipDnsRecordType;
  if (!['A', 'AAAA', 'ALIAS', 'CNAME', 'MX', 'TXT', 'NS', 'SRV'].includes(type)) return null;

  const name = normalizeSpaceshipRecordName(String(record.name ?? '@'));

  if (type === 'SRV') {
    const service = typeof record.service === 'string' ? record.service : '';
    const protocol = typeof record.protocol === 'string' ? record.protocol : '';
    const target = typeof record.target === 'string' ? record.target : '';
    const priority = typeof record.priority === 'number' ? record.priority : 10;
    const weight = typeof record.weight === 'number' ? record.weight : 0;
    const port = typeof record.port === 'number' ? record.port : 0;
    if (!service || !protocol || !target || port <= 0) return null;
    return {
      type,
      name: [service, protocol, name === '@' ? '' : name].filter(Boolean).join('.'),
      value: `${priority} ${weight} ${port} ${target}`,
      ttl: typeof record.ttl === 'number' ? record.ttl : 3600,
      priority,
    };
  }

  const value =
    record.address ??
    record.aliasName ??
    record.alias_name ??
    record.cname ??
    record.exchange ??
    record.nameserver ??
    record.value ??
    record.host ??
    record.target;
  if (typeof value !== 'string' || value.length === 0) return null;
  return {
    type,
    name,
    value,
    ttl: typeof record.ttl === 'number' ? record.ttl : 3600,
    priority: typeof record.preference === 'number' ? record.preference : null,
  };
}

function toSpaceshipDnsRecord(
  record: SpaceshipDnsRecordInput,
  includeTtl: boolean,
): SpaceshipDnsWireRecord {
  const base: SpaceshipDnsWireRecord = {
    type: record.type,
    name: normalizeSpaceshipRecordName(record.name),
  };
  if (includeTtl) base.ttl = normalizeSpaceshipTtl(record.ttl);

  switch (record.type) {
    case 'A':
    case 'AAAA':
      return { ...base, address: record.value };
    case 'ALIAS':
      return { ...base, aliasName: record.value };
    case 'CNAME':
      return { ...base, cname: record.value };
    case 'MX':
      return { ...base, exchange: record.value, preference: record.priority ?? 10 };
    case 'NS':
      return { ...base, nameserver: record.value };
    case 'SRV':
      return { ...base, ...parseSrvRecord(record) };
    case 'TXT':
      return { ...base, value: record.value };
  }
}

function normalizeSpaceshipRecordName(name: string): string {
  const trimmed = name.trim().replace(/\.$/, '');
  return trimmed.length > 0 ? trimmed : '@';
}

function normalizeSpaceshipTtl(ttl?: number): number {
  const value = typeof ttl === 'number' && Number.isFinite(ttl) ? Math.trunc(ttl) : 3600;
  return Math.min(3600, Math.max(60, value));
}

function parseSrvRecord(record: SpaceshipDnsRecordInput): SpaceshipDnsWireRecord {
  const nameParts = record.name.split('.').filter(Boolean);
  const [service, protocol, ...ownerParts] = nameParts;
  if (!service?.startsWith('_') || !protocol?.startsWith('_')) {
    throw new Error('SRV record name must be _service._protocol or _service._protocol.host');
  }

  const valueParts = record.value.trim().split(/\s+/);
  if (valueParts.length !== 4) {
    throw new Error('SRV record value must be "priority weight port target"');
  }

  const [priorityRaw, weightRaw, portRaw, target] = valueParts;
  const priority = Number.parseInt(priorityRaw ?? '', 10);
  const weight = Number.parseInt(weightRaw ?? '', 10);
  const port = Number.parseInt(portRaw ?? '', 10);
  if (
    !Number.isInteger(priority) ||
    !Number.isInteger(weight) ||
    !Number.isInteger(port) ||
    port < 1 ||
    !target
  ) {
    throw new Error('SRV record value must contain numeric priority, weight, port, and target');
  }

  return {
    name: ownerParts.join('.') || '@',
    service,
    protocol,
    priority,
    weight,
    port,
    target,
  };
}

/**
 * Get the platform default contact ID for domain registrations.
 *
 * If SPACESHIP_DEFAULT_CONTACT_ID is set in env, use that directly.
 * Otherwise, create a new contact from env vars and cache the result
 * in memory for the lifetime of the process.
 *
 * The first call will create the contact on Spaceship and print the ID
 * to the logs — copy it to SPACESHIP_DEFAULT_CONTACT_ID in .env.local
 * to avoid recreating it on every server restart.
 */
let _cachedContactId: string | null = null;

export async function getOrCreatePlatformContact(): Promise<string> {
  // 1. Use cached ID from env
  const envId = process.env.SPACESHIP_DEFAULT_CONTACT_ID;
  if (envId) return envId;

  // 2. Use cached ID from this process
  if (_cachedContactId) return _cachedContactId;

  // 3. Create from env contact info
  const env = {
    firstName: process.env.SPACESHIP_CONTACT_FIRST_NAME,
    lastName: process.env.SPACESHIP_CONTACT_LAST_NAME,
    email: process.env.SPACESHIP_CONTACT_EMAIL,
    phone: process.env.SPACESHIP_CONTACT_PHONE,
    address: process.env.SPACESHIP_CONTACT_ADDRESS,
    city: process.env.SPACESHIP_CONTACT_CITY,
    state: process.env.SPACESHIP_CONTACT_STATE,
    postalCode: process.env.SPACESHIP_CONTACT_POSTAL_CODE,
    country: process.env.SPACESHIP_CONTACT_COUNTRY ?? 'US',
    organization: process.env.SPACESHIP_CONTACT_ORGANIZATION,
  };

  const missing = Object.entries(env)
    .filter(([k, v]) => !v && k !== 'organization')
    .map(([k]) => `SPACESHIP_CONTACT_${k.toUpperCase()}`);

  if (missing.length > 0) {
    throw new Error(
      `Cannot create Spaceship platform contact. Missing env vars:\n${missing.join('\n')}\n\n` +
        'Add these to .env.local with your real contact details (name, email, address).\n' +
        'All domains registered through AgentDomain will use this contact info.',
    );
  }

  const ss = getSpaceship();
  const contact = await ss.createContact({
    firstName: env.firstName!,
    lastName: env.lastName!,
    organization: env.organization,
    email: env.email!,
    phone: env.phone!,
    address1: env.address!,
    city: env.city!,
    stateProvince: env.state!,
    postalCode: env.postalCode!,
    country: env.country,
  });

  _cachedContactId = contact.id;

  // Print for the operator to save permanently
  console.log('\n' + '='.repeat(60));
  console.log('✓ Spaceship contact created!');
  console.log('Add this to your .env.local to avoid recreating:');
  console.log(`SPACESHIP_DEFAULT_CONTACT_ID=${contact.id}`);
  console.log('='.repeat(60) + '\n');

  return contact.id;
}
