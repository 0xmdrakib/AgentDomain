import { AgentDomain } from '@agentdomain/sdk';
import {
  AGENTDOMAIN_API_BASE_URL,
  SERVICE_PLAN_KEYS,
  SUPPORTED_TLDS,
} from '@agentdomain/shared/constants';
import type { ServicePlanKey } from '@agentdomain/shared';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  encodeFunctionData,
} from 'viem';
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

function getClients(runtime: IAgentRuntime, opts: { requireWallet?: boolean } = {}) {
  const apiUrl = runtime.getSetting('AGENTDOMAIN_API_URL') ?? AGENTDOMAIN_API_BASE_URL;
  const apiKey = runtime.getSetting('AGENTDOMAIN_API_KEY');
  const pk = runtime.getSetting('AGENT_PRIVATE_KEY');
  const rpc = runtime.getSetting('BASE_RPC_URL') ?? 'https://mainnet.base.org';
  const network = (runtime.getSetting('AGENTDOMAIN_NETWORK') as 'base' | 'base-sepolia') ?? 'base';
  const chain = network === 'base-sepolia' ? baseSepolia : base;

  if (!pk) {
    if (opts.requireWallet) throw new Error('AGENT_PRIVATE_KEY not set');
    const ad = new AgentDomain({ apiUrl, apiKey, network });
    return { ad, account: null, walletClient: null, publicClient: null, network, chain, rpc };
  }

  const account = privateKeyToAccount(pk as `0x${string}`);
  const walletClient = createWalletClient({ account, chain, transport: http(rpc) });
  const publicClient = createPublicClient({ chain, transport: http(rpc) });

  const ad = new AgentDomain({
    apiUrl,
    apiKey,
    network,
    walletClient: walletClient as never,
    publicClient: publicClient as never,
  });

  return { ad, account, walletClient, publicClient, network, chain, rpc };
}

const TLD_PATTERN = new RegExp(String.raw`([a-z0-9-]{3,63})\.([a-z]{2,20})\b`, 'i');
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const AMOUNT_PATTERN = /\$?\s*(\d+(?:\.\d{1,6})?)\s*(?:usdc)?/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const EMAIL_GLOBAL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const EMAIL_USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/;

const registerSchema = z.object({
  preferredName: z.string(),
  tld: z.enum(SUPPORTED_TLDS).default('xyz'),
  registerBasename: z.boolean().default(true),
  registerEns: z.boolean().default(false),
  emailEnabled: z.boolean().default(true),
  emailUsername: z
    .string()
    .trim()
    .toLowerCase()
    .regex(EMAIL_USERNAME_PATTERN)
    .default('agent'),
  years: z.number().int().min(1).max(10).default(1),
  autoRenew: z.boolean().default(false),
  premiumPlan: z.enum(SERVICE_PLAN_KEYS).default('included'),
});

const dnsRecordSchema = z.object({
  type: z.enum(['A', 'AAAA', 'ALIAS', 'CNAME', 'MX', 'TXT', 'NS', 'SRV']),
  name: z.string(),
  value: z.string(),
  ttl: z.number().int().min(60).max(3600).default(3600),
  priority: z.number().int().min(0).optional(),
});

function parseParamsFromText(text: string): {
  preferredName: string;
  tld: string;
  registerBasename: boolean;
  registerEns: boolean;
  emailEnabled: boolean;
  emailUsername: string;
  years: number;
  autoRenew: boolean;
  premiumPlan: ServicePlanKey;
} {
  const m = text.match(TLD_PATTERN);
  const lower = text.toLowerCase();
  const yearsMatch = lower.match(/([1-9]|10)\s*years?/);
  const noBasename =
    lower.includes('no basename') ||
    lower.includes('without basename') ||
    lower.includes('skip basename');
  const noEns =
    lower.includes('no ens') || lower.includes('without ens') || lower.includes('skip ens');
  const wantsEns = /\bens\b/.test(lower);
  return {
    preferredName: m?.[1]?.toLowerCase() ?? 'agent',
    tld: m?.[2]?.toLowerCase() ?? 'xyz',
    registerBasename: !noBasename,
    registerEns: wantsEns && !noEns,
    emailEnabled: true,
    emailUsername: parseEmailUsername(text) ?? 'agent',
    years: yearsMatch ? parseInt(yearsMatch[1]!, 10) : 1,
    autoRenew:
      lower.includes('auto renew') || lower.includes('auto-renew') || lower.includes('autorenew'),
    premiumPlan: parseRegistrationPlan(lower),
  };
}

