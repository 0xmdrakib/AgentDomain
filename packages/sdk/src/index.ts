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
  getAddress,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import type {
  DnsRecord,
  RegistrationParams,
  RegistrationResult,
  EmailMessage,
  RenewalPriceSnapshot,
  ServicePlanEntitlement,
  ServicePlanKey,
} from '@agentdomain/shared';
import {
  AGENTDOMAIN_API_BASE_URL,
  X402_PAYMENT_HEADER,
  X402_PAYMENT_REQUIRED_HEADER,
} from '@agentdomain/shared/constants';

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

const RENEWAL_VAULT_ABI = [
  {
    type: 'function',
    name: 'setAutoRenew',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'enabled', type: 'bool' },
    ],
    outputs: [],
  },
] as const;

export interface AgentDomainOptions {
  apiUrl?: string;
  apiKey?: string;
  walletClient?: WalletClient<Transport, Chain, Account>;
  publicClient?: PublicClient<Transport, Chain>;
  network?: 'base' | 'base-sepolia';
  renewalVaultAddress?: Address;
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
  platformFeeUsdc?: string;
  premiumPlan: ServicePlanKey;
  premiumPlanLabel: string;
  premiumPlanFeeUsdc: string;
  emailFeeUsdc: string;
  sslCertificationFeeUsdc: string;
  emailIncluded?: boolean;
  sslIncluded?: boolean;
  includedServices?: string[];
  providerCostUsdc?: string;
  treasuryFeeUsdc?: string;
  totalUsdc: string;
}

export type RegisterArgs = Omit<
  RegistrationParams,
  'wallet' | 'tld' | 'registerBasename' | 'registerEns' | 'emailEnabled' | 'years' | 'autoRenew'
> & {
  wallet?: Address;
  tld?: RegistrationParams['tld'];
  registerBasename?: boolean;
  registerEns?: boolean;
  emailEnabled?: boolean;
  years?: number;
  autoRenew?: boolean;
};

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

export interface EmailAddressSummary {
  id: string;
  agentId: string;
  emailAddress: string;
  kind: 'primary' | 'alias';
  status: 'active' | 'deleted';
  createdAt: string;
  updatedAt: string;
}

export interface EmailListResult {
  inbox: unknown;
  addresses?: EmailAddressSummary[];
  limits?: { plan: ServicePlanKey; planLabel: string; emailAliases: number };
  messages: EmailMessage[];
}

export interface VaultFundResult {
  success: boolean;
  depositTxHash: string;
  autoRenewEnabled: boolean;
  autoRenewTxHash: string | null;
  vaultBalance: string;
  agentId: string;
  domain: string;
}

export interface VaultWithdrawResult {
  chainId: number;
  to: Address;
  data: Hex;
  value: '0';
  functionName: 'withdraw';
  args: {
    tokenId: string;
    amount: string;
  };
}

export interface RenewalStatus {
  agentId: string;
  domain: string;
  tokenId: string | null;
  autoRenewEnabled: boolean;
  vaultBalanceUsdc: string;
  vaultBalanceAtomic: string;
  vaultBalance: string;
  pendingRenewalAmountUsdc?: string;
  pendingRenewalAmountAtomic?: string;
  renewalFeeUsdc: string;
  renewalFeeAtomic: string;
  nextRenewalAmountUsdc: string;
  nextRenewalAmountAtomic: string;
  shortfallUsdc: string;
  shortfallAtomic: string;
  requiredAmount: string;
  hasEnoughBalanceForNextRenewal: boolean;
  isFunded: boolean;
  estimatedYearsCovered: number;
  expiresAt: string | null;
  renewableFrom: string | null;
  daysUntilExpiry: number | null;
  renewalWindowDays: number;
  renewalDurationDays: number;
  isRenewableNow: boolean;
  status: string;
  message: string;
  warning?: string | null;
  warnings?: string[];
  renewalBreakdown?: {
    years: number;
    domainRenewalCostUsdc: string;
    domainRenewalCostAtomic: string;
    platformFeeUsdc: string;
    platformFeeAtomic: string;
    premiumPlan: ServicePlanKey;
    premiumPlanFeeUsdc: string;
    premiumPlanFeeAtomic: string;
    sslCertificationFeeUsdc: string;
    sslCertificationFeeAtomic: string;
    emailFeeUsdc: string;
    emailFeeAtomic: string;
    totalUsdc: string;
    totalAtomic: string;
  };
  renewalSnapshot?: RenewalPriceSnapshot | null;
  ownerAddress: string;
}

export interface AutoRenewResult {
  agentId: string;
  tokenId: string;
  enabled: boolean;
  changed: boolean;
  txHash: Hex | null;
}

export interface SslReconfigureResult {
  ok: true;
  agentId: string;
  domain: string;
  cloudflareCustomHostnameId: string;
  hostnameStatus: string;
  sslStatus: string;
  validationRecordsCount: number;
  recordsCount: number;
}

