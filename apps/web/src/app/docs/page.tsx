import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Code2,
  Coins,
  ShieldCheck,
  TerminalSquare,
  Wallet,
  Bot,
  Sparkles,
} from 'lucide-react';
import { LandingNav } from '@/components/landing/nav';
import { Footer } from '@/components/landing/footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/* ── Stack example data ───────────────────────────────────────────── */

const stackExamples = [
  {
    name: 'Coinbase AgentKit',
    badge: '@agentdomain/agentkit-plugin',
    tone: 'agentkit' as const,
    icon: Wallet,
    code: `import { AgentDomainActionProvider }
  from '@agentdomain/agentkit-plugin';

const agentkit = await AgentKit.from({
  walletProvider: cdpWalletProvider,
  actionProviders: [
    new AgentDomainActionProvider(),
  ],
});

// Agent calls:
// → register_agent_identity
// → quote_agent_registration
// → search_agents`,
    desc: 'Native action provider. Agents get register, quote, and search as first-class actions.',
  },
  {
    name: 'ElizaOS',
    badge: '@agentdomain/eliza-plugin',
    tone: 'eliza' as const,
    icon: Bot,
    code: `// character.ts
import { agentDomainPlugin } from '@agentdomain/eliza-plugin';

const character: Character = {
  name: 'HelpfulAgent',
  plugins: [agentDomainPlugin],
};

// Agent says:
// "Register me as helpful-bot.ai with email"
// → REGISTER_IDENTITY action triggers
// → domain + basename + email provisioned`,
    desc: 'Drop-in plugin. Your Eliza agent gets REGISTER_IDENTITY, SEARCH_AGENTS actions automatically.',
  },
  {
    name: 'OpenAI SDK',
    badge: '@agentdomain/sdk',
    tone: 'openai' as const,
    icon: Sparkles,
    code: `import {
  AgentDomain,
  createOpenAITools,
  runAgentDomainTool,
  formatAgentDomainToolResult,
} from '@agentdomain/sdk';

const ad = new AgentDomain({
  walletClient, publicClient,
});

const tools = createOpenAITools();

const response = await openai.chat.completions
  .create({
    model: 'gpt-4',
    messages: [...],
    tools,
  });

const toolCall = response.choices[0]
  ?.message?.tool_calls?.[0];
const result = await runAgentDomainTool(
  ad,
  toolCall.function.name,
  JSON.parse(toolCall.function.arguments),
);
// → domain registered, NFT minted`,
    desc: 'Tool definitions for Chat Completions API. Models call check_domain_availability, quote_registration, register_agent_identity, and search_agents as native tools.',
  },
  {
    name: 'Anthropic SDK',
    badge: '@agentdomain/sdk',
    tone: 'anthropic' as const,
    icon: ShieldCheck,
    code: `import {
  AgentDomain,
  createAnthropicTools,
  runAgentDomainTool,
  formatAgentDomainToolResult,
} from '@agentdomain/sdk';

const ad = new AgentDomain({
  walletClient, publicClient,
});

const tools = createAnthropicTools();

const msg = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [...],
  tools,
});

const toolUse = msg.content.find(
  (b) => b.type === 'tool_use',
);
const result = await runAgentDomainTool(
  ad, toolUse.name, toolUse.input,
);
// → domain registered, NFT minted`,
    desc: 'Tool definitions for Messages API. Models call the same four agent-domain tools with Anthropic-native input_schema format.',
  },
];

/* ── API endpoints (kept as-is per user request) ───────────────────── */

