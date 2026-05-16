import { z } from 'zod';
import { AgentDomain } from '@agentdomain/sdk';
import { SUPPORTED_FRAMEWORKS, SUPPORTED_TLDS } from '@agentdomain/shared/constants';
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
  registerEns: z.boolean().default(false),
  dnsTarget: z.string().url().optional(),
  years: z.number().int().min(1).max(10).default(1),
  autoRenew: z.boolean().default(false),
});

const QuoteSchema = z.object({
  preferredName: z.string(),
  tld: z.enum(SUPPORTED_TLDS).default('xyz'),
  registerBasename: z.boolean().default(true),
  registerEns: z.boolean().default(false),
  years: z.number().int().min(1).max(10).default(1),
});

const SearchSchema = z.object({
  q: z.string().optional(),
  framework: z.enum(SUPPORTED_FRAMEWORKS).optional(),
  limit: z.number().default(20),
});

const SendEmailSchema = z.object({
  agentId: z.string(),
  to: z.union([z.string().email(), z.array(z.string().email()).min(1).max(10)]),
  subject: z.string().min(1).max(200),
  text: z.string().min(1).max(20_000),
});

const ListEmailSchema = z.object({
  agentId: z.string(),
  limit: z.number().int().min(1).max(100).default(20),
});

interface WalletProvider {
  getAddress(): string;
  signTypedData?: (data: unknown) => Promise<string>;
  sendTransaction?: (tx: unknown) => Promise<string>;
}

export interface AgentDomainActionProviderOptions {
  apiUrl?: string;
  baseRpcUrl?: string;
  renewalVaultAddress?: string;
  network?: 'base' | 'base-sepolia';
}

export class AgentDomainActionProvider {
  public readonly name = 'agentdomain';

  private readonly apiUrl: string;
  private readonly baseRpcUrl: string;
  private readonly renewalVaultAddress?: string;
  private readonly network: 'base' | 'base-sepolia';

  constructor(opts: AgentDomainActionProviderOptions = {}) {
    this.apiUrl = opts.apiUrl ?? 'https://agentdomain.xyz/api/v1';
    this.baseRpcUrl = opts.baseRpcUrl ?? 'https://mainnet.base.org';
    this.renewalVaultAddress = opts.renewalVaultAddress;
    this.network = opts.network ?? 'base';
  }

  getActions() {
    return [
      {
        name: 'register_agent_identity',
        description:
          'Register a complete agent identity bundle on AgentDomain: traditional domain, Basename on Base, DNS, SSL, and optional email. Pays in USDC on Base.',
        schema: RegisterSchema,
        invoke: this.register.bind(this),
      },
      {
        name: 'quote_agent_registration',
        description: 'Price an agent identity registration before committing.',
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
        description: 'Send text-only email from an email-enabled agent via AWS SES.',
        schema: SendEmailSchema,
        invoke: this.sendEmail.bind(this),
      },
      {
        name: 'list_agent_email',
        description: 'Query text-only agent email and extracted verification codes.',
        schema: ListEmailSchema,
        invoke: this.listEmail.bind(this),
      },
    ];
  }

  private async register(walletProvider: WalletProvider, args: z.infer<typeof RegisterSchema>) {
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
      } as never,
    });

    const ad = new AgentDomain({
      apiUrl: this.apiUrl,
      network: this.network,
      walletClient: walletClient as never,
      publicClient: publicClient as never,
    });

    const result = await ad.register({ ...args, wallet } as any);

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

  private async quote(_wp: WalletProvider, args: z.infer<typeof QuoteSchema>) {
    const ad = new AgentDomain({ apiUrl: this.apiUrl });
    const q = await ad.quote(args);
    return `Total: $${q.totalUsdc} USDC (domain $${q.domainCostUsdc} + service $${q.serviceFeeUsdc})`;
  }

  private async search(_wp: WalletProvider, args: z.infer<typeof SearchSchema>) {
    const ad = new AgentDomain({ apiUrl: this.apiUrl });
    const result = await ad.search(args);
    return `Found ${result.total} agents. First ${result.items.length}: ${result.items
      .map((a) => a.domain)
      .join(', ')}`;
  }

  private async sendEmail(_wp: WalletProvider, args: z.infer<typeof SendEmailSchema>) {
    const ad = new AgentDomain({ apiUrl: this.apiUrl });
    const result = await ad.sendEmail(args.agentId, {
      to: args.to,
      subject: args.subject,
      text: args.text,
    });
    return `Email sent via SES: ${result.id}`;
  }

  private async listEmail(_wp: WalletProvider, args: z.infer<typeof ListEmailSchema>) {
    const ad = new AgentDomain({ apiUrl: this.apiUrl });
    const result = await ad.listEmail(args.agentId, { limit: args.limit });
    return JSON.stringify(result, null, 2);
  }
}

export default AgentDomainActionProvider;
