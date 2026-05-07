import { retry, usesRenewalPriceForFirstYear } from '@agentdomain/shared';
import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

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

let cachedTldPrices: Record<string, { register_price: number; renew_price?: number }> | null = null;
let cachedTldPricesTime = 0;

export class SpaceshipClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;

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
        `${SPACESHIP_API_BASE}/v1/domains/${encodeURIComponent(domain)}/availability`,
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
        `${SPACESHIP_API_BASE}/v1/domains/${encodeURIComponent(domain)}/available`,
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
      const res = await fetch(`${SPACESHIP_API_BASE}/v1/domains/availability`, {
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
      const res = await fetch(`${SPACESHIP_API_BASE}/v1/domains/available`, {
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
      const res = await fetch(`${SPACESHIP_API_BASE}/v1/contacts`, {
        method: 'PUT',
        headers: { ...this._headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        throw new Error(`Spaceship createContact failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as { id: string };
      log.info('contact created', { id: json.id });
      return { id: json.id };
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
          `${SPACESHIP_API_BASE}/v1/domains/${encodeURIComponent(opts.domain)}`,
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
      `${SPACESHIP_API_BASE}/v1/async-operations/${encodeURIComponent(operationId)}`,
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
        `${SPACESHIP_API_BASE}/v1/domains/${encodeURIComponent(opts.domain)}/renew`,
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
   * Update the nameservers for a domain (so we can point it at Cloudflare DNS).
   */
  async setNameservers(domain: string, nameservers: string[]): Promise<void> {
    return retry(async () => {
      const res = await fetch(
        `${SPACESHIP_API_BASE}/v1/domains/${encodeURIComponent(domain)}/nameservers`,
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

  async getDomainInfo(domain: string): Promise<DomainInfo> {
    const res = await fetch(`${SPACESHIP_API_BASE}/v1/domains/${encodeURIComponent(domain)}`, {
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