const apiEndpoints = [
  {
    group: 'Registration & Pricing',
    endpoints: [
      {
        title: 'Check Availability',
        method: 'GET',
        path: '/api/v1/domains/availability?name=atlas&tld=com',
        text: 'Checks domain, Basename, and ENS availability independently.',
      },
      {
        title: 'Get Pricing Quote',
        method: 'GET',
        path: '/api/v1/agents/quote?preferredName=atlas&tld=com&years=3',
        text: 'Returns live pricing for the identity bundle, including multi-year discounts.',
      },
      {
        title: 'Register Identity (x402)',
        method: 'POST',
        path: '/api/v1/agents/register',
        text: 'Requires x402 payment challenge. Provisions the complete identity bundle.',
      },
    ],
  },
  {
    group: 'Agent Management',
    endpoints: [
      {
        title: 'Get Agent Details',
        method: 'GET',
        path: '/api/v1/agents/:id',
        text: 'Returns identity state, expiration dates, and metadata.',
      },
    ],
  },
  {
    group: 'DNS Management',
    endpoints: [
      {
        title: 'List DNS Records',
        method: 'GET',
        path: '/api/v1/agents/:id/dns',
        text: "Returns all DNS records for the agent's domain.",
      },
      {
        title: 'Create DNS Record',
        method: 'POST',
        path: '/api/v1/agents/:id/dns',
        text: 'Add a new DNS record. Syncs instantly to Cloudflare.',
      },
      {
        title: 'Update DNS Record',
        method: 'PATCH',
        path: '/api/v1/agents/:id/dns/:recordId',
        text: 'Modify an existing DNS record.',
      },
      {
        title: 'Delete DNS Record',
        method: 'DELETE',
        path: '/api/v1/agents/:id/dns/:recordId',
        text: 'Remove a DNS record from the database and Cloudflare.',
      },
    ],
  },
  {
    group: 'Email Infrastructure',
    endpoints: [
      {
        title: 'Get Email Inbox',
        method: 'GET',
        path: '/api/v1/agents/:id/email',
        text: 'Retrieve all inbound and outbound messages for the agent.',
      },
      {
        title: 'Send Email',
        method: 'POST',
        path: '/api/v1/agents/:id/email/send',
        text: 'Send an outbound email from agent@yourdomain.com.',
      },
      {
        title: 'Update Message Status',
        method: 'PATCH',
        path: '/api/v1/agents/:id/email/:messageId',
        text: 'Mark an email message as read or unread.',
      },
      {
        title: 'Manage Blocklist',
        method: 'POST',
        path: '/api/v1/agents/:id/email/blocklist',
        text: "Retrieve (GET) or add (POST) domains/emails to the agent's blocklist.",
      },
    ],
  },
  {
    group: 'Renewal Vault',
    endpoints: [
      {
        title: 'Get Renewal Status',
        method: 'GET',
        path: '/api/v1/agents/:id/renewal/status',
        text: 'Returns vault balance, auto-renew status, expiry date, and estimated years.',
      },
      {
        title: 'Fund Vault (Deposit)',
        method: 'POST',
        path: '/api/v1/agents/:id/renewal/fund',
        text: 'Deposit USDC into the vault. Anyone can deposit. Auto-renew enables on first deposit.',
      },
      {
        title: 'Withdraw from Vault',
        method: 'POST',
        path: '/api/v1/agents/:id/renewal/withdraw',
        text: 'Withdraw USDC from the vault. Only the ownerAddress can withdraw.',
      },
    ],
  },
];

