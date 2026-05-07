import { AgentDomain } from '@agentdomain/sdk';
import { SUPPORTED_TLDS } from '@agentdomain/shared/constants';
import { createPublicClient, createWalletClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { z } from 'zod';

interface IAgentRuntime {
  getSetting(key: string): string | undefined;
  character?: { settings?: { secrets?: Record<string, string> } };
}

interface Memory {
  content: { text: string };
}

function getClients(runtime: IAgentRuntime) {
  const apiUrl = runtime.getSetting('AGENTDOMAIN_API_URL') ?? 'https://api.agentdomain.xyz/v1';
  const pk = runtime.getSetting('AGENT_PRIVATE_KEY');
  if (!pk) throw new Error('AGENT_PRIVATE_KEY not set');

  const account = privateKeyToAccount(pk as `0x${string}`);
  const rpc = runtime.getSetting('BASE_RPC_URL') ?? 'https://mainnet.base.org';
  const network =
    (runtime.getSetting('AGENTDOMAIN_NETWORK') as 'base' | 'base-sepolia') ?? 'base';
  const chain = network === 'base-sepolia' ? baseSepolia : base;

  const walletClient = createWalletClient({ account, chain, transport: http(rpc) });
  const publicClient = createPublicClient({ chain, transport: http(rpc) });

  const ad = new AgentDomain({
    apiUrl,
    network,
    walletClient: walletClient as never,
    publicClient: publicClient as never,
  });

  return { ad, account, walletClient, publicClient, network, chain, rpc };
}

const TLD_PATTERN = new RegExp(String.raw`([a-z0-9-]{3,63})\.([a-z]{2,20})\b`, 'i');

const registerSchema = z.object({
  preferredName: z.string(),
  tld: z.enum(SUPPORTED_TLDS).default('xyz'),
  emailEnabled: z.boolean().default(false),
  years: z.number().int().min(1).max(10).default(1),
  autoRenew: z.boolean().default(false),
});

function parseParamsFromText(text: string): {
  preferredName: string;
  tld: string;
  registerBasename: boolean;
  registerEns: boolean;
  emailEnabled: boolean;
  years: number;
  autoRenew: boolean;
} {
  const m = text.match(TLD_PATTERN);
  const lower = text.toLowerCase();
  const yearsMatch = lower.match(/([1-9]|10)\s*years?/);
  return {
    preferredName: m?.[1]?.toLowerCase() ?? 'agent',
    tld: m?.[2]?.toLowerCase() ?? 'xyz',
    registerBasename: !lower.includes('no basename'),
    registerEns: lower.includes('ens'),
    emailEnabled: lower.includes('email') || lower.includes('inbox'),
    years: yearsMatch ? parseInt(yearsMatch[1]!, 10) : 1,
    autoRenew:
      lower.includes('auto renew') || lower.includes('auto-renew') || lower.includes('autorenew'),
  };
}

export const registerIdentityAction = {
  name: 'REGISTER_IDENTITY',
  description:
    'Register a complete agent identity bundle on AgentDomain (domain + Basename + DNS + SSL).',
  similes: ['CLAIM_DOMAIN', 'CREATE_IDENTITY', 'GET_DOMAIN'],
  examples: [
    [
      { user: 'user1', content: { text: 'Register me as helpful-bot.ai with email' } },
      {
        user: 'agent',
        content: {
          text: "I'll register helpful-bot.ai with email infrastructure now.",
          action: 'REGISTER_IDENTITY',
        },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime, _message?: Memory) =>
    Boolean(runtime.getSetting('AGENT_PRIVATE_KEY')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const params = parseParamsFromText(message.content.text);
    const validated = registerSchema.parse(params);

    const { ad, account, walletClient, chain, rpc } = getClients(runtime);

    const result = await ad.register({
      ...validated,
      wallet: account.address,
    } as any);

    let autoRenewMsg = '';
    if (validated.autoRenew) {
      const vaultAddress = runtime.getSetting('RENEWAL_VAULT_ADDRESS');
      if (vaultAddress) {
        try {
          const txHash = await walletClient.writeContract({
            address: vaultAddress as `0x${string}`,
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
            chain,
            account,
          });
          autoRenewMsg = ` Auto-renew enabled via tx ${txHash}.`;
        } catch (e) {
          autoRenewMsg = ` Failed to enable auto-renew automatically: ${String(e)}`;
        }
      } else {
        autoRenewMsg =
          ' (Requires RENEWAL_VAULT_ADDRESS env var to enable auto-renew on-chain).';
      }
    }

    return {
      text: `Registered ${result.domain}${result.basename ? ` and ${result.basename}` : ''}. Token #${result.nftTokenId}.${autoRenewMsg}`,
      data: result,
    };
  },
};

export const searchAgentsAction = {
  name: 'SEARCH_AGENTS',
  description: 'Search the public AgentDomain registry by name, capability, or framework.',
  similes: ['FIND_AGENT', 'DISCOVER_AGENT'],
  examples: [],
  validate: async () => true,
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime);
    const q = message.content.text;
    const result = await ad.search({ q, limit: 10 });
    return {
      text: `Found ${result.items.length} agents.`,
      data: result,
    };
  },
};

export const agentDomainPlugin = {
  name: 'agentdomain',
  description:
    'Identity infrastructure for AI agents on Base (domain + Basename + DNS + email + SSL).',
  actions: [registerIdentityAction, searchAgentsAction],
  evaluators: [],
  providers: [],
};

export default agentDomainPlugin;
