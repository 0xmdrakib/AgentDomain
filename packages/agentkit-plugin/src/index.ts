import { z } from 'zod';
import { AgentDomain } from '@agentdomain/sdk';
import {
  AGENTDOMAIN_API_BASE_URL,
  SERVICE_PLAN_KEYS,
  SUPPORTED_FRAMEWORKS,
  SUPPORTED_TLDS,
} from '@agentdomain/shared/constants';
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  type Address,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';

const RegisterSchema = z.object({
  preferredName: z.string().min(3).max(63),
  tld: z.enum(SUPPORTED_TLDS).default('xyz'),
  registerBasename: z.boolean().default(true),
  basenameLabel: z.string().min(3).max(63).optional(),
  registerEns: z.boolean().default(false),
  ensLabel: z.string().min(3).max(63).optional(),
  ownerAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  emailEnabled: z.boolean().default(true),
  emailUsername: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/)
    .optional(),
  dnsTarget: z.string().url().optional(),
  years: z.number().int().min(1).max(10).default(1),
  autoRenew: z.boolean().default(false),
  premiumPlan: z.enum(SERVICE_PLAN_KEYS).default('included'),
});

const QuoteSchema = z.object({
  preferredName: z.string(),
  tld: z.enum(SUPPORTED_TLDS).default('xyz'),
  registerBasename: z.boolean().default(true),
  basenameLabel: z.string().min(3).max(63).optional(),
  registerEns: z.boolean().default(false),
  ensLabel: z.string().min(3).max(63).optional(),
  emailEnabled: z.boolean().default(true),
  emailUsername: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/)
    .optional(),
  years: z.number().int().min(1).max(10).default(1),
  premiumPlan: z.enum(SERVICE_PLAN_KEYS).default('included'),
});

const SearchSchema = z.object({
  q: z.string().optional(),
  framework: z.enum(SUPPORTED_FRAMEWORKS).optional(),
  capability: z.string().optional(),
  limit: z.number().default(20),
});

const SendEmailSchema = z.object({
  agentId: z.string(),
  to: z.union([z.string().email(), z.array(z.string().email()).min(1).max(10)]),
  subject: z.string().min(1).max(200),
  text: z.string().min(1).max(20_000),
  fromAddress: z.string().email().optional(),
});

const ListEmailSchema = z.object({
  agentId: z.string(),
  limit: z.number().int().min(1).max(100).default(20),
});

const RenewalStatusSchema = z.object({
  agentId: z.string().min(1),
});

const FundRenewalSchema = z.object({
  agentId: z.string().min(1),
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Use a USDC amount with up to 6 decimals'),
  enableAutoRenew: z.boolean().default(false),
});

const EnableAutoRenewSchema = z.object({
  agentId: z.string().min(1),
});

const SslReconfigureSchema = z.object({
  agentId: z.string().min(1),
});

const DnsRecordTypeSchema = z.enum(['A', 'AAAA', 'ALIAS', 'CNAME', 'MX', 'TXT', 'NS', 'SRV']);

const ListDnsSchema = z.object({
  agentId: z.string().min(1),
});

const CreateDnsSchema = z.object({
  agentId: z.string().min(1),
  type: DnsRecordTypeSchema,
  name: z.string().min(1).max(253),
  value: z.string().min(1).max(4096),
  ttl: z.number().int().min(60).max(3600).default(3600),
  priority: z.number().int().min(0).optional(),
});

const UpdateDnsSchema = CreateDnsSchema.partial().extend({
  agentId: z.string().min(1),
  recordId: z.string().min(1),
});

const DeleteDnsSchema = z.object({
  agentId: z.string().min(1),
  recordId: z.string().min(1),
});

const WithdrawRenewalSchema = z.object({
  agentId: z.string().min(1),
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Use a USDC amount with up to 6 decimals'),
});

const ServicePlanStatusSchema = z.object({
  agentId: z.string().min(1),
});

const PurchaseServicePlanSchema = z.object({
  agentId: z.string().min(1),
  plan: z.enum(['pro', 'enterprise']),
});

const SetRegistryVisibilitySchema = z.object({
  agentId: z.string().min(1),
  registryHidden: z.boolean(),
});

const UpdatePrimaryEmailSchema = z.object({
  agentId: z.string().min(1),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/),
});

const CreateEmailAliasSchema = UpdatePrimaryEmailSchema;

const DeleteEmailAliasSchema = z.object({
  agentId: z.string().min(1),
  emailAddress: z.string().email(),
});

