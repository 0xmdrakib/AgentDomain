#!/usr/bin/env node
/**
 * AgentDomain MCP Server
 *
 * Exposes AgentDomain identity tools to any MCP-compatible LLM client
 * (Claude Desktop, ChatGPT desktop, custom agents, etc.).
 *
 * Stdio transport. Run via:
 *   agentdomain-mcp
 * or in a client config:
 *   {
 *     "mcpServers": {
 *       "agentdomain": {
 *         "command": "npx",
 *         "args": ["-y", "@agentdomain/mcp-server"],
 *         "env": {
 *           "AGENTDOMAIN_API_URL": "https://agentdomain.app/api/v1",
 *           "AGENT_PRIVATE_KEY": "0x..."
 *         }
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AgentDomain } from '@agentdomain/sdk';
import {
  AGENTDOMAIN_API_BASE_URL,
  SERVICE_PLAN_KEYS,
  SUPPORTED_FRAMEWORKS,
  SUPPORTED_TLDS,
} from '@agentdomain/shared/constants';
import { createPublicClient, createWalletClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

const API_URL = process.env.AGENTDOMAIN_API_URL ?? AGENTDOMAIN_API_BASE_URL;
const NETWORK = (process.env.AGENTDOMAIN_NETWORK ?? 'base') as 'base' | 'base-sepolia';
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
const AGENTDOMAIN_API_KEY = process.env.AGENTDOMAIN_API_KEY;
const RENEWAL_VAULT_ADDRESS = process.env.RENEWAL_VAULT_ADDRESS as Address | undefined;

function getClient(): AgentDomain {
  const config: ConstructorParameters<typeof AgentDomain>[0] = {
    apiUrl: API_URL,
    apiKey: AGENTDOMAIN_API_KEY,
    network: NETWORK,
    renewalVaultAddress: RENEWAL_VAULT_ADDRESS,
  };
  if (AGENT_PRIVATE_KEY) {
    const account = privateKeyToAccount(AGENT_PRIVATE_KEY as `0x${string}`);
    const chain = NETWORK === 'base' ? base : baseSepolia;
    const rpc = NETWORK === 'base' ? 'https://mainnet.base.org' : 'https://sepolia.base.org';
    // Cast: viem's deeply-generic types do not always match cleanly across
    // duplicated installs in monorepos. Behaviour is identical at runtime.
    config.walletClient = createWalletClient({ account, chain, transport: http(rpc) }) as never;
    config.publicClient = createPublicClient({ chain, transport: http(rpc) }) as never;
  }
  return new AgentDomain(config);
}

const server = new Server(
  { name: 'agentdomain-mcp', version: '0.3.0' },
  { capabilities: { tools: {} } },
);

// ----------------------------------------------------------------------
// TOOL DEFINITIONS
// ----------------------------------------------------------------------

const TOOLS = [
  {
    name: 'check_domain_availability',
    description:
      'Check whether an agent domain (name + tld) is available for registration. Returns availability status and pricing.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The desired label, e.g. "myagent"' },
        tld: {
          type: 'string',
          enum: SUPPORTED_TLDS,
          description: 'TLD',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'quote_registration',
    description:
      'Get a price quote for registering an agent identity bundle. Domain, DNS, email, SSL, AgentID NFT orchestration, and platform fee are included by default. Basename and ENS are optional.',
    inputSchema: {
      type: 'object',
      properties: {
        preferredName: { type: 'string' },
        tld: { type: 'string', enum: SUPPORTED_TLDS },
        registerBasename: {
          type: 'boolean',
          description: 'Set false to skip Basename registration and cost.',
          default: true,
        },
        registerEns: {
          type: 'boolean',
          description: 'Set true to add ENS; false skips ENS cost.',
          default: false,
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
          enum: SERVICE_PLAN_KEYS,
          default: 'included',
          description: 'Premium Plan to buy with registration.',
        },
        years: { type: 'integer', default: 1, minimum: 1, maximum: 10 },
      },
      required: ['preferredName'],
    },
  },
  {
    name: 'register_agent_identity',
    description:
      'Register a complete agent identity bundle. Domain, DNS, email, SSL, AgentID NFT orchestration, and platform fee are included by default. Basename and ENS are optional. Pays in USDC on Base. Requires AGENT_PRIVATE_KEY env var.',
    inputSchema: {
      type: 'object',
      properties: {
        preferredName: { type: 'string' },
        tld: { type: 'string', enum: SUPPORTED_TLDS },
        registerBasename: {
          type: 'boolean',
          description: 'Set false to skip Basename registration and cost.',
          default: true,
        },
        basenameLabel: { type: 'string', description: 'Optional alternate Basename label' },
        registerEns: {
          type: 'boolean',
          description: 'Set true to add ENS; false skips ENS cost.',
          default: false,
        },
        ensLabel: { type: 'string', description: 'Optional alternate ENS label' },
        ownerAddress: {
          type: 'string',
          description: 'Optional EVM address to receive NFT ownership',
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
          enum: SERVICE_PLAN_KEYS,
          default: 'included',
          description: 'Premium Plan to buy with registration.',
        },
        years: { type: 'integer', default: 1, minimum: 1, maximum: 10 },
        autoRenew: { type: 'boolean', default: false },
        dnsTarget: { type: 'string', description: 'URL or IP to point the domain at' },
        metadata: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            capabilities: { type: 'array', items: { type: 'string' } },
            framework: { type: 'string', enum: SUPPORTED_FRAMEWORKS },
            x402Endpoint: { type: 'string' },
          },
        },
      },
      required: ['preferredName'],
    },
  },
  {
    name: 'lookup_agent',
    description: 'Look up agent identities by wallet address.',
    inputSchema: {
      type: 'object',
      properties: {
        wallet: { type: 'string', description: '0x wallet address' },
      },
      required: ['wallet'],
    },
  },
  {
    name: 'get_agent',
    description: 'Get one agent identity by AgentDomain agent ID. Works with an agent-scoped API key.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'search_agents',
    description: 'Search the public agent registry by name, capability, or framework.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Free-text query' },
        capability: { type: 'string' },
        framework: {
          type: 'string',
          enum: SUPPORTED_FRAMEWORKS,
        },
        limit: { type: 'number', default: 20 },
      },
    },
  },
  {
    name: 'send_agent_email',
    description: "Send an email from an agent's address (requires email-enabled identity).",
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
        to: { type: 'string' },
        subject: { type: 'string' },
        text: { type: 'string' },
        fromAddress: {
          type: 'string',
          description: 'Optional primary or active alias address to send from.',
        },
      },
      required: ['agentId', 'to', 'subject'],
    },
  },
  {
    name: 'update_primary_email',
    description:
      'Change the primary email username for an agent. The old primary address stops receiving new mail.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
        username: { type: 'string', description: 'New primary local-part, e.g. agent or support' },
      },
      required: ['agentId', 'username'],
    },
  },
  {
    name: 'create_email_alias',
    description:
      'Create an extra receive-and-send email alias. Requires Pro or Enterprise Premium Plan capacity.',
    inputSchema: {
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
    description: 'Delete an active email alias from an agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
        emailAddress: { type: 'string', description: 'Full alias address to delete' },
      },
      required: ['agentId', 'emailAddress'],
    },
  },
  {
    name: 'list_agent_email',
    description:
      'List received/sent text-only email messages for an email-enabled agent, including extracted verification codes.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
        limit: { type: 'number', default: 20 },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'list_dns_records',
    description: 'List Spaceship-backed DNS records for an agent domain.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'create_dns_record',
    description: 'Create a user-managed DNS record and sync the full DNS state to Spaceship.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        type: { type: 'string', enum: ['A', 'AAAA', 'ALIAS', 'CNAME', 'MX', 'TXT', 'NS', 'SRV'] },
        name: { type: 'string' },
        value: { type: 'string' },
        ttl: { type: 'number', default: 3600 },
        priority: { type: 'number' },
      },
      required: ['agentId', 'type', 'name', 'value'],
    },
  },
  {
    name: 'update_dns_record',
    description: 'Update a user-managed DNS record and sync the DNS state to Spaceship.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        recordId: { type: 'string' },
        type: { type: 'string', enum: ['A', 'AAAA', 'ALIAS', 'CNAME', 'MX', 'TXT', 'NS', 'SRV'] },
        name: { type: 'string' },
        value: { type: 'string' },
        ttl: { type: 'number' },
        priority: { type: 'number' },
      },
      required: ['agentId', 'recordId'],
    },
  },
  {
    name: 'delete_dns_record',
    description: 'Delete a user-managed DNS record and sync the DNS state to Spaceship.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        recordId: { type: 'string' },
      },
      required: ['agentId', 'recordId'],
    },
  },
  {
    name: 'reconfigure_ssl',
    description:
      'Rebuild the Cloudflare SaaS SSL hostname and sync required DNS validation records.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'fund_renewal_vault',
    description: "Deposit USDC into an agent's renewal vault to keep its domain alive.",
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        amountUsdc: { type: 'string', description: 'USDC amount, e.g. "10.00"' },
      },
      required: ['agentId', 'amountUsdc'],
    },
  },
  {
    name: 'withdraw_renewal_vault',
    description:
      'Build the owner-signed withdrawal transaction for unused funds in an AgentID renewal vault.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        amountUsdc: { type: 'string', description: 'USDC amount, e.g. "5.00"' },
      },
      required: ['agentId', 'amountUsdc'],
    },
  },
  {
    name: 'get_renewal_status',
    description:
      'Get renewal vault status for an agent, including exact renewal amount, vault balance, missing deposit, expiry, and auto-renew readiness.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'get_service_plan',
    description:
      'Get the current AgentDomain Premium Plan, entitlement limits, billing interval, registry privacy, and recent purchases for one agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'purchase_service_plan',
    description:
      'Upgrade one agent to a Pro or Enterprise Premium Plan with x402 USDC. Requires AGENT_PRIVATE_KEY for the owner wallet.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        plan: { type: 'string', enum: ['pro', 'enterprise'] },
      },
      required: ['agentId', 'plan'],
    },
  },
  {
    name: 'set_registry_visibility',
    description:
      'Hide or show one agent in the public AgentDomain registry. Hiding requires an active Pro or Enterprise Premium Plan.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        registryHidden: {
          type: 'boolean',
          description: 'true hides the agent from public registry/search; false makes it public',
        },
      },
      required: ['agentId', 'registryHidden'],
    },
  },
  {
    name: 'enable_auto_renew',
    description:
      'Enable on-chain auto-renew for an agent. Requires the owner wallet private key and the RenewalVault contract address.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'AgentDomain agent ID (UUID)' },
      },
      required: ['agentId'],
    },
  },
];

// ----------------------------------------------------------------------
// HANDLERS
// ----------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const client = getClient();

  try {
    switch (name) {
      case 'check_domain_availability': {
        const a = z
          .object({ name: z.string(), tld: z.enum(SUPPORTED_TLDS).default('xyz') })
          .parse(args);
        const result = await client.checkAvailability(a.name, { tld: a.tld });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'quote_registration': {
        const a = z
          .object({
            preferredName: z.string(),
            tld: z.enum(SUPPORTED_TLDS).default('xyz'),
            registerBasename: z.boolean().default(true),
            registerEns: z.boolean().default(false),
            emailEnabled: z.boolean().default(true),
            emailUsername: z.string().optional(),
            premiumPlan: z.enum(SERVICE_PLAN_KEYS).default('included'),
            years: z.number().int().min(1).max(10).default(1),
          })
          .parse(args);
        const result = await client.quote(a);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'register_agent_identity': {
        if (!AGENT_PRIVATE_KEY) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: "AGENT_PRIVATE_KEY env var is required for registration. Set it to your agent's wallet private key.",
              },
            ],
          };
        }
        const a = z
          .object({
            preferredName: z.string(),
            tld: z.enum(SUPPORTED_TLDS).default('xyz'),
            registerBasename: z.boolean().default(true),
            basenameLabel: z.string().optional(),
            registerEns: z.boolean().default(false),
            ensLabel: z.string().optional(),
            ownerAddress: z
              .string()
              .regex(/^0x[a-fA-F0-9]{40}$/)
              .optional(),
            emailEnabled: z.boolean().default(true),
            emailUsername: z.string().optional(),
            premiumPlan: z.enum(SERVICE_PLAN_KEYS).default('included'),
            years: z.number().int().min(1).max(10).default(1),
            autoRenew: z.boolean().default(false),
            dnsTarget: z.string().optional(),
            metadata: z.record(z.any()).optional(),
          })
          .parse(args);
        const account = privateKeyToAccount(AGENT_PRIVATE_KEY as `0x${string}`);
        const result = await client.register({
          ...a,
          wallet: account.address,
          ownerAddress: a.ownerAddress as `0x${string}` | undefined,
          metadata: a.metadata as never,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'lookup_agent': {
        const a = z.object({ wallet: z.string() }).parse(args);
        const result = await client.getAgentsByWallet(a.wallet as `0x${string}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'get_agent': {
        const a = z.object({ agentId: z.string() }).parse(args);
        const result = await client.getAgentById(a.agentId);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'search_agents': {
        const a = z
          .object({
            q: z.string().optional(),
            capability: z.string().optional(),
            framework: z.enum(SUPPORTED_FRAMEWORKS).optional(),
            limit: z.number().default(20),
          })
          .parse(args);
        const result = await client.search(a);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'send_agent_email': {
        const a = z
          .object({
            agentId: z.string(),
            to: z.string(),
            subject: z.string(),
            text: z.string(),
            fromAddress: z.string().email().optional(),
          })
          .parse(args);
        const result = await client.sendEmail(a.agentId, {
          to: a.to,
          fromAddress: a.fromAddress,
          subject: a.subject,
          text: a.text,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'list_agent_email': {
        const a = z.object({ agentId: z.string(), limit: z.number().default(20) }).parse(args);
        const result = await client.listEmail(a.agentId, { limit: a.limit });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'update_primary_email': {
        const a = z.object({ agentId: z.string(), username: z.string() }).parse(args);
        const result = await client.updatePrimaryEmail(a.agentId, a.username);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'create_email_alias': {
        const a = z.object({ agentId: z.string(), username: z.string() }).parse(args);
        const result = await client.createEmailAlias(a.agentId, a.username);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'delete_email_alias': {
        const a = z.object({ agentId: z.string(), emailAddress: z.string().email() }).parse(args);
        const result = await client.deleteEmailAlias(a.agentId, a.emailAddress);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'list_dns_records': {
        const a = z.object({ agentId: z.string() }).parse(args);
        const result = await client.listDnsRecords(a.agentId);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'create_dns_record': {
        const a = z
          .object({
            agentId: z.string(),
            type: z.enum(['A', 'AAAA', 'ALIAS', 'CNAME', 'MX', 'TXT', 'NS', 'SRV']),
            name: z.string(),
            value: z.string(),
            ttl: z.number().default(3600),
            priority: z.number().optional(),
          })
          .parse(args);
        const result = await client.createDnsRecord(a.agentId, {
          type: a.type,
          name: a.name,
          value: a.value,
          ttl: a.ttl,
          priority: a.priority,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'update_dns_record': {
        const a = z
          .object({
            agentId: z.string(),
            recordId: z.string(),
            type: z.enum(['A', 'AAAA', 'ALIAS', 'CNAME', 'MX', 'TXT', 'NS', 'SRV']).optional(),
            name: z.string().optional(),
            value: z.string().optional(),
            ttl: z.number().optional(),
            priority: z.number().optional(),
          })
          .parse(args);
        const { agentId, recordId, ...record } = a;
        const result = await client.updateDnsRecord(agentId, recordId, record);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'delete_dns_record': {
        const a = z.object({ agentId: z.string(), recordId: z.string() }).parse(args);
        const result = await client.deleteDnsRecord(a.agentId, a.recordId);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'reconfigure_ssl': {
        const a = z.object({ agentId: z.string() }).parse(args);
        const result = await client.reconfigureSsl(a.agentId);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'fund_renewal_vault': {
        const a = z.object({ agentId: z.string(), amountUsdc: z.string() }).parse(args);
        const result = await client.fundRenewalVault(a.agentId, a.amountUsdc);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'withdraw_renewal_vault': {
        const a = z.object({ agentId: z.string(), amountUsdc: z.string() }).parse(args);
        const result = await client.withdrawFromVault(a.agentId, a.amountUsdc);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'get_renewal_status': {
        const a = z.object({ agentId: z.string() }).parse(args);
        const result = await client.getRenewalStatus(a.agentId);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'get_service_plan': {
        const a = z.object({ agentId: z.string() }).parse(args);
        const result = await client.getServicePlan(a.agentId);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'purchase_service_plan': {
        if (!AGENT_PRIVATE_KEY) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'AGENT_PRIVATE_KEY env var is required to purchase a Premium Plan.',
              },
            ],
          };
        }
        const a = z
          .object({
            agentId: z.string(),
            plan: z.enum(['pro', 'enterprise']),
          })
          .parse(args);
        const result = await client.purchaseServicePlan(a);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'set_registry_visibility': {
        const a = z.object({ agentId: z.string(), registryHidden: z.boolean() }).parse(args);
        const result = await client.setRegistryVisibility(a.agentId, a.registryHidden);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'enable_auto_renew': {
        if (!AGENT_PRIVATE_KEY) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'AGENT_PRIVATE_KEY env var is required to enable auto-renew. Use the owner wallet private key.',
              },
            ],
          };
        }
        if (!RENEWAL_VAULT_ADDRESS) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'RENEWAL_VAULT_ADDRESS env var is required to enable auto-renew on-chain.',
              },
            ],
          };
        }
        const a = z.object({ agentId: z.string() }).parse(args);
        const result = await client.setAutoRenew(a.agentId, true);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      default:
        return {
          isError: true,
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        };
    }
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
    };
  }
});

// ----------------------------------------------------------------------
// MAIN
// ----------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('AgentDomain MCP server running on stdio');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