function requireAgentId(text: string): string {
  const agentId = text.match(UUID_PATTERN)?.[0];
  if (!agentId) throw new Error('Agent ID UUID is required');
  return agentId;
}

function parseAmountUsdc(text: string): string {
  const amount = text.match(AMOUNT_PATTERN)?.[1];
  if (!amount) throw new Error('USDC amount is required');
  return amount;
}

function parseRegistrationPlan(lower: string): ServicePlanKey {
  if (lower.includes('enterprise')) return 'enterprise';
  if (lower.includes('pro')) return 'pro';
  return 'included';
}

function parsePlan(text: string): { plan: 'pro' | 'enterprise' } {
  const lower = text.toLowerCase();
  const plan = lower.includes('enterprise') ? 'enterprise' : 'pro';
  return { plan };
}

function parseDnsRecord(text: string) {
  const lower = text.toLowerCase();
  const typeMatch = text.match(/\b(A|AAAA|ALIAS|CNAME|MX|TXT|NS|SRV)\b/i);
  const nameMatch = text.match(/\bname[:=]\s*([^\s]+)/i);
  const valueMatch = text.match(/\bvalue[:=]\s*([^\s]+)/i);
  const ttlMatch = text.match(/\bttl[:=]\s*(\d+)/i);
  const priorityMatch = text.match(/\bpriority[:=]\s*(\d+)/i);
  const parsed = dnsRecordSchema.parse({
    type: typeMatch?.[1]?.toUpperCase() ?? (lower.includes('txt') ? 'TXT' : 'A'),
    name: nameMatch?.[1] ?? '@',
    value: valueMatch?.[1] ?? text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] ?? '',
    ttl: ttlMatch ? Number(ttlMatch[1]) : 3600,
    priority: priorityMatch ? Number(priorityMatch[1]) : undefined,
  });
  return parsed;
}

function parseEmailUsername(text: string): string | null {
  const explicit =
    text.match(/\b(?:email\s+username|primary\s+email|username|alias)[:=]?\s*([a-z0-9._+-]{1,64})/i)?.[1] ??
    text.match(EMAIL_PATTERN)?.[0]?.split('@')[0];
  const username = explicit?.trim().toLowerCase();
  return username && EMAIL_USERNAME_PATTERN.test(username) ? username : null;
}

function parseEmailRequest(text: string) {
  const fromAddress = text.match(/\bfrom[:=]\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1];
  const explicitTo = text.match(/\bto[:=]\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1];
  const emails = text.match(EMAIL_GLOBAL_PATTERN) ?? [];
  const to = explicitTo ?? emails.find((email) => email.toLowerCase() !== fromAddress?.toLowerCase());
  if (!to) throw new Error('Recipient email address is required');
  const subject = text.match(/\bsubject[:=]\s*([^|]+)/i)?.[1]?.trim() ?? 'AgentDomain message';
  const body =
    text.match(/\b(?:text|body|message)[:=]\s*([\s\S]+)/i)?.[1]?.trim() ??
    text.replace(to, '').trim();
  return { to, fromAddress, subject, text: body || 'Hello from AgentDomain.' };
}