interface WalletProvider {
  getAddress(): string;
  signTypedData?: (data: unknown) => Promise<string>;
  signMessage?: (message: string) => Promise<string>;
  sendTransaction?: (tx: unknown) => Promise<string>;
}

export interface AgentDomainActionProviderOptions {
  apiUrl?: string;
  apiKey?: string;
  baseRpcUrl?: string;
  renewalVaultAddress?: string;
  network?: 'base' | 'base-sepolia';
}

export class AgentDomainActionProvider {
  public readonly name = 'agentdomain';

  private readonly apiUrl: string;
  private readonly apiKey?: string;
  private readonly baseRpcUrl: string;
  private readonly renewalVaultAddress?: string;
  private readonly network: 'base' | 'base-sepolia';

  constructor(opts: AgentDomainActionProviderOptions = {}) {
    this.apiUrl = opts.apiUrl ?? AGENTDOMAIN_API_BASE_URL;
    this.apiKey = opts.apiKey;
    this.baseRpcUrl = opts.baseRpcUrl ?? 'https://mainnet.base.org';
    this.renewalVaultAddress = opts.renewalVaultAddress;
    this.network = opts.network ?? 'base';
  }

  private createAgentDomain(walletProvider: WalletProvider) {
    const wallet = walletProvider.getAddress() as Address;
    const chain = this.network === 'base-sepolia' ? baseSepolia : base;

    const publicClient = createPublicClient({ chain, transport: http(this.baseRpcUrl) });
    const walletClient = createWalletClient({
      chain,
      transport: http(this.baseRpcUrl),
      account: {
        address: wallet,
        signTypedData: walletProvider.signTypedData as
          | ((parameters: any) => Promise<string>)
          | undefined,
        signMessage: walletProvider.signMessage
          ? (parameters: { message: string }) => walletProvider.signMessage!(parameters.message)
          : undefined,
      } as never,
    });

    const ad = new AgentDomain({
      apiUrl: this.apiUrl,
      apiKey: this.apiKey,
      network: this.network,
      renewalVaultAddress: this.renewalVaultAddress as Address | undefined,
      walletClient: walletClient as never,
      publicClient: publicClient as never,
    });

    return { ad, wallet, walletClient, publicClient, chain };
  }

