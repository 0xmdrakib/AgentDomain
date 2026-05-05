/**
 * @agentdomain/agentkit-plugin
 *
 * AgentKit action provider that gives AgentKit-powered agents the ability to
 * register and manage their AgentDomain identity.
 *
 * Usage:
 *   import { AgentDomainActionProvider } from '@agentdomain/agentkit-plugin';
 *
 *   const agentkit = await AgentKit.from({
 *     walletProvider: cdpWalletProvider,
 *     actionProviders: [new AgentDomainActionProvider()],
 *   });
 */

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
import { base } from 'viem/chains';

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

interface WalletProvider {
  getAddress(): string;
  signTypedData?: (data: unknown) => Promise<string>;
  sendTransaction?: (tx: any) => Promise<string>;
}

/**
 * AgentKit-style action provider. The exact base class shape varies between
 * AgentKit versions; this implementation defines actions as a plain object
 * compatible with the action provider pattern.
 */
export class AgentDomainActionProvider {
  public readonly name = 'agentdomain';

  constructor(private readonly opts: { apiUrl?: string } = {}) {}

  /**
   * Returns the action definitions for AgentKit to register.
   */
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
    ];
  }

  private async register(walletProvider: WalletProvider, args: z.infer<typeof RegisterSchema>) {
    const wallet = walletProvider.getAddress() as Address;
    const env = (
      globalThis as typeof globalThis & {
        process?: { env?: Record<string, string | undefined> };
      }
    ).process?.env;

    const publicClient = createPublicClient({ chain: base, transport: http() });
    const walletClient = createWalletClient({
      chain: base,
      transport: http(),
      account: {
        address: wallet,
        signTypedData: walletProvider.signTypedData as
          | ((parameters: any) => Promise<string>)
          | undefined,
      } as never,
    });

    const ad = new AgentDomain({
      apiUrl: this.opts.apiUrl ?? 'https://api.agentdomain.xyz/v1',
      walletClient: walletClient as never,
      publicClient: publicClient as never,
    });

    const result = await ad.register({ ...args, wallet });

    let autoRenewMsg = '';
    if (args.autoRenew && env?.RENEWAL_VAULT_ADDRESS) {
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
            to: env.RENEWAL_VAULT_ADDRESS as Address,
            data,
          });
          autoRenewMsg = ` Auto-renew enabled via tx ${txHash}.`;
        } else {
          autoRenewMsg = ` (Cannot enable auto-renew because walletProvider lacks sendTransaction).`;
        }
      } catch (e) {
        autoRenewMsg = ` Failed to enable auto-renew: ${String(e)}`;
      }
    }

    return `Registered identity ${result.domain} (token #${result.nftTokenId}).${autoRenewMsg}`;
  }

  private async quote(_wp: WalletProvider, args: z.infer<typeof QuoteSchema>) {
    const ad = new AgentDomain({
      apiUrl: this.opts.apiUrl ?? 'https://api.agentdomain.xyz/v1',
    });
    const q = await ad.quote(args);
    return `Total: $${q.totalUsdc} USDC (domain $${q.domainCostUsdc} + service $${q.serviceFeeUsdc})`;
  }

  private async search(_wp: WalletProvider, args: z.infer<typeof SearchSchema>) {
    const ad = new AgentDomain({
      apiUrl: this.opts.apiUrl ?? 'https://api.agentdomain.xyz/v1',
    });
    const result = await ad.search(args);
    return `Found ${result.total} agents. First ${result.items.length}: ${result.items
      .map((a) => a.domain)
      .join(', ')}`;
  }
}

export default AgentDomainActionProvider;