export const quoteRegistrationAction = {
  name: 'QUOTE_AGENT_REGISTRATION',
  description: 'Quote an AgentDomain registration before paying.',
  similes: ['PRICE_DOMAIN', 'REGISTRATION_QUOTE', 'QUOTE_IDENTITY'],
  examples: [],
  validate: async () => true,
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const params = parseParamsFromText(message.content.text);
    const { ad } = getClients(runtime);
    const quote = await ad.quote(params);
    return {
      text: `Total: $${quote.totalUsdc} USDC for ${quote.domain}. Domain $${quote.domainCostUsdc}, platform $${quote.platformFeeUsdc ?? quote.serviceFeeUsdc}; email and SSL are included.`,
      data: quote,
    };
  },
};

export const registerIdentityAction = {
  name: 'REGISTER_IDENTITY',
  description:
    'Register a complete agent identity bundle on AgentDomain. Domain, DNS, email setup, SSL certification, AgentID NFT orchestration, and platform fee are included by default. Users can say "no basename" to skip Basename, "with ENS" to add ENS, and "email username support" to customize the primary inbox.',
  similes: ['CLAIM_DOMAIN', 'CREATE_IDENTITY', 'GET_DOMAIN'],
  examples: [
    [
      { user: 'user1', content: { text: 'Register me as helpful-bot.ai email username support' } },
      {
        user: 'agent',
        content: {
          text: "I'll register helpful-bot.ai with included email and SSL infrastructure now.",
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

    const { ad, account, walletClient, chain } = getClients(runtime, { requireWallet: true });
    if (!account || !walletClient) throw new Error('AGENT_PRIVATE_KEY not set');

    const result = await ad.register({
      ...validated,
      emailEnabled: true,
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
        autoRenewMsg = ' (Requires RENEWAL_VAULT_ADDRESS env var to enable auto-renew on-chain).';
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

export const listEmailAction = {
  name: 'LIST_AGENT_EMAIL',
  description:
    'List text-only email messages and extracted verification codes for an AgentDomain identity.',
  similes: ['CHECK_EMAIL', 'READ_INBOX'],
  examples: [],
  validate: async (runtime: IAgentRuntime) => Boolean(runtime.getSetting('AGENT_PRIVATE_KEY')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime);
    const agentId = message.content.text.match(/[0-9a-f-]{36}/i)?.[0];
    if (!agentId) throw new Error('Agent ID UUID is required to list email');
    const result = await ad.listEmail(agentId, { limit: 20 });
    return { text: `Found ${result.messages.length} messages.`, data: result };
  },
};

export const sendEmailAction = {
  name: 'SEND_AGENT_EMAIL',
  description: 'Send text-only email from an AgentDomain primary address or active alias.',
  similes: ['SEND_EMAIL', 'EMAIL_FROM_AGENT'],
  examples: [],
  validate: async (runtime: IAgentRuntime) =>
    Boolean(runtime.getSetting('AGENT_PRIVATE_KEY') || runtime.getSetting('AGENTDOMAIN_API_KEY')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime);
    const agentId = requireAgentId(message.content.text);
    const payload = parseEmailRequest(message.content.text);
    const result = await ad.sendEmail(agentId, payload);
    return { text: `Email sent: ${result.id}.`, data: result };
  },
};

export const updatePrimaryEmailAction = {
  name: 'UPDATE_PRIMARY_EMAIL',
  description:
    'Change an AgentDomain primary email username. The old primary address stops receiving new mail.',
  similes: ['CHANGE_PRIMARY_EMAIL', 'RENAME_EMAIL'],
  examples: [],
  validate: async (runtime: IAgentRuntime) =>
    Boolean(runtime.getSetting('AGENT_PRIVATE_KEY') || runtime.getSetting('AGENTDOMAIN_API_KEY')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime);
    const agentId = requireAgentId(message.content.text);
    const username = parseEmailUsername(message.content.text);
    if (!username) throw new Error('New email username is required');
    const result = await ad.updatePrimaryEmail(agentId, username);
    return { text: result.message, data: result };
  },
};

export const createEmailAliasAction = {
  name: 'CREATE_EMAIL_ALIAS',
  description:
    'Create a receive-and-send email alias for an AgentDomain identity. Requires available Pro or Enterprise alias capacity.',
  similes: ['ADD_EMAIL_ALIAS', 'CREATE_ALIAS'],
  examples: [],
  validate: async (runtime: IAgentRuntime) =>
    Boolean(runtime.getSetting('AGENT_PRIVATE_KEY') || runtime.getSetting('AGENTDOMAIN_API_KEY')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime);
    const agentId = requireAgentId(message.content.text);
    const username = parseEmailUsername(message.content.text);
    if (!username) throw new Error('Alias username is required');
    const result = await ad.createEmailAlias(agentId, username);
    return { text: `Created email alias ${result.address.emailAddress}.`, data: result };
  },
};

export const deleteEmailAliasAction = {
  name: 'DELETE_EMAIL_ALIAS',
  description: 'Delete an active AgentDomain email alias.',
  similes: ['REMOVE_EMAIL_ALIAS', 'DELETE_ALIAS'],
  examples: [],
  validate: async (runtime: IAgentRuntime) =>
    Boolean(runtime.getSetting('AGENT_PRIVATE_KEY') || runtime.getSetting('AGENTDOMAIN_API_KEY')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime);
    const agentId = requireAgentId(message.content.text);
    const emailAddress = message.content.text.match(EMAIL_PATTERN)?.[0];
    if (!emailAddress) throw new Error('Full alias email address is required');
    const result = await ad.deleteEmailAlias(agentId, emailAddress);
    return { text: `Deleted email alias ${emailAddress}.`, data: result };
  },
};

export const renewalStatusAction = {
  name: 'GET_RENEWAL_STATUS',
  description: 'Get RenewalVault balance, shortfall, renewal amount, and auto-renew state.',
  similes: ['RENEWAL_STATUS', 'CHECK_RENEWAL', 'VAULT_STATUS'],
  examples: [],
  validate: async (runtime: IAgentRuntime) =>
    Boolean(runtime.getSetting('AGENT_PRIVATE_KEY') || runtime.getSetting('AGENTDOMAIN_API_KEY')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime);
    const agentId = requireAgentId(message.content.text);
    const status = await ad.getRenewalStatus(agentId);
    return {
      text: `Renewal for ${status.domain}: next $${status.nextRenewalAmountUsdc}, balance $${status.vaultBalanceUsdc}, shortfall $${status.shortfallUsdc}, auto-renew ${status.autoRenewEnabled ? 'enabled' : 'off'}.`,
      data: status,
    };
  },
};

export const fundRenewalAction = {
  name: 'FUND_RENEWAL_VAULT',
  description: 'Deposit USDC into an AgentID renewal vault.',
  similes: ['DEPOSIT_RENEWAL', 'FUND_VAULT'],
  examples: [],
  validate: async (runtime: IAgentRuntime) => Boolean(runtime.getSetting('AGENT_PRIVATE_KEY')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime, { requireWallet: true });
    const agentId = requireAgentId(message.content.text);
    const amountUsdc = parseAmountUsdc(message.content.text);
    const result = await ad.fundRenewalVault(agentId, amountUsdc);
    return {
      text: `Deposited $${amountUsdc} USDC into renewal vault for ${result.domain}.`,
      data: result,
    };
  },
};