export interface ServicePlanStatusResult {
  agentId: string;
  domain: string;
  entitlement: ServicePlanEntitlement;
  subscription: unknown | null;
  purchases: unknown[];
  catalog: Record<string, unknown>;
  renewalPlan: ServicePlanKey;
  upgradeQuotes?: Record<string, unknown>;
  registryVisibility: RegistryVisibilityStatus;
}

export interface ServicePlanPurchaseResult {
  success: true;
  agentId: string;
  domain: string;
  paymentTxHash: string | null;
  amountUsdc: string;
  subscription: unknown;
  purchase: unknown;
  entitlement: ServicePlanEntitlement;
}

export interface RegistryVisibilityStatus {
  hidden: boolean;
  hiddenUntil: string | null;
  requestedHidden: boolean;
  canHide: boolean;
  defaultHidden: boolean;
}

export interface RegistryVisibilityResult {
  success: true;
  agentId: string;
  domain: string;
  entitlement: ServicePlanEntitlement;
  registryVisibility: RegistryVisibilityStatus;
}

export interface ApiKeySummary {
  id: string;
  agentId: string | null;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedApiKey extends ApiKeySummary {
  agentId: string;
  fullKey: string;
  warning?: string;
}

interface X402RequirementForClient {
  scheme?: string;
  network?: string;
  maxAmountRequired: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  chainId?: number;
  extensions?: Record<string, unknown>;
}

export class AgentDomain {
  private apiUrl: string;
  private apiKey?: string;
  private renewalVaultAddress?: Address;
  readonly walletClient?: WalletClient<Transport, Chain, Account>;
  readonly publicClient?: PublicClient<Transport, Chain>;
  readonly network: 'base' | 'base-sepolia';

  constructor(opts?: AgentDomainOptions) {
    this.apiUrl = opts?.apiUrl ?? AGENTDOMAIN_API_BASE_URL;
    this.apiKey = opts?.apiKey;
    this.walletClient = opts?.walletClient;
    this.publicClient = opts?.publicClient;
    this.network = opts?.network ?? 'base';
    this.renewalVaultAddress = opts?.renewalVaultAddress;
  }