/* ── Helpers ───────────────────────────────────────────────────────── */

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    POST: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    PATCH: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    DELETE: 'bg-red-500/10 text-red-500 border-red-500/20',
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${colors[method] || 'bg-gray-500/10 text-gray-500'}`}
    >
      {method}
    </span>
  );
}

/* ── Page ──────────────────────────────────────────────────────────── */

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-background">
      <LandingNav />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border/40">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.22),transparent_42%),radial-gradient(circle_at_80%_20%,rgba(168,85,247,0.18),transparent_34%)]" />
        <div className="container relative py-20 md:py-28">
          <div className="max-w-4xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary">
              <BookOpen className="h-4 w-4" />
              AgentDomain Documentation
            </div>
            <h1 className="text-balance text-4xl font-bold tracking-tight md:text-6xl">
              Identity infrastructure for the agent economy.
            </h1>
            <p className="mt-5 max-w-3xl text-lg text-muted-foreground md:text-xl">
              Domain + Basename + ENS + DNS + SSL + Email in one checkout. Works with ElizaOS,
              AgentKit, OpenAI SDK, and Anthropic SDK.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/register">
                <Button variant="gradient" size="lg">
                  Register an agent
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <a href="#api">
                <Button variant="outline" size="lg">
                  Jump to API
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Agent Stack SDK Examples ──────────────────────────────── */}
      <section id="stacks" className="container py-16">
        <div className="mb-10">
          <h2 className="text-3xl font-bold tracking-tight">Works with your agent stack</h2>
          <p className="mt-2 text-muted-foreground max-w-3xl">
            First-class integrations for ElizaOS and Coinbase AgentKit. Tool adapters for OpenAI SDK
            and Anthropic SDK. Any other framework can use the REST API or MCP server directly.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {stackExamples.map((stack) => {
            const Icon = stack.icon;
            const toneStyles = {
              eliza: 'border-violet-500/30 bg-violet-500/5',
              agentkit: 'border-blue-500/30 bg-blue-500/5',
              openai: 'border-emerald-500/30 bg-emerald-500/5',
              anthropic: 'border-amber-500/30 bg-amber-500/5',
            }[stack.tone];
            const toneBadge = {
              eliza: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
              agentkit: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
              openai: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
              anthropic: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
            }[stack.tone];
            return (
              <Card key={stack.name} className={`${toneStyles} transition-colors`}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-background/60">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg">{stack.name}</h3>
                        <span
                          className={`inline-block mt-0.5 px-2 py-0.5 rounded text-[11px] font-mono border ${toneBadge}`}
                        >
                          {stack.badge}
                        </span>
                      </div>
                    </div>
                  </div>
                  <pre className="overflow-x-auto rounded-lg bg-background/60 p-4 text-[11px] leading-relaxed text-muted-foreground border border-border/30 mb-4 whitespace-pre-wrap">
                    <code>{stack.code}</code>
                  </pre>
                  <p className="text-sm text-muted-foreground">{stack.desc}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ── Getting Started + SDK ──────────────────────────────────── */}
      <section className="container grid gap-6 py-12 border-t border-border/40 lg:grid-cols-2">
        <Card className="border-violet-500/30 bg-violet-500/5 transition-colors">
          <CardContent className="p-8">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-400">
              <TerminalSquare className="h-5 w-5" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">Getting Started</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              From UI, SDK, or any agent wallet — complete flow in one call.
            </p>
            <div className="mt-6 space-y-3">
              {[
                'Connect a wallet on Base mainnet.',
                'Choose a name + TLD (.xyz, .com, .ai, etc).',
                'Review the live USDC quote and sign the x402 payment.',
                'AgentDomain provisions domain, DNS, SSL, Basename, ENS, email, and mints the AgentID NFT.',
                "That's it — your agent has a real internet identity.",
                'Fund the RenewalVault for hands-free autonomous renewal.',
              ].map((step, i) => (
                <div key={i} className="flex gap-3 text-sm">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-xs font-bold text-violet-400">
                    {i + 1}
                  </div>
                  <span className="leading-6">{step}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/30 bg-emerald-500/5 transition-colors">
          <CardContent className="p-8">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
              <Code2 className="h-5 w-5" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">TypeScript SDK</h2>
            <pre className="mt-6 overflow-x-auto rounded-xl bg-background/70 p-4 text-xs text-muted-foreground border border-border/50">
              <code>{`const quote = await agentDomain.quote({
  preferredName: 'atlas',
  tld: 'com',
  years: 3,
  registerBasename: true,
  registerEns: true,
});

