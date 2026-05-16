import {
  type Address,
  type Hex,
  type WalletClient,
  type PublicClient,
  type Transport,
  type Chain,
  type Account,
  keccak256,
  toHex,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import type { DnsRecord, RegistrationParams, RegistrationResult, EmailMessage } from '@agentdomain/shared';
import {
  USDC_BASE,
  USDC_BASE_SEPOLIA,
  X402_PAYMENT_HEADER,
  X402_PAYMENT_REQUIRED_HEADER,
} from '@agentdomain/shared/constants';

export interface AgentDomainOptions {
  apiUrl?: string;
  walletClient?: WalletClient<Transport, Chain, Account>;
  publicClient?: PublicClient<Transport, Chain>;
  network?: 'base' | 'base-sepolia';
}

export interface AvailabilityResult {
  available: boolean;
  domain?: string;
  reason?: string;
}

export interface QuoteResult {
  domain: string;
  basename?: string;
  ensName?: string;
  years: number;
  domainCostUsdc: string;
  basenameCostUsdc: string;
  ensCostUsdc: string;
  serviceFeeUsdc: string;
  totalUsdc: string;
  discountApplied: boolean;
  discountPercent: number;
}

export interface AgentRow {
  id: string;
  domain: string;
  basename?: string;
  ensName?: string;
  status: string;
  walletAddress: Address;
  ownerAddress: Address;
}

export interface EmailResult {
  id: string;
  status: string;
}

export interface EmailListResult {
  inbox: unknown;
  messages: EmailMessage[];
}

export interface VaultFundResult {
  txHash: string;
  amount: string;
}

export interface VaultWithdrawResult {
  txHash: string;
  amount: string;
}

export interface RenewalStatus {
  agentId: string;
  vaultBalance: string;
  requiredAmount: string;
  isFunded: boolean;
}

export class AgentDomain {
  private apiUrl: string;
  readonly walletClient?: WalletClient<Transport, Chain, Account>;
  readonly publicClient?: PublicClient<Transport, Chain>;
  readonly network: 'base' | 'base-sepolia';

  constructor(opts?: AgentDomainOptions) {
    this.apiUrl = opts?.apiUrl ?? 'https://agentdomain.xyz/api/v1';
    this.walletClient = opts?.walletClient;
    this.publicClient = opts?.publicClient;
    this.network = opts?.network ?? 'base';
  }

  async checkAvailability(
    name: string,
    opts: { tld: string },
  ): Promise<AvailabilityResult> {
    const url = `${this.apiUrl}/domains/availability?name=${encodeURIComponent(name)}&tld=${encodeURIComponent(opts.tld)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async quote(args: {
    preferredName: string;
    tld: string;
    registerBasename?: boolean;
    basenameLabel?: string;
    registerEns?: boolean;
    ensLabel?: string;
    years?: number;
    discountCode?: string;
  }): Promise<QuoteResult> {
    const params = new URLSearchParams();
    params.set('preferredName', args.preferredName);
    params.set('tld', args.tld);
    if (args.registerBasename !== undefined) params.set('registerBasename', String(args.registerBasename));
    if (args.basenameLabel) params.set('basenameLabel', args.basenameLabel);
    if (args.registerEns !== undefined) params.set('registerEns', String(args.registerEns));
    if (args.ensLabel) params.set('ensLabel', args.ensLabel);
    if (args.years) params.set('years', String(args.years));
    if (args.discountCode) params.set('discountCode', args.discountCode);
    const url = `${this.apiUrl}/agents/quote?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async register(args: RegistrationParams): Promise<RegistrationResult> {
    const walletAddress = (args.wallet || this.walletClient?.account?.address) as Address | undefined;

    const url = `${this.apiUrl}/agents/register`;
    const body = JSON.stringify(args);

    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (res.status === 402) {
      if (!this.walletClient || !walletAddress) {
        throw new Error(
          'Registration requires x402 payment. Provide a walletClient in AgentDomain constructor so the SDK can sign the USDC authorization.',
        );
      }

      const paymentRequiredHeader = res.headers.get(X402_PAYMENT_REQUIRED_HEADER);
      if (!paymentRequiredHeader) {
        throw new Error('Payment required but server returned no X-Payment-Required header');
      }

      let requirement: {
        scheme: string;
        network: string;
        maxAmountRequired: string;
        resource: string;
        description: string;
        mimeType: string;
        payTo: string;
        maxTimeoutSeconds: number;
        asset: string;
      };
      try {
        requirement = JSON.parse(paymentRequiredHeader);
      } catch {
        throw new Error('Failed to parse X-Payment-Required header');
      }

      const paymentPayload = await this.buildX402Payment(requirement, walletAddress);

      const paymentHeader = base64Encode(JSON.stringify(paymentPayload));

      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [X402_PAYMENT_HEADER]: paymentHeader,
        },
        body,
      });
    }

    if (!res.ok) {
      let detail = '';
      try {
        const errBody = await res.json();
        detail = `: ${(errBody as { message?: string }).message ?? JSON.stringify(errBody)}`;
      } catch {
        // ignore
      }
      throw new Error(`HTTP ${res.status}${detail}`);
    }
    return res.json();
  }

  private async buildX402Payment(
    requirement: {
      payTo: string;
      maxAmountRequired: string;
      maxTimeoutSeconds: number;
      asset: string;
    },
    from: Address,
  ) {
    const chain = this.network === 'base-sepolia' ? baseSepolia : base;
    const usdcAddress =
      this.network === 'base-sepolia' ? USDC_BASE_SEPOLIA : USDC_BASE;

    const now = BigInt(Math.floor(Date.now() / 1000));
    const validBefore = now + BigInt(requirement.maxTimeoutSeconds || 300);

    const nonce = keccak256(
      toHex(`${from}:${Date.now()}:${Math.floor(Math.random() * 1e15)}`),
    ) as Hex;

    const message = {
      from,
      to: requirement.payTo as Address,
      value: BigInt(requirement.maxAmountRequired),
      validAfter: 0n,
      validBefore,
      nonce,
    };

    const signature = await this.walletClient!.signTypedData({
      domain: {
        name: 'USD Coin',
        version: '2',
        chainId: chain.id,
        verifyingContract: requirement.asset as Address,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message,
    });

    return {
      x402Version: 1,
      scheme: 'exact',
      network: this.network === 'base-sepolia' ? 'base-sepolia' : 'base',
      payload: {
        signature,
        authorization: {
          from,
          to: requirement.payTo,
          value: requirement.maxAmountRequired,
          validAfter: '0',
          validBefore: validBefore.toString(),
          nonce,
        },
      },
    };
  }

  async getAgent(wallet: Address): Promise<AgentRow> {
    const url = `${this.apiUrl}/agents/by-wallet/${wallet}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.agent ?? data;
  }

  async search(args: {
    q?: string;
    framework?: string;
    capability?: string;
    limit?: number;
  }): Promise<{ items: AgentRow[]; total: number }> {
    const params = new URLSearchParams();
    if (args.q) params.set('q', args.q);
    if (args.framework) params.set('framework', args.framework);
    if (args.capability) params.set('capability', args.capability);
    if (args.limit) params.set('limit', String(args.limit));
    const url = `${this.apiUrl}/agents/search?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async sendEmail(
    agentId: string,
    args: { to: string | string[]; subject: string; text: string; replyTo?: string },
  ): Promise<EmailResult> {
    const url = `${this.apiUrl}/agents/${agentId}/email/send`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async listEmail(agentId: string, args: { limit?: number; unreadOnly?: boolean } = {}): Promise<EmailListResult> {
    const params = new URLSearchParams();
    if (args.limit) params.set('limit', String(args.limit));
    if (args.unreadOnly) params.set('unreadOnly', 'true');
    const url = `${this.apiUrl}/agents/${agentId}/email?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async listDnsRecords(agentId: string): Promise<DnsRecord[]> {
    const res = await fetch(`${this.apiUrl}/agents/${agentId}/dns`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async createDnsRecord(agentId: string, record: Omit<DnsRecord, 'id'>): Promise<DnsRecord> {
    const res = await fetch(`${this.apiUrl}/agents/${agentId}/dns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async updateDnsRecord(agentId: string, recordId: string, record: Partial<DnsRecord>): Promise<DnsRecord> {
    const res = await fetch(`${this.apiUrl}/agents/${agentId}/dns/${recordId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async deleteDnsRecord(agentId: string, recordId: string): Promise<{ success: boolean }> {
    const res = await fetch(`${this.apiUrl}/agents/${agentId}/dns/${recordId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async fundRenewalVault(agentId: string, amountUsdc: string): Promise<VaultFundResult> {
    const url = `${this.apiUrl}/agents/${agentId}/renewal/fund`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountUsdc }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async getRenewalStatus(agentId: string): Promise<RenewalStatus> {
    const url = `${this.apiUrl}/agents/${agentId}/renewal/status`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async withdrawFromVault(agentId: string, amountUsdc: string): Promise<VaultWithdrawResult> {
    const url = `${this.apiUrl}/agents/${agentId}/renewal/withdraw`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountUsdc }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}

export function createOpenAITools(): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return [
    {
      type: 'function' as const,
      function: {
        name: 'check_domain_availability',
        description: 'Check if a domain name is available for registration',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Domain name to check' },
            tld: { type: 'string', description: 'TLD (e.g. xyz, com, ai)', default: 'xyz' },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'quote_registration',
        description: 'Get pricing quote for registering an AI agent identity',
        parameters: {
          type: 'object',
          properties: {
            preferredName: { type: 'string', description: 'Preferred domain name' },
            tld: { type: 'string', description: 'TLD', default: 'xyz' },
            registerBasename: { type: 'boolean', description: 'Also register Basename', default: true },
            registerEns: { type: 'boolean', description: 'Also register ENS name', default: false },
            years: { type: 'number', description: 'Registration years', default: 1 },
          },
          required: ['preferredName'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'register_agent_identity',
        description: 'Register a new AI agent identity (domain + basename + ENS)',
        parameters: {
          type: 'object',
          properties: {
            preferredName: { type: 'string', description: 'Domain name' },
            tld: { type: 'string', description: 'TLD', default: 'xyz' },
            registerBasename: { type: 'boolean', description: 'Register Basename', default: true },
            registerEns: { type: 'boolean', description: 'Register ENS', default: false },
            years: { type: 'number', description: 'Registration years', default: 1 },
          },
          required: ['preferredName'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'search_agents',
        description: 'Search for registered AI agents',
        parameters: {
          type: 'object',
          properties: {
            q: { type: 'string', description: 'Search query' },
            framework: { type: 'string', description: 'Filter by framework' },
            limit: { type: 'number', description: 'Max results', default: 20 },
          },
        },
      },
    },
  ];
}

export function createAnthropicTools(): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return [
    {
      name: 'check_domain_availability',
      description: 'Check if a domain name is available for registration',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Domain name to check' },
          tld: { type: 'string', description: 'TLD (e.g. xyz, com, ai)', default: 'xyz' },
        },
        required: ['name'],
      },
    },
    {
      name: 'quote_registration',
      description: 'Get pricing quote for registering an AI agent identity',
      input_schema: {
        type: 'object',
        properties: {
          preferredName: { type: 'string', description: 'Preferred domain name' },
          tld: { type: 'string', description: 'TLD', default: 'xyz' },
          registerBasename: { type: 'boolean', description: 'Also register Basename', default: true },
          registerEns: { type: 'boolean', description: 'Also register ENS name', default: false },
          years: { type: 'number', description: 'Registration years', default: 1 },
        },
        required: ['preferredName'],
      },
    },
    {
      name: 'register_agent_identity',
      description: 'Register a new AI agent identity (domain + basename + ENS)',
      input_schema: {
        type: 'object',
        properties: {
          preferredName: { type: 'string', description: 'Domain name' },
          tld: { type: 'string', description: 'TLD', default: 'xyz' },
          registerBasename: { type: 'boolean', description: 'Register Basename', default: true },
          registerEns: { type: 'boolean', description: 'Register ENS', default: false },
          years: { type: 'number', description: 'Registration years', default: 1 },
        },
        required: ['preferredName'],
      },
    },
    {
      name: 'search_agents',
      description: 'Search for registered AI agents',
      input_schema: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Search query' },
          framework: { type: 'string', description: 'Filter by framework' },
          limit: { type: 'number', description: 'Max results', default: 20 },
        },
      },
    },
  ];
}

export async function runAgentDomainTool(
  ad: AgentDomain,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'check_domain_availability':
      return ad.checkAvailability(args.name as string, { tld: (args.tld as string) ?? 'xyz' });
    case 'quote_registration':
      return ad.quote({
        preferredName: args.preferredName as string,
        tld: (args.tld as string) ?? 'xyz',
        registerBasename: (args.registerBasename as boolean) ?? true,
        registerEns: (args.registerEns as boolean) ?? false,
        years: (args.years as number) ?? 1,
      });
    case 'register_agent_identity':
      return ad.register({
        preferredName: args.preferredName as string,
        tld: (args.tld as string) ?? 'xyz',
        registerBasename: (args.registerBasename as boolean) ?? true,
        registerEns: (args.registerEns as boolean) ?? false,
        years: (args.years as number) ?? 1,
        autoRenew: false,
        emailEnabled: false,
        wallet: args.wallet as Address,
      } as RegistrationParams);
    case 'search_agents':
      return ad.search({
        q: args.q as string,
        framework: args.framework as string,
        limit: (args.limit as number) ?? 20,
      });
    case 'list_dns_records':
      return ad.listDnsRecords(args.agentId as string);
    case 'create_dns_record':
      return ad.createDnsRecord(args.agentId as string, args.record as Omit<DnsRecord, 'id'>);
    case 'list_agent_email':
      return ad.listEmail(args.agentId as string, { limit: (args.limit as number) ?? 20 });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function formatAgentDomainToolResult(result: unknown): string {
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

function base64Encode(value: string): string {
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(value)));
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const bytes = new TextEncoder().encode(value);
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triplet = (a << 16) | (b << 8) | c;
    output += alphabet[(triplet >> 18) & 63];
    output += alphabet[(triplet >> 12) & 63];
    output += i + 1 < bytes.length ? alphabet[(triplet >> 6) & 63] : '=';
    output += i + 2 < bytes.length ? alphabet[triplet & 63] : '=';
  }
  return output;
}