export const enableAutoRenewAction = {
  name: 'ENABLE_AUTO_RENEW',
  description: 'Enable on-chain RenewalVault auto-renew for an AgentDomain identity.',
  similes: ['AUTO_RENEW', 'ENABLE_RENEWAL'],
  examples: [],
  validate: async (runtime: IAgentRuntime) =>
    Boolean(runtime.getSetting('AGENT_PRIVATE_KEY') && runtime.getSetting('RENEWAL_VAULT_ADDRESS')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime, { requireWallet: true });
    const agentId = requireAgentId(message.content.text);
    const result = await ad.setAutoRenew(agentId, true, {
      renewalVaultAddress: runtime.getSetting('RENEWAL_VAULT_ADDRESS') as Address,
    });
    return { text: `Auto-renew enabled for token #${result.tokenId}.`, data: result };
  },
};

export const reconfigureSslAction = {
  name: 'RECONFIGURE_SSL',
  description:
    'Rebuild the Cloudflare SaaS SSL hostname and sync Spaceship DNS validation records for an AgentDomain identity.',
  similes: ['FIX_SSL', 'REPAIR_SSL', 'SYNC_SSL'],
  examples: [],
  validate: async (runtime: IAgentRuntime) => Boolean(runtime.getSetting('AGENT_PRIVATE_KEY')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime);
    const agentId = message.content.text.match(/[0-9a-f-]{36}/i)?.[0];
    if (!agentId) throw new Error('Agent ID UUID is required to reconfigure SSL');
    const result = await ad.reconfigureSsl(agentId);
    return {
      text: `SSL reconfigured for ${result.domain}. Status: ${result.sslStatus}.`,
      data: result,
    };
  },
};