const identity = await agentDomain.register({
  preferredName: 'atlas',
  tld: 'com',
  years: 3,
  autoRenew: true,
  emailEnabled: true,
});`}</code>
            </pre>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              The <code>@agentdomain/sdk</code> handles the 402 challenge, signs EIP-3009 from your
              wallet, and completes registration in one async call.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ── API Reference (kept as-is) ──────────────────────────────── */}
      <section id="api" className="container py-16 border-t border-border/40">
        <div className="mb-8">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">API Reference</h2>
              <p className="mt-2 text-muted-foreground max-w-2xl">
                Every endpoint available to manage your agent&rsquo;s identity. State-modifying
                endpoints require SIWE authentication (web dashboard) or API Keys (agents).
              </p>
            </div>
            <div className="rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary font-medium">
              USDC x402 Secured
            </div>
          </div>
        </div>

        <div className="space-y-12">
          {apiEndpoints.map((group) => (
            <div key={group.group}>
              <h3 className="text-xl font-semibold mb-4 text-primary">{group.group}</h3>
              <div className="grid gap-4 md:grid-cols-2">
                {group.endpoints.map((api) => (
                  <Card key={api.title} className="border-border/40 bg-card/50">
                    <CardContent className="p-5 flex flex-col h-full">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-base font-semibold">{api.title}</div>
                        <MethodBadge method={api.method} />
                      </div>
                      <code className="block overflow-x-auto rounded border border-border/40 bg-background/50 p-2 text-xs text-muted-foreground mb-3 font-mono">
                        {api.path}
                      </code>
                      <p className="text-sm text-muted-foreground mt-auto">{api.text}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Autonomous Agent Guide ─────────────────────────────────── */}
      <section id="agent-guide" className="container py-16 border-t border-border/40">
        <div className="mb-10">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-400">
            <ShieldCheck className="h-4 w-4" />
            Autonomous Agent Guide
          </div>
          <h2 className="text-3xl font-bold tracking-tight">Ownership &amp; Vault</h2>
          <p className="mt-2 text-muted-foreground max-w-3xl">
            How ownership works, how to fund the vault, and how autonomous renewal keeps your
            identity alive forever.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-border/40 bg-card/50">
            <CardContent className="p-8">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" />
                Payer vs Owner
              </h3>
              <div className="space-y-3 text-sm leading-6 text-muted-foreground">
                <p>
                  Specify a different <strong className="text-foreground">ownerAddress</strong> from
                  the paying wallet. The <strong className="text-foreground">Payer</strong> pays
                  USDC, but the <strong className="text-foreground">Owner</strong> receives the NFT
                  and full control.
                </p>
                <div className="rounded-lg border border-border/40 bg-background/50 p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    <span>
                      <strong className="text-foreground">Owner:</strong> dashboard, DNS, email,
                      withdraw from vault, toggle auto-renew
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
                    <span>
                      <strong className="text-foreground">Anyone:</strong> deposit USDC into vault
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                    <span>
                      <strong className="text-foreground">Payer:</strong> nothing after purchase
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-card/50">
            <CardContent className="p-8">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Coins className="h-5 w-5 text-emerald-400" />
                Vault &amp; Auto-Renew
              </h3>
              <div className="space-y-3 text-sm leading-6 text-muted-foreground">
                <p>
                  RenewalVault holds USDC per domain. Keeper Bot checks every 5 minutes — when
                  expiry nears and vault has funds, it auto-renews.
                </p>
                <div className="rounded-lg border border-border/40 bg-background/50 p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    <span>
                      <strong className="text-foreground">Deposit = ON:</strong> auto-renew enables
                      automatically
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    <span>
                      <strong className="text-foreground">No cap:</strong> deposit anytime to extend
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    <span>
                      <strong className="text-foreground">Withdraw:</strong> owner can pull unused
                      funds
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/30 bg-primary/5 lg:col-span-2">
            <CardContent className="p-8">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Code2 className="h-5 w-5 text-primary" />
                Agent Autonomous Flow (SDK)
              </h3>
              <p className="text-sm text-muted-foreground mb-5">
                Full lifecycle — register, fund vault, check status, withdraw.
              </p>
              <pre className="overflow-x-auto rounded-xl bg-background/70 p-5 text-xs text-muted-foreground border border-border/50 leading-relaxed">
                <code>{`import { AgentDomain } from '@agentdomain/sdk';
const ad = new AgentDomain({ walletClient, publicClient });

// Register
const identity = await ad.register({
  preferredName: 'atlas', tld: 'com',
  years: 1, autoRenew: true,
  registerBasename: true, registerEns: true,
  emailEnabled: true,
});
// → atlas.com · atlas.base.eth · atlas.eth · agent@atlas.com

// Fund vault
await ad.fundRenewalVault(identity.agentId, '120');

// Check status
const status = await ad.getRenewalStatus(identity.agentId);
console.log(status.estimatedYearsCovered); // ~10

// Withdraw unused (owner only)
await ad.withdrawFromVault(identity.agentId, '24');`}</code>
              </pre>
            </CardContent>
          </Card>
        </div>
      </section>

      <Footer />
    </main>
  );
}