  async checkAvailability(name: string, opts: { tld: string }): Promise<AvailabilityResult> {
    const url = `${this.apiUrl}/domains/availability?name=${encodeURIComponent(name)}&tld=${encodeURIComponent(opts.tld)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async quote(args: {
    preferredName: string;
    tld: string;
    registerBasename?: boolean;
    basenameLabel?: string;
    registerEns?: boolean;
    ensLabel?: string;
    emailEnabled?: boolean;
    emailUsername?: string;
    premiumPlan?: ServicePlanKey;
    years?: number;
  }): Promise<QuoteResult> {
    const params = new URLSearchParams();
    params.set('preferredName', args.preferredName);
    params.set('tld', args.tld);
    if (args.registerBasename !== undefined)
      params.set('registerBasename', String(args.registerBasename));
    if (args.basenameLabel) params.set('basenameLabel', args.basenameLabel);
    if (args.registerEns !== undefined) params.set('registerEns', String(args.registerEns));
    if (args.ensLabel) params.set('ensLabel', args.ensLabel);
    if (args.emailEnabled !== undefined) params.set('emailEnabled', String(args.emailEnabled));
    if (args.emailUsername) params.set('emailUsername', args.emailUsername);
    if (args.premiumPlan) params.set('premiumPlan', args.premiumPlan);
    if (args.years) params.set('years', String(args.years));
    const url = `${this.apiUrl}/agents/quote?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async register(args: RegisterArgs): Promise<RegistrationResult> {
    const walletAddress = (args.wallet || this.walletClient?.account?.address) as
      | Address
      | undefined;
    if (!walletAddress) {
      throw new Error(
        'Registration requires a wallet address. Pass args.wallet or provide a walletClient with an account.',
      );
    }

    const url = `${this.apiUrl}/agents/register`;
    const body = JSON.stringify({
      ...args,
      wallet: walletAddress,
      tld: args.tld ?? 'xyz',
      registerBasename: args.registerBasename ?? true,
      registerEns: args.registerEns ?? false,
      emailEnabled: true,
      emailUsername: args.emailUsername ?? 'agent',
      premiumPlan: args.premiumPlan ?? 'included',
      years: args.years ?? 1,
      autoRenew: args.autoRenew ?? false,
    });

    let res = await fetch(url, {
      method: 'POST',
      headers: await this.authHeaders({ 'Content-Type': 'application/json' }),
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

      let requirement: X402RequirementForClient;
      try {
        requirement = JSON.parse(paymentRequiredHeader);
      } catch {
        throw new Error('Failed to parse X-Payment-Required header');
      }

      const paymentPayload = await this.buildX402Payment(requirement, walletAddress);

      const paymentHeader = base64Encode(JSON.stringify(paymentPayload));

      res = await fetch(url, {
        method: 'POST',
        headers: await this.authHeaders({
          'Content-Type': 'application/json',
          [X402_PAYMENT_HEADER]: paymentHeader,
        }),
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
    requirement: X402RequirementForClient,
    from: Address,
  ) {
    const authorization = await this.buildEip3009Authorization(requirement, from);

    return {
      x402Version: 1,
      scheme: 'exact',
      network: this.network === 'base-sepolia' ? 'base-sepolia' : 'base',
      payload: {
        signature: authorization.signature,
        authorization: authorization.authorization,
      },
      ...(requirement.extensions ? { extensions: requirement.extensions } : {}),
    };
  }

  private async buildEip3009Authorization(
    requirement: X402RequirementForClient,
    from: Address,
  ) {
    const chain = this.network === 'base-sepolia' ? baseSepolia : base;
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
        chainId: requirement.chainId ?? chain.id,
        verifyingContract: requirement.asset as Address,
      },
      types: EIP3009_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
    });

    return {
      signature,
      authorization: {
        from,
        to: requirement.payTo,
        value: requirement.maxAmountRequired,
        validAfter: '0',
        validBefore: validBefore.toString(),
        nonce,
      },
    };
  }

  async getAgentsByWallet(wallet: Address): Promise<AgentRow[]> {
    const url = `${this.apiUrl}/agents/by-wallet/${wallet}`;
    const res = await fetch(url, {
      headers: await this.authHeaders(undefined, { useApiKey: false }),
    });
    if (!res.ok) throw new Error(await responseError(res));
    const data = await res.json();
    return Array.isArray(data) ? data : data.agent ? [data.agent] : [];
  }

  async getAgentById(agentId: string): Promise<AgentRow> {
    const url = `${this.apiUrl}/agents/${agentId}`;
    const res = await fetch(url, { headers: await this.authHeaders() });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async getAgent(wallet: Address): Promise<AgentRow | null> {
    const agents = await this.getAgentsByWallet(wallet);
    return agents[0] ?? null;
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
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async sendEmail(
    agentId: string,
    args: {
      to: string | string[];
      subject: string;
      text: string;
      fromAddress?: string;
      replyTo?: string;
    },
  ): Promise<EmailResult> {
    const url = `${this.apiUrl}/agents/${agentId}/email/send`;
    const res = await fetch(url, {
      method: 'POST',
      headers: await this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async updatePrimaryEmail(
    agentId: string,
    username: string,
  ): Promise<{ inbox: unknown; addresses: EmailAddressSummary[]; message: string }> {
    const res = await fetch(`${this.apiUrl}/agents/${agentId}/email`, {
      method: 'PATCH',
      headers: await this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ username, confirmReplace: true }),
    });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async createEmailAlias(
    agentId: string,
    username: string,
  ): Promise<{ address: EmailAddressSummary; addresses: EmailAddressSummary[] }> {
    const res = await fetch(`${this.apiUrl}/agents/${agentId}/email/aliases`, {
      method: 'POST',
      headers: await this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ username }),
    });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async deleteEmailAlias(
    agentId: string,
    emailAddress: string,
  ): Promise<{ deleted: true; addresses: EmailAddressSummary[] }> {
    const params = new URLSearchParams({ emailAddress });
    const res = await fetch(`${this.apiUrl}/agents/${agentId}/email/aliases?${params}`, {
      method: 'DELETE',
      headers: await this.authHeaders(),
    });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async listEmail(
    agentId: string,
    args: { limit?: number; unreadOnly?: boolean } = {},
  ): Promise<EmailListResult> {
    const params = new URLSearchParams();
    if (args.limit) params.set('limit', String(args.limit));
    if (args.unreadOnly) params.set('unreadOnly', 'true');
    const url = `${this.apiUrl}/agents/${agentId}/email?${params.toString()}`;
    const res = await fetch(url, { headers: await this.authHeaders() });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async listDnsRecords(agentId: string): Promise<DnsRecord[]> {
    const res = await fetch(`${this.apiUrl}/agents/${agentId}/dns`, {
      headers: await this.authHeaders(),
    });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async createDnsRecord(agentId: string, record: Omit<DnsRecord, 'id'>): Promise<DnsRecord> {
    const res = await fetch(`${this.apiUrl}/agents/${agentId}/dns`, {
      method: 'POST',
      headers: await this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async updateDnsRecord(
    agentId: string,
    recordId: string,
    record: Partial<DnsRecord>,
  ): Promise<DnsRecord> {
    const res = await fetch(`${this.apiUrl}/agents/${agentId}/dns/${recordId}`, {
      method: 'PATCH',
      headers: await this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async deleteDnsRecord(agentId: string, recordId: string): Promise<{ success: boolean }> {
    const res = await fetch(`${this.apiUrl}/agents/${agentId}/dns/${recordId}`, {
      method: 'DELETE',
      headers: await this.authHeaders(),
    });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async fundRenewalVault(agentId: string, amountUsdc: string): Promise<VaultFundResult> {
    const walletAddress = this.walletClient?.account?.address as Address | undefined;
    if (!this.walletClient || !walletAddress) {
      throw new Error(
        'Funding the renewal vault requires a walletClient so the SDK can sign a USDC authorization.',
      );
    }

    const url = `${this.apiUrl}/agents/${agentId}/renewal/fund`;
    let res = await fetch(url, {
      method: 'POST',
      headers: await this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ amount: amountUsdc }),
    });

    if (res.status === 402) {
      const challenge = (await res.json()) as {
        scheme: 'eip3009';
        chainId: number;
        asset: string;
        payTo: string;
        maxAmountRequired: string;
        maxTimeoutSeconds: number;
      };
      const authorization = await this.buildEip3009Authorization(challenge, walletAddress);
      res = await fetch(url, {
        method: 'POST',
        headers: await this.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          amount: amountUsdc,
          signature: authorization.signature,
          authorization: authorization.authorization,
        }),
      });
    }

    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async getRenewalStatus(agentId: string): Promise<RenewalStatus> {
    const url = `${this.apiUrl}/agents/${agentId}/renewal/status`;
    const res = await fetch(url, { headers: await this.authHeaders() });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async setAutoRenew(
    agentId: string,
    enabled: boolean,
    opts: { renewalVaultAddress?: Address; waitForReceipt?: boolean } = {},
  ): Promise<AutoRenewResult> {
    const walletAddress = this.walletClient?.account?.address as Address | undefined;
    if (!this.walletClient || !walletAddress) {
      throw new Error(
        'Auto-renew requires a walletClient for the AgentID NFT owner wallet. Any wallet can fund RenewalVault, but only the owner wallet can change auto-renew.',
      );
    }

    const renewalVaultAddress = opts.renewalVaultAddress ?? this.renewalVaultAddress;
    if (!renewalVaultAddress) {
      throw new Error(
        'renewalVaultAddress is required to enable auto-renew. Pass it to the AgentDomain constructor or setAutoRenew options.',
      );
    }

    const status = await this.getRenewalStatus(agentId);
    if (!status.tokenId) {
      throw new Error('Auto-renew cannot be changed before the AgentID NFT is minted.');
    }

    if (status.ownerAddress && !sameAddress(walletAddress, status.ownerAddress)) {
      throw new Error(
        `Auto-renew can only be changed by the AgentID NFT owner wallet (${status.ownerAddress}).`,
      );
    }

    if (status.autoRenewEnabled === enabled) {
      return {
        agentId,
        tokenId: status.tokenId,
        enabled,
        changed: false,
        txHash: null,
      };
    }

    if (opts.waitForReceipt && !this.publicClient) {
      throw new Error('waitForReceipt requires a publicClient in the AgentDomain constructor.');
    }

    const chain = this.network === 'base-sepolia' ? baseSepolia : base;
    const txHash = (await this.walletClient.writeContract({
      address: renewalVaultAddress,
      abi: RENEWAL_VAULT_ABI,
      functionName: 'setAutoRenew',
      args: [BigInt(status.tokenId), enabled],
      account: this.walletClient.account,
      chain,
    })) as Hex;

    if (opts.waitForReceipt) {
      await this.publicClient!.waitForTransactionReceipt({ hash: txHash });
    }

    return {
      agentId,
      tokenId: status.tokenId,
      enabled,
      changed: true,
      txHash,
    };
  }

  async withdrawFromVault(agentId: string, amountUsdc: string): Promise<VaultWithdrawResult> {
    const url = `${this.apiUrl}/agents/${agentId}/renewal/withdraw`;
    const res = await fetch(url, {
      method: 'POST',
      headers: await this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ amount: amountUsdc }),
    });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async reconfigureSsl(agentId: string): Promise<SslReconfigureResult> {
    const url = `${this.apiUrl}/agents/${agentId}/ssl`;
    const res = await fetch(url, {
      method: 'POST',
      headers: await this.authHeaders(),
    });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async getServicePlan(agentId: string): Promise<ServicePlanStatusResult> {
    const url = `${this.apiUrl}/agents/${agentId}/plan`;
    const res = await fetch(url, { headers: await this.authHeaders() });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async purchaseServicePlan(args: {
    agentId: string;
    plan: Exclude<ServicePlanKey, 'included'>;
  }): Promise<ServicePlanPurchaseResult> {
    const walletAddress = this.walletClient?.account?.address as Address | undefined;
    if (!this.walletClient || !walletAddress) {
      throw new Error(
        'Premium Plan purchase requires a walletClient so the SDK can sign the USDC x402 payment.',
      );
    }

    const url = `${this.apiUrl}/agents/${args.agentId}/plan`;
    const body = JSON.stringify({
      plan: args.plan,
    });

    let res = await fetch(url, {
      method: 'POST',
      headers: await this.authHeaders({ 'Content-Type': 'application/json' }),
      body,
    });

    if (res.status === 402) {
      const paymentRequiredHeader = res.headers.get(X402_PAYMENT_REQUIRED_HEADER);
      if (!paymentRequiredHeader) {
        throw new Error('Payment required but server returned no X-Payment-Required header');
      }

      let requirement: X402RequirementForClient;
      try {
        requirement = JSON.parse(paymentRequiredHeader);
      } catch {
        throw new Error('Failed to parse X-Payment-Required header');
      }

      const paymentPayload = await this.buildX402Payment(requirement, walletAddress);
      const paymentHeader = base64Encode(JSON.stringify(paymentPayload));

      res = await fetch(url, {
        method: 'POST',
        headers: await this.authHeaders({
          'Content-Type': 'application/json',
          [X402_PAYMENT_HEADER]: paymentHeader,
        }),
        body,
      });
    }

    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async setRegistryVisibility(
    agentId: string,
    registryHidden: boolean,
  ): Promise<RegistryVisibilityResult> {
    const url = `${this.apiUrl}/agents/${agentId}/plan`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: await this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ registryHidden }),
    });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async listApiKeys(agentId: string): Promise<ApiKeySummary[]> {
    const params = new URLSearchParams({ agentId });
    const res = await fetch(`${this.apiUrl}/keys?${params.toString()}`, {
      headers: await this.authHeaders(undefined, { useApiKey: false }),
    });
    if (!res.ok) throw new Error(await responseError(res));
    const data = (await res.json()) as { keys: ApiKeySummary[] };
    return data.keys;
  }

  async createApiKey(agentId: string, name: string): Promise<CreatedApiKey> {
    const res = await fetch(`${this.apiUrl}/keys`, {
      method: 'POST',
      headers: await this.authHeaders({ 'Content-Type': 'application/json' }, { useApiKey: false }),
      body: JSON.stringify({ agentId, name }),
    });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  async revokeApiKey(keyId: string): Promise<{ revoked: boolean }> {
    const res = await fetch(`${this.apiUrl}/keys/${keyId}`, {
      method: 'DELETE',
      headers: await this.authHeaders(undefined, { useApiKey: false }),
    });
    if (!res.ok) throw new Error(await responseError(res));
    return res.json();
  }

  private async authHeaders(
    extra?: Record<string, string>,
    opts: { useApiKey?: boolean } = {},
  ): Promise<Record<string, string>> {
    const headers = { ...(extra ?? {}) };
    if ((opts.useApiKey ?? true) && this.apiKey && !headers.Authorization) {
      headers.Authorization = `Bearer ${this.apiKey}`;
      return headers;
    }

    if (!headers['X-Agent-Signature'] && this.walletClient?.account) {
      try {
        const timestamp = Date.now();
        const message = `agentdomain.app api auth ${timestamp}`;
        const signature = await this.walletClient.signMessage({
          account: this.walletClient.account,
          message,
        });
        headers['X-Agent-Signature'] =
          `${this.walletClient.account.address}:${timestamp}:${signature}`;
      } catch {
        // Some browser wallet clients may not expose signMessage here. The
        // request can still proceed and let the API return the auth challenge.
      }
    }
    return headers;
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
        description:
          'Get pricing quote for registering an AI agent identity. Domain, DNS, email, SSL certification, AgentID NFT orchestration, and platform fee are included by default. Basename and ENS are optional.',
        parameters: {
          type: 'object',
          properties: {
            preferredName: { type: 'string', description: 'Preferred domain name' },
            tld: { type: 'string', description: 'TLD', default: 'xyz' },
            registerBasename: {
              type: 'boolean',
              description: 'Also register Basename. Set false to skip Basename cost.',
              default: true,
            },
            basenameLabel: {
              type: 'string',
              description: 'Optional alternate Basename label. Omit to use preferredName.',
            },
            registerEns: {
              type: 'boolean',
              description: 'Also register ENS name. Set false to skip ENS cost.',
              default: false,
            },
            ensLabel: {
              type: 'string',
              description: 'Optional alternate ENS label. Omit to use preferredName.',
            },
            emailEnabled: {
              type: 'boolean',
              description: 'Deprecated compatibility flag. Email is now always included.',
              default: true,
            },
            emailUsername: {
              type: 'string',
              description: 'Primary email username. Defaults to agent, producing agent@domain.',
              default: 'agent',
            },
            premiumPlan: {
              type: 'string',
              enum: ['included', 'pro', 'enterprise'],
              description: 'Premium Plan to buy with registration. Defaults to included.',
              default: 'included',
            },
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
        description:
          'Register a new AI agent identity. Domain, DNS, email, SSL certification, AgentID NFT orchestration, and platform fee are included by default. Basename and ENS are optional.',
        parameters: {
          type: 'object',
          properties: {
            preferredName: { type: 'string', description: 'Domain name' },
            tld: { type: 'string', description: 'TLD', default: 'xyz' },
            registerBasename: {
              type: 'boolean',
              description: 'Register Basename. Set false to skip Basename cost.',
              default: true,
            },
            basenameLabel: {
              type: 'string',
              description: 'Optional alternate Basename label. Omit to use preferredName.',
            },
            registerEns: {
              type: 'boolean',
              description: 'Register ENS. Set false to skip ENS cost.',
              default: false,
            },
            ensLabel: {
              type: 'string',
              description: 'Optional alternate ENS label. Omit to use preferredName.',
            },
            ownerAddress: {
              type: 'string',
              description:
                'Optional EVM address that receives the AgentID NFT. Omit to use the paying wallet.',
            },
            emailEnabled: {
              type: 'boolean',
              description: 'Deprecated compatibility flag. Email is now always included.',
              default: true,
            },
            emailUsername: {
              type: 'string',
              description: 'Primary email username. Defaults to agent, producing agent@domain.',
              default: 'agent',
            },
            dnsTarget: {
              type: 'string',
              description: 'Optional initial endpoint URL or IP to point the domain at.',
            },
            premiumPlan: {
              type: 'string',
              enum: ['included', 'pro', 'enterprise'],
              description: 'Premium Plan to buy with registration. Defaults to included.',
              default: 'included',
            },
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
    {
      type: 'function' as const,
      function: {
        name: 'send_agent_email',
        description: 'Send text-only email from an agent primary email or active alias',
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Email subject' },
            text: { type: 'string', description: 'Plain-text email body' },
            fromAddress: {
              type: 'string',
              description: 'Optional primary email or active alias to send from',
            },
          },
          required: ['agentId', 'to', 'subject', 'text'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'list_agent_email',
        description: 'List an agent email messages and active primary/alias addresses',
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
            limit: { type: 'number', description: 'Max messages', default: 20 },
          },
          required: ['agentId'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'update_primary_email',
        description:
          'Change one agent primary email username. The old primary address stops receiving new mail.',
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
            username: { type: 'string', description: 'New local-part, e.g. agent or support' },
          },
          required: ['agentId', 'username'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'create_email_alias',
        description:
          'Create an extra receive-and-send email alias. Requires available Pro or Enterprise alias capacity.',
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
            username: { type: 'string', description: 'Alias local-part, e.g. billing' },
          },
          required: ['agentId', 'username'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'delete_email_alias',
        description: 'Delete one active email alias from an agent',
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
            emailAddress: { type: 'string', description: 'Full alias address to delete' },
          },
          required: ['agentId', 'emailAddress'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_renewal_status',
        description:
          'Get renewal vault status for an agent, including exact next renewal amount, purchase snapshot, vault balance, shortfall, renewal date, and auto-renew state',
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
          },
          required: ['agentId'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'fund_renewal_vault',
        description:
          'Deposit USDC from the connected wallet into one AgentID renewal vault. Anyone can fund; only the owner can withdraw or enable auto-renew. Call get_renewal_status first and normally use its shortfallUsdc value.',
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
            amountUsdc: {
              type: 'string',
              description: 'USDC amount to deposit, with up to 6 decimals.',
            },
          },
          required: ['agentId', 'amountUsdc'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'enable_auto_renew',
        description:
          'Enable RenewalVault auto-renew for an agent. Requires the walletClient to be the AgentID NFT owner wallet.',
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
          },
          required: ['agentId'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'reconfigure_ssl',
        description:
          'Rebuild the Cloudflare SaaS SSL hostname and sync the required Spaceship DNS validation records for an existing agent. Use this if SSL is pending, failed, or needs a refresh.',
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
          },
          required: ['agentId'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'set_registry_visibility',
        description:
          'Hide or show an agent in the public AgentDomain registry. Hiding requires an active Pro or Enterprise Premium Plan.',
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
            registryHidden: {
              type: 'boolean',
              description:
                'true hides the agent from public registry/search; false makes it public',
            },
          },
          required: ['agentId', 'registryHidden'],
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
      description:
        'Get pricing quote for registering an AI agent identity. Domain, DNS, email, SSL certification, AgentID NFT orchestration, and platform fee are included by default. Basename and ENS are optional.',
      input_schema: {
        type: 'object',
        properties: {
          preferredName: { type: 'string', description: 'Preferred domain name' },
          tld: { type: 'string', description: 'TLD', default: 'xyz' },
          registerBasename: {
            type: 'boolean',
            description: 'Also register Basename. Set false to skip Basename cost.',
            default: true,
          },
          basenameLabel: {
            type: 'string',
            description: 'Optional alternate Basename label. Omit to use preferredName.',
          },
          registerEns: {
            type: 'boolean',
            description: 'Also register ENS name. Set false to skip ENS cost.',
            default: false,
          },
          ensLabel: {
            type: 'string',
            description: 'Optional alternate ENS label. Omit to use preferredName.',
          },
          emailEnabled: {
            type: 'boolean',
            description: 'Deprecated compatibility flag. Email is now always included.',
            default: true,
          },
          emailUsername: {
            type: 'string',
            description: 'Primary email username. Defaults to agent, producing agent@domain.',
            default: 'agent',
          },
          premiumPlan: {
            type: 'string',
            enum: ['included', 'pro', 'enterprise'],
            description: 'Premium Plan to buy with registration. Defaults to included.',
            default: 'included',
          },
          years: { type: 'number', description: 'Registration years', default: 1 },
        },
        required: ['preferredName'],
      },
    },
    {
      name: 'register_agent_identity',
      description:
        'Register a new AI agent identity. Domain, DNS, email, SSL certification, AgentID NFT orchestration, and platform fee are included by default. Basename and ENS are optional.',
      input_schema: {
        type: 'object',
        properties: {
          preferredName: { type: 'string', description: 'Domain name' },
          tld: { type: 'string', description: 'TLD', default: 'xyz' },
          registerBasename: {
            type: 'boolean',
            description: 'Register Basename. Set false to skip Basename cost.',
            default: true,
          },
          basenameLabel: {
            type: 'string',
            description: 'Optional alternate Basename label. Omit to use preferredName.',
          },
          registerEns: {
            type: 'boolean',
            description: 'Register ENS. Set false to skip ENS cost.',
            default: false,
          },
          ensLabel: {
            type: 'string',
            description: 'Optional alternate ENS label. Omit to use preferredName.',
          },
          ownerAddress: {
            type: 'string',
            description:
              'Optional EVM address that receives the AgentID NFT. Omit to use the paying wallet.',
          },
          emailEnabled: {
            type: 'boolean',
            description: 'Deprecated compatibility flag. Email is now always included.',
            default: true,
          },
          emailUsername: {
            type: 'string',
            description: 'Primary email username. Defaults to agent, producing agent@domain.',
            default: 'agent',
          },
          dnsTarget: {
            type: 'string',
            description: 'Optional initial endpoint URL or IP to point the domain at.',
          },
          premiumPlan: {
            type: 'string',
            enum: ['included', 'pro', 'enterprise'],
            description: 'Premium Plan to buy with registration. Defaults to included.',
            default: 'included',
          },
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
    {
      name: 'send_agent_email',
      description: 'Send text-only email from an agent primary email or active alias',
      input_schema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          text: { type: 'string', description: 'Plain-text email body' },
          fromAddress: {
            type: 'string',
            description: 'Optional primary email or active alias to send from',
          },
        },
        required: ['agentId', 'to', 'subject', 'text'],
      },
    },
    {
      name: 'list_agent_email',
      description: 'List an agent email messages and active primary/alias addresses',
      input_schema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
          limit: { type: 'number', description: 'Max messages', default: 20 },
        },
        required: ['agentId'],
      },
    },
    {
      name: 'update_primary_email',
      description:
        'Change one agent primary email username. The old primary address stops receiving new mail.',
      input_schema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
          username: { type: 'string', description: 'New local-part, e.g. agent or support' },
        },
        required: ['agentId', 'username'],
      },
    },
    {
      name: 'create_email_alias',
      description:
        'Create an extra receive-and-send email alias. Requires available Pro or Enterprise alias capacity.',
      input_schema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
          username: { type: 'string', description: 'Alias local-part, e.g. billing' },
        },
        required: ['agentId', 'username'],
      },
    },
    {
      name: 'delete_email_alias',
      description: 'Delete one active email alias from an agent',
      input_schema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
          emailAddress: { type: 'string', description: 'Full alias address to delete' },
        },
        required: ['agentId', 'emailAddress'],
      },
    },
    {
      name: 'get_renewal_status',
      description:
        'Get renewal vault status for an agent, including exact next renewal amount, purchase snapshot, vault balance, shortfall, renewal date, and auto-renew state',
      input_schema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
        },
        required: ['agentId'],
      },
    },
    {
      name: 'fund_renewal_vault',
      description:
        'Deposit USDC from the connected wallet into one AgentID renewal vault. Anyone can fund; only the owner can withdraw or enable auto-renew. Call get_renewal_status first and normally use its shortfallUsdc value.',
      input_schema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
          amountUsdc: {
            type: 'string',
            description: 'USDC amount to deposit, with up to 6 decimals.',
          },
        },
        required: ['agentId', 'amountUsdc'],
      },
    },
    {
      name: 'enable_auto_renew',
      description:
        'Enable RenewalVault auto-renew for an agent. Requires the walletClient to be the AgentID NFT owner wallet.',
      input_schema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
        },
        required: ['agentId'],
      },
    },
    {
      name: 'reconfigure_ssl',
      description:
        'Rebuild the Cloudflare SaaS SSL hostname and sync the required Spaceship DNS validation records for an existing agent. Use this if SSL is pending, failed, or needs a refresh.',
      input_schema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
        },
        required: ['agentId'],
      },
    },
    {
      name: 'set_registry_visibility',
      description:
        'Hide or show an agent in the public AgentDomain registry. Hiding requires an active Pro or Enterprise Premium Plan.',
      input_schema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
          registryHidden: {
            type: 'boolean',
            description: 'true hides the agent from public registry/search; false makes it public',
          },
        },
        required: ['agentId', 'registryHidden'],
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
        basenameLabel: args.basenameLabel as string | undefined,
        registerEns: (args.registerEns as boolean) ?? false,
        ensLabel: args.ensLabel as string | undefined,
        emailEnabled: true,
        emailUsername: args.emailUsername as string | undefined,
        premiumPlan: args.premiumPlan as ServicePlanKey | undefined,
        years: (args.years as number) ?? 1,
      });
    case 'register_agent_identity':
      return ad.register({
        preferredName: args.preferredName as string,
        tld: ((args.tld as string | undefined) ?? 'xyz') as RegistrationParams['tld'],
        registerBasename: (args.registerBasename as boolean) ?? true,
        basenameLabel: args.basenameLabel as string | undefined,
        registerEns: (args.registerEns as boolean) ?? false,
        ensLabel: args.ensLabel as string | undefined,
        emailEnabled: true,
        emailUsername: args.emailUsername as string | undefined,
        premiumPlan: args.premiumPlan as ServicePlanKey | undefined,
        years: (args.years as number) ?? 1,
        autoRenew: (args.autoRenew as boolean) ?? false,
        dnsTarget: args.dnsTarget as string | undefined,
        ownerAddress: args.ownerAddress as Address | undefined,
        wallet: args.wallet as Address | undefined,
      });
    case 'search_agents':
      return ad.search({
        q: args.q as string,
        framework: args.framework as string,
        capability: args.capability as string,
        limit: (args.limit as number) ?? 20,
      });
    case 'send_agent_email':
      return ad.sendEmail(args.agentId as string, {
        to: args.to as string | string[],
        fromAddress: args.fromAddress as string | undefined,
        subject: args.subject as string,
        text: args.text as string,
        replyTo: args.replyTo as string | undefined,
      });
    case 'list_agent_email':
      return ad.listEmail(args.agentId as string, { limit: (args.limit as number) ?? 20 });
    case 'update_primary_email':
      return ad.updatePrimaryEmail(args.agentId as string, args.username as string);
    case 'create_email_alias':
      return ad.createEmailAlias(args.agentId as string, args.username as string);
    case 'delete_email_alias':
      return ad.deleteEmailAlias(args.agentId as string, args.emailAddress as string);
    case 'list_dns_records':
      return ad.listDnsRecords(args.agentId as string);
    case 'create_dns_record':
      return ad.createDnsRecord(
        args.agentId as string,
        readDnsRecordArgs(args) as Omit<DnsRecord, 'id'>,
      );
    case 'update_dns_record':
      return ad.updateDnsRecord(
        args.agentId as string,
        args.recordId as string,
        readDnsRecordArgs(args),
      );
    case 'delete_dns_record':
      return ad.deleteDnsRecord(args.agentId as string, args.recordId as string);
    case 'get_renewal_status':
      return ad.getRenewalStatus(args.agentId as string);
    case 'fund_renewal_vault':
      return ad.fundRenewalVault(args.agentId as string, args.amountUsdc as string);
    case 'withdraw_renewal_vault':
      return ad.withdrawFromVault(args.agentId as string, args.amountUsdc as string);
    case 'enable_auto_renew':
      return ad.setAutoRenew(args.agentId as string, true);
    case 'reconfigure_ssl':
      return ad.reconfigureSsl(args.agentId as string);
    case 'get_service_plan':
      return ad.getServicePlan(args.agentId as string);
    case 'purchase_service_plan':
      return ad.purchaseServicePlan({
        agentId: args.agentId as string,
        plan: args.plan as Exclude<ServicePlanKey, 'included'>,
      });
    case 'set_registry_visibility':
      return ad.setRegistryVisibility(
        args.agentId as string,
        Boolean(args.registryHidden ?? args.hidden),
      );
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function readDnsRecordArgs(args: Record<string, unknown>): Partial<DnsRecord> {
  const record =
    args.record && typeof args.record === 'object'
      ? (args.record as Record<string, unknown>)
      : args;
  return {
    type: record.type as DnsRecord['type'] | undefined,
    name: record.name as string | undefined,
    value: record.value as string | undefined,
    ttl: record.ttl as number | undefined,
    priority: record.priority as number | null | undefined,
  };
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

async function responseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      message?: string;
      error?: string;
      code?: string;
      details?: unknown;
    };
    const detail = body.message ?? body.error;
    const code = body.code ?? body.error;
    const retryAfter =
      body.details && typeof body.details === 'object'
        ? (body.details as { retryAfterSeconds?: number }).retryAfterSeconds
        : undefined;
    const detailsMessage = detailsToMessage(body.details);
    const parts = [`HTTP ${res.status}`];
    if (code) parts.push(`[${code}]`);
    if (detail) parts.push(`: ${detail}`);
    if (detailsMessage && detailsMessage !== detail) parts.push(`: ${detailsMessage}`);
    if (retryAfter) parts.push(`(retry after ${retryAfter}s)`);
    return parts.join('');
  } catch {
    return `HTTP ${res.status}`;
  }
}

function detailsToMessage(details: unknown): string | null {
  if (!details) return null;
  if (typeof details === 'string') return details;
  if (typeof details !== 'object') return String(details);
  const record = details as Record<string, unknown>;
  if (typeof record.message === 'string') return record.message;
  if (typeof record.error === 'string') return record.error;
  try {
    return JSON.stringify(details);
  } catch {
    return null;
  }
}

function sameAddress(a: string, b: string): boolean {
  try {
    return getAddress(a as Address) === getAddress(b as Address);
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}