export const listDnsAction = {
  name: 'LIST_DNS_RECORDS',
  description: 'List DNS records for an AgentDomain identity.',
  similes: ['DNS_RECORDS', 'LIST_DNS'],
  examples: [],
  validate: async (runtime: IAgentRuntime) =>
    Boolean(runtime.getSetting('AGENT_PRIVATE_KEY') || runtime.getSetting('AGENTDOMAIN_API_KEY')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime);
    const agentId = requireAgentId(message.content.text);
    const records = await ad.listDnsRecords(agentId);
    return { text: `Found ${records.length} DNS records.`, data: records };
  },
};

export const createDnsAction = {
  name: 'CREATE_DNS_RECORD',
  description:
    'Create a user-managed DNS record. Use text like: agentId type A name @ value 1.2.3.4.',
  similes: ['ADD_DNS', 'CREATE_DNS'],
  examples: [],
  validate: async (runtime: IAgentRuntime) =>
    Boolean(runtime.getSetting('AGENT_PRIVATE_KEY') || runtime.getSetting('AGENTDOMAIN_API_KEY')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime);
    const agentId = requireAgentId(message.content.text);
    const record = parseDnsRecord(message.content.text);
    const result = await ad.createDnsRecord(agentId, record);
    return { text: `Created ${result.type} DNS record ${result.name}.`, data: result };
  },
};

export const updateDnsAction = {
  name: 'UPDATE_DNS_RECORD',
  description: 'Update a user-managed DNS record. Include agent UUID and record UUID.',
  similes: ['EDIT_DNS', 'UPDATE_DNS'],
  examples: [],
  validate: async (runtime: IAgentRuntime) =>
    Boolean(runtime.getSetting('AGENT_PRIVATE_KEY') || runtime.getSetting('AGENTDOMAIN_API_KEY')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime);
    const ids = message.content.text.match(new RegExp(UUID_PATTERN.source, 'gi')) ?? [];
    const agentId = ids[0];
    const recordId = ids[1];
    if (!agentId || !recordId) throw new Error('Agent ID and record ID UUIDs are required');
    const record = parseDnsRecord(message.content.text);
    const result = await ad.updateDnsRecord(agentId, recordId, record);
    return { text: `Updated ${result.type} DNS record ${result.name}.`, data: result };
  },
};

export const deleteDnsAction = {
  name: 'DELETE_DNS_RECORD',
  description: 'Delete a user-managed DNS record. Include agent UUID and record UUID.',
  similes: ['REMOVE_DNS', 'DELETE_DNS'],
  examples: [],
  validate: async (runtime: IAgentRuntime) =>
    Boolean(runtime.getSetting('AGENT_PRIVATE_KEY') || runtime.getSetting('AGENTDOMAIN_API_KEY')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime);
    const ids = message.content.text.match(new RegExp(UUID_PATTERN.source, 'gi')) ?? [];
    const agentId = ids[0];
    const recordId = ids[1];
    if (!agentId || !recordId) throw new Error('Agent ID and record ID UUIDs are required');
    const result = await ad.deleteDnsRecord(agentId, recordId);
    return { text: `Deleted DNS record ${recordId}.`, data: result };
  },
};