  getActions() {
    return [
      {
        name: 'register_agent_identity',
        description:
          'Register a complete agent identity bundle on AgentDomain. Domain, DNS, included email setup, SSL certification, AgentID NFT orchestration, and platform fee are included by default. Basename and ENS are optional paid add-ons. Pays in USDC on Base.',
        schema: RegisterSchema,
        invoke: this.register.bind(this),
      },
      {
        name: 'quote_agent_registration',
        description:
          'Price an agent identity registration before committing. Quote includes the annual platform fee with email setup, SSL certification, and AgentID NFT orchestration; Basename and ENS only charge when enabled.',
        schema: QuoteSchema,
        invoke: this.quote.bind(this),
      },
      {
        name: 'search_agents',
        description: 'Search the public AgentDomain registry.',
        schema: SearchSchema,
        invoke: this.search.bind(this),
      },
      {
        name: 'send_agent_email',
        description:
          'Send text-only email from an agent primary email or active alias via AWS SES.',
        schema: SendEmailSchema,
        invoke: this.sendEmail.bind(this),
      },
      {
        name: 'list_agent_email',
        description: 'Query text-only agent email and extracted verification codes.',
        schema: ListEmailSchema,
        invoke: this.listEmail.bind(this),
      },
      {
        name: 'get_renewal_status',
        description:
          'Get exact next renewal amount, shortfall, vault balance, expiry date, and auto-renew state for an AgentDomain identity.',
        schema: RenewalStatusSchema,
        invoke: this.renewalStatus.bind(this),
      },
      {
        name: 'fund_renewal_vault',
        description:
          'Deposit USDC from the connected wallet into one AgentID renewal vault. Anyone can fund; only the AgentID owner can withdraw or enable auto-renew. Call get_renewal_status first and usually deposit the returned shortfall.',
        schema: FundRenewalSchema,
        invoke: this.fundRenewal.bind(this),
      },
      {
        name: 'enable_auto_renew',
        description:
          'Enable RenewalVault auto-renew. Requires the wallet provider to be the AgentID NFT owner and support sendTransaction.',
        schema: EnableAutoRenewSchema,
        invoke: this.enableAutoRenew.bind(this),
      },
      {
        name: 'reconfigure_ssl',
        description:
          'Rebuild the Cloudflare SaaS SSL hostname and sync the required Spaceship DNS validation records for an existing agent.',
        schema: SslReconfigureSchema,
        invoke: this.reconfigureSsl.bind(this),
      },
      {
        name: 'list_dns_records',
        description: 'List DNS records for an AgentDomain identity.',
        schema: ListDnsSchema,
        invoke: this.listDns.bind(this),
      },
      {
        name: 'create_dns_record',
        description: 'Create a user-managed DNS record and sync it to the domain provider.',
        schema: CreateDnsSchema,
        invoke: this.createDns.bind(this),
      },
      {
        name: 'update_dns_record',
        description: 'Update a user-managed DNS record and sync it to the domain provider.',
        schema: UpdateDnsSchema,
        invoke: this.updateDns.bind(this),
      },
      {
        name: 'delete_dns_record',
        description: 'Delete a user-managed DNS record and sync the domain provider state.',
        schema: DeleteDnsSchema,
        invoke: this.deleteDns.bind(this),
      },
      {
        name: 'withdraw_renewal_vault',
        description:
          'Withdraw unused USDC from an AgentID renewal vault. Requires the AgentID NFT owner wallet.',
        schema: WithdrawRenewalSchema,
        invoke: this.withdrawRenewal.bind(this),
      },
      {
        name: 'get_service_plan',
        description: 'Get the current per-agent Premium Plan, limits, and billing state.',
        schema: ServicePlanStatusSchema,
        invoke: this.getServicePlan.bind(this),
      },
      {
        name: 'purchase_service_plan',
        description:
          'Upgrade one agent to an AgentDomain Pro or Enterprise Premium Plan using x402 USDC payment.',
        schema: PurchaseServicePlanSchema,
        invoke: this.purchaseServicePlan.bind(this),
      },
      {
        name: 'set_registry_visibility',
        description:
          'Hide or show one agent in the public AgentDomain registry. Hiding requires an active Pro or Enterprise Premium Plan.',
        schema: SetRegistryVisibilitySchema,
        invoke: this.setRegistryVisibility.bind(this),
      },
      {
        name: 'update_primary_email',
        description:
          'Change one agent primary email username. The old primary address stops receiving new mail.',
        schema: UpdatePrimaryEmailSchema,
        invoke: this.updatePrimaryEmail.bind(this),
      },
      {
        name: 'create_email_alias',
        description:
          'Create an extra receive-and-send alias for one agent. Requires available Pro or Enterprise alias capacity.',
        schema: CreateEmailAliasSchema,
        invoke: this.createEmailAlias.bind(this),
      },
      {
        name: 'delete_email_alias',
        description: 'Delete one active email alias from an agent.',
        schema: DeleteEmailAliasSchema,
        invoke: this.deleteEmailAlias.bind(this),
      },
    ];
  }

  private async register(walletProvider: WalletProvider, args: z.infer<typeof RegisterSchema>) {
    const { ad, wallet } = this.createAgentDomain(walletProvider);

    const result = await ad.register({ ...args, emailEnabled: true, wallet } as any);

    let autoRenewMsg = '';
    if (args.autoRenew && this.renewalVaultAddress) {
      try {
        if (walletProvider.sendTransaction) {
          const data = encodeFunctionData({
            abi: [
              {
                type: 'function',
                name: 'setAutoRenew',
                inputs: [
                  { name: 'tokenId', type: 'uint256' },
                  { name: 'enabled', type: 'bool' },
                ],
              },
            ],
            functionName: 'setAutoRenew',
            args: [BigInt(result.nftTokenId), true],
          });
          const txHash = await walletProvider.sendTransaction({
            to: this.renewalVaultAddress as Address,
            data,
          });
          autoRenewMsg = ` Auto-renew enabled via tx ${txHash}.`;
        } else {
          autoRenewMsg =
            ' (Cannot enable auto-renew because walletProvider lacks sendTransaction).';
        }
      } catch (e) {
        autoRenewMsg = ` Failed to enable auto-renew: ${String(e)}`;
      }
    }

    return `Registered identity ${result.domain} (token #${result.nftTokenId}).${autoRenewMsg}`;
  }

  private async renewalStatus(
    walletProvider: WalletProvider,
    args: z.infer<typeof RenewalStatusSchema>,
  ) {
    const { ad } = this.createAgentDomain(walletProvider);
    const status = await ad.getRenewalStatus(args.agentId);
    return `Renewal status for ${status.domain}: next renewal $${status.nextRenewalAmountUsdc}, vault balance $${status.vaultBalanceUsdc}, shortfall $${status.shortfallUsdc}, expires ${status.expiresAt ?? 'unknown'}, renewable from ${status.renewableFrom ?? 'unknown'}, auto-renew ${status.autoRenewEnabled ? 'enabled' : 'off'}.`;
  }

