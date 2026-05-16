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
 *           "AGENTDOMAIN_API_URL": "https://api.agentdomain.xyz",
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
import { SUPPORTED_FRAMEWORKS, SUPPORTED_TLDS } from '@agentdomain/shared/constants';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

const API_URL = process.env.AGENTDOMAIN_API_URL ?? 'https://api.agentdomain.xyz/v1';
const NETWORK = (process.env.AGENTDOMAIN_NETWORK ?? 'base') as 'base' | 'base-sepolia';
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;

function getClient(): AgentDomain {
  const config: ConstructorParameters<typeof AgentDomain>[0] = { apiUrl: API_URL };
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
  { name: 'agentdomain-mcp', version: '0.1.0' },
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
      'Get a price quote for registering an agent identity bundle (domain + Basename + ENS).',
    inputSchema: {
      type: 'object',
      properties: {
        preferredName: { type: 'string' },
        tld: { type: 'string', enum: SUPPORTED_TLDS },
        registerBasename: { type: 'boolean' },
        registerEns: { type: 'boolean' },
      },
      required: ['preferredName'],
    },
  },
  {
    name: 'register_agent_identity',
    description:
      'Register a complete agent identity bundle: domain + Basename + DNS + SSL. Pays in USDC on Base. Requires AGENT_PRIVATE_KEY env var to be set.',
    inputSchema: {
      type: 'object',
      properties: {
        preferredName: { type: 'string' },
        tld: { type: 'string', enum: SUPPORTED_TLDS },
        registerBasename: { type: 'boolean', default: true },
        basenameLabel: { type: 'string', description: 'Optional alternate Basename label' },
        registerEns: { type: 'boolean', default: false },
        ensLabel: { type: 'string', description: 'Optional alternate ENS label' },
        ownerAddress: {
          type: 'string',
          description: 'Optional EVM address to receive NFT ownership',
        },
        emailEnabled: { type: 'boolean', default: false },
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
    description: 'Look up an agent identity by wallet address.',
    inputSchema: {
      type: 'object',
      properties: {
        wallet: { type: 'string', description: '0x wallet address' },
      },
      required: ['wallet'],
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
      },
      required: ['agentId', 'to', 'subject'],
    },
  },
  {
    name: 'list_agent_email',
    description: 'List received/sent text-only email messages for an email-enabled agent, including extracted verification codes.',
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
            emailEnabled: z.boolean().default(false),
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
        const result = await client.getAgent(a.wallet as `0x${string}`);
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
          })
          .parse(args);
        const result = await client.sendEmail(a.agentId, {
          to: a.to,
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

      case 'fund_renewal_vault': {
        const a = z.object({ agentId: z.string(), amountUsdc: z.string() }).parse(args);
        const result = await client.fundRenewalVault(a.agentId, a.amountUsdc);
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