export const servicePlanStatusAction = {
  name: 'GET_SERVICE_PLAN',
  description: 'Get an agent Premium Plan, limits, current period, and billing state.',
  similes: ['PLAN_STATUS', 'CHECK_PLAN'],
  examples: [],
  validate: async (runtime: IAgentRuntime) =>
    Boolean(runtime.getSetting('AGENT_PRIVATE_KEY') || runtime.getSetting('AGENTDOMAIN_API_KEY')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime);
    const agentId = requireAgentId(message.content.text);
    const result = await ad.getServicePlan(agentId);
    return {
      text: `${result.domain} is on ${result.entitlement.plan}. Email limit ${result.entitlement.limits.emailPerHour}/hour, DNS limit ${result.entitlement.limits.dnsRecords}, registry hidden ${result.registryVisibility.hidden}.`,
      data: result,
    };
  },
};

export const setRegistryVisibilityAction = {
  name: 'SET_REGISTRY_VISIBILITY',
  description:
    'Hide or show an agent in the public AgentDomain registry. Hiding requires an active Pro or Enterprise Premium Plan.',
  similes: ['HIDE_AGENT_REGISTRY', 'SHOW_AGENT_REGISTRY', 'REGISTRY_VISIBILITY'],
  examples: [],
  validate: async (runtime: IAgentRuntime) =>
    Boolean(runtime.getSetting('AGENT_PRIVATE_KEY') || runtime.getSetting('AGENTDOMAIN_API_KEY')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime);
    const agentId = requireAgentId(message.content.text);
    const text = message.content.text.toLowerCase();
    const wantsPublic =
      text.includes('unhide') ||
      text.includes('show') ||
      text.includes('visible') ||
      text.includes('public');
    const registryHidden = !wantsPublic && (text.includes('hide') || text.includes('private'));
    const result = await ad.setRegistryVisibility(agentId, registryHidden);
    return {
      text: `${result.domain} is now ${result.registryVisibility.hidden ? 'hidden from' : 'visible in'} the public registry.`,
      data: result,
    };
  },
};

export const purchaseServicePlanAction = {
  name: 'PURCHASE_SERVICE_PLAN',
  description: 'Upgrade an agent to AgentDomain Pro or Enterprise Premium Plan using x402 USDC.',
  similes: ['BUY_PLAN', 'UPGRADE_PLAN'],
  examples: [],
  validate: async (runtime: IAgentRuntime) => Boolean(runtime.getSetting('AGENT_PRIVATE_KEY')),
  handler: async (runtime: IAgentRuntime, message: Memory) => {
    const { ad } = getClients(runtime, { requireWallet: true });
    const agentId = requireAgentId(message.content.text);
    const plan = parsePlan(message.content.text);
    const result = await ad.purchaseServicePlan({
      agentId,
      ...plan,
    });
    return {
      text: `Purchased ${result.entitlement.plan} Premium Plan for ${result.domain}.`,
      data: result,
    };
  },
};

export const agentDomainPlugin = {
  name: 'agentdomain',
  description:
    'Identity infrastructure for AI agents on Base (domain + Basename + DNS + email + SSL).',
  actions: [
    quoteRegistrationAction,
    registerIdentityAction,
    searchAgentsAction,
    sendEmailAction,
    listEmailAction,
    updatePrimaryEmailAction,
    createEmailAliasAction,
    deleteEmailAliasAction,
    renewalStatusAction,
    fundRenewalAction,
    enableAutoRenewAction,
    reconfigureSslAction,
    listDnsAction,
    createDnsAction,
    updateDnsAction,
    deleteDnsAction,
    servicePlanStatusAction,
    setRegistryVisibilityAction,
    purchaseServicePlanAction,
  ],
  evaluators: [],
  providers: [],
};

export default agentDomainPlugin;