  private async fundRenewal(
    walletProvider: WalletProvider,
    args: z.infer<typeof FundRenewalSchema>,
  ) {
    const { ad } = this.createAgentDomain(walletProvider);
    const result = await ad.fundRenewalVault(args.agentId, args.amountUsdc);
    let message = `Deposited $${args.amountUsdc} USDC into the renewal vault for ${result.domain}. Vault balance is now ${result.vaultBalance} atomic USDC.`;
    if (args.enableAutoRenew) {
      message += ` ${await this.enableAutoRenew(walletProvider, { agentId: args.agentId })}`;
    }
    return message;
  }

  private async enableAutoRenew(
    walletProvider: WalletProvider,
    args: z.infer<typeof EnableAutoRenewSchema>,
  ) {
    if (!this.renewalVaultAddress) {
      throw new Error('renewalVaultAddress is required to enable auto-renew.');
    }
    if (!walletProvider.sendTransaction) {
      throw new Error('walletProvider.sendTransaction is required to enable auto-renew.');
    }

    const { ad, wallet } = this.createAgentDomain(walletProvider);
    const status = await ad.getRenewalStatus(args.agentId);
    if (!status.tokenId) throw new Error('AgentID NFT is not minted yet.');
    if (status.ownerAddress && status.ownerAddress.toLowerCase() !== wallet.toLowerCase()) {
      throw new Error(`Only the AgentID NFT owner (${status.ownerAddress}) can enable auto-renew.`);
    }

    const data = encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'setAutoRenew',
          inputs: [
            { name: 'tokenId', type: 'uint256' },
            { name: 'enabled', type: 'bool' },
          ],
        },
      ],
      functionName: 'setAutoRenew',
      args: [BigInt(status.tokenId), true],
    });
    const txHash = await walletProvider.sendTransaction({
      to: this.renewalVaultAddress as Address,
      data,
    });
    return `Auto-renew enabled via tx ${txHash}.`;
  }

  private async reconfigureSsl(
    walletProvider: WalletProvider,
    args: z.infer<typeof SslReconfigureSchema>,
  ) {
    const { ad } = this.createAgentDomain(walletProvider);
    const result = await ad.reconfigureSsl(args.agentId);
    return `SSL reconfigured for ${result.domain}. Cloudflare hostname ${result.cloudflareCustomHostnameId} is ${result.sslStatus} and ${result.validationRecordsCount} validation record(s) were synced.`;
  }

  private async listDns(walletProvider: WalletProvider, args: z.infer<typeof ListDnsSchema>) {
    const { ad } = this.createAgentDomain(walletProvider);
    const records = await ad.listDnsRecords(args.agentId);
    return JSON.stringify(records, null, 2);
  }

  private async createDns(walletProvider: WalletProvider, args: z.infer<typeof CreateDnsSchema>) {
    const { ad } = this.createAgentDomain(walletProvider);
    const { agentId, ...record } = args;
    const result = await ad.createDnsRecord(agentId, record);
    return `Created ${result.type} record ${result.name} -> ${result.value}.`;
  }

  private async updateDns(walletProvider: WalletProvider, args: z.infer<typeof UpdateDnsSchema>) {
    const { ad } = this.createAgentDomain(walletProvider);
    const { agentId, recordId, ...record } = args;
    const result = await ad.updateDnsRecord(agentId, recordId, record);
    return `Updated ${result.type} record ${result.name} -> ${result.value}.`;
  }

  private async deleteDns(walletProvider: WalletProvider, args: z.infer<typeof DeleteDnsSchema>) {
    const { ad } = this.createAgentDomain(walletProvider);
    await ad.deleteDnsRecord(args.agentId, args.recordId);
    return `Deleted DNS record ${args.recordId}.`;
  }

  private async withdrawRenewal(
    walletProvider: WalletProvider,
    args: z.infer<typeof WithdrawRenewalSchema>,
  ) {
    if (!walletProvider.sendTransaction) {
      throw new Error('walletProvider.sendTransaction is required to withdraw vault funds.');
    }
    const { ad } = this.createAgentDomain(walletProvider);
    const tx = await ad.withdrawFromVault(args.agentId, args.amountUsdc);
    const txHash = await walletProvider.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value,
      chainId: tx.chainId,
    });
    return `Submitted renewal vault withdrawal for $${args.amountUsdc} USDC via tx ${txHash}.`;
  }

  private async getServicePlan(
    walletProvider: WalletProvider,
    args: z.infer<typeof ServicePlanStatusSchema>,
  ) {
    const { ad } = this.createAgentDomain(walletProvider);
    const result = await ad.getServicePlan(args.agentId);
    return `Premium Plan for ${result.domain}: ${result.entitlement.plan} (${result.entitlement.status}), email ${result.entitlement.limits.emailPerHour}/hour and ${result.entitlement.limits.emailPerDay}/day, ${result.entitlement.limits.apiKeys} API key(s), ${result.entitlement.limits.dnsRecords} DNS records, registry hidden ${result.registryVisibility.hidden}.`;
  }

  private async purchaseServicePlan(
    walletProvider: WalletProvider,
    args: z.infer<typeof PurchaseServicePlanSchema>,
  ) {
    const { ad } = this.createAgentDomain(walletProvider);
    const result = await ad.purchaseServicePlan(args);
    return `Purchased ${result.entitlement.plan} Premium Plan for ${result.domain}. Current period ends ${result.entitlement.currentPeriodEnd ?? 'unknown'}.`;
  }

  private async setRegistryVisibility(
    walletProvider: WalletProvider,
    args: z.infer<typeof SetRegistryVisibilitySchema>,
  ) {
    const { ad } = this.createAgentDomain(walletProvider);
    const result = await ad.setRegistryVisibility(args.agentId, args.registryHidden);
    return `${result.domain} is now ${result.registryVisibility.hidden ? 'hidden from' : 'visible in'} the public registry.`;
  }

  private async quote(walletProvider: WalletProvider, args: z.infer<typeof QuoteSchema>) {
    const { ad } = this.createAgentDomain(walletProvider);
    const q = await ad.quote(args);
    const basenamePart = Number(q.basenameCostUsdc) > 0 ? ` + Basename $${q.basenameCostUsdc}` : '';
    const ensPart = Number(q.ensCostUsdc) > 0 ? ` + ENS $${q.ensCostUsdc}` : '';
    const planPart = Number(q.premiumPlanFeeUsdc ?? 0) > 0 ? ` + ${q.premiumPlanLabel} $${q.premiumPlanFeeUsdc}` : '';
    return `Total: $${q.totalUsdc} USDC (domain $${q.domainCostUsdc} + platform $${q.platformFeeUsdc ?? q.serviceFeeUsdc}, email and SSL included${basenamePart}${ensPart}${planPart})`;
  }

  private async search(walletProvider: WalletProvider, args: z.infer<typeof SearchSchema>) {
    const { ad } = this.createAgentDomain(walletProvider);
    const result = await ad.search(args);
    return `Found ${result.total} agents. First ${result.items.length}: ${result.items
      .map((a) => a.domain)
      .join(', ')}`;
  }

  private async sendEmail(walletProvider: WalletProvider, args: z.infer<typeof SendEmailSchema>) {
    const { ad } = this.createAgentDomain(walletProvider);
    const result = await ad.sendEmail(args.agentId, {
      to: args.to,
      fromAddress: args.fromAddress,
      subject: args.subject,
      text: args.text,
    });
    return `Email sent via SES: ${result.id}`;
  }

  private async listEmail(walletProvider: WalletProvider, args: z.infer<typeof ListEmailSchema>) {
    const { ad } = this.createAgentDomain(walletProvider);
    const result = await ad.listEmail(args.agentId, { limit: args.limit });
    return JSON.stringify(result, null, 2);
  }

  private async updatePrimaryEmail(
    walletProvider: WalletProvider,
    args: z.infer<typeof UpdatePrimaryEmailSchema>,
  ) {
    const { ad } = this.createAgentDomain(walletProvider);
    const result = await ad.updatePrimaryEmail(args.agentId, args.username);
    return result.message;
  }

  private async createEmailAlias(
    walletProvider: WalletProvider,
    args: z.infer<typeof CreateEmailAliasSchema>,
  ) {
    const { ad } = this.createAgentDomain(walletProvider);
    const result = await ad.createEmailAlias(args.agentId, args.username);
    return `Created email alias ${result.address.emailAddress}.`;
  }

  private async deleteEmailAlias(
    walletProvider: WalletProvider,
    args: z.infer<typeof DeleteEmailAliasSchema>,
  ) {
    const { ad } = this.createAgentDomain(walletProvider);
    await ad.deleteEmailAlias(args.agentId, args.emailAddress);
    return `Deleted email alias ${args.emailAddress}.`;
  }
}

export default AgentDomainActionProvider;
