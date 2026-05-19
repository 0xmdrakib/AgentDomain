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
    GET: 'bg-green-900/10 text-green-900 border-green-900/20',
    POST: 'bg-stone-900/10 text-stone-900 border-stone-900/20',
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
      <section className="premium-shell relative overflow-hidden border-b border-border/50">
        <div className="absolute inset-0 grid-pattern opacity-60" />
        <div className="container relative py-14 sm:py-20 md:py-28">
          <div className="max-w-4xl">
            <div className="mb-5 inline-flex max-w-full items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary sm:mb-6 sm:px-4">
              <BookOpen className="h-4 w-4" />
              <span className="wrap-anywhere">AgentDomain Documentation</span>
            </div>
            <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-6xl">
              Identity infrastructure for the agent economy.
            </h1>
            <p className="mt-5 max-w-3xl text-base text-muted-foreground sm:text-lg md:text-xl">
              Domain + Basename + ENS + DNS + SSL + Email in one checkout. Works with ElizaOS,
              AgentKit, OpenAI SDK, and Anthropic SDK.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/register" className="w-full sm:w-auto">
                <Button variant="gradient" size="lg" className="w-full sm:w-auto">
                  Register an agent
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <a href="#api" className="w-full sm:w-auto">
                <Button variant="outline" size="lg" className="w-full sm:w-auto">
                  Jump to API
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Agent Stack SDK Examples ──────────────────────────────── */}
      <section id="stacks" className="container py-12 sm:py-16">
        <div className="mb-8 sm:mb-10">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Works with your agent stack</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">
            First-class integrations for ElizaOS and Coinbase AgentKit. Tool adapters for OpenAI SDK
            and Anthropic SDK. Any other framework can use the REST API or MCP server directly.
          </p>
        </div>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2 sm:gap-6">
          {stackExamples.map((stack) => {
            const Icon = stack.icon;
            const toneStyles = {
              eliza: 'border-primary/20 bg-card/45',
              agentkit: 'border-primary/20 bg-card/45',
              openai: 'border-primary/20 bg-card/45',
              anthropic: 'border-amber-500/30 bg-amber-500/5',
            }[stack.tone];
            const toneBadge = {
              eliza: 'bg-orange-600/10 text-orange-800 border-orange-700/20',
              agentkit: 'bg-stone-900/10 text-stone-900 border-stone-900/20',
              openai: 'bg-green-900/10 text-green-900 border-green-900/20',
              anthropic: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
            }[stack.tone];
            return (
              <Card key={stack.name} className={`${toneStyles} premium-surface min-w-0 transition-colors`}>
                <CardContent className="min-w-0 p-4 sm:p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background/60">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="wrap-anywhere text-lg font-semibold">{stack.name}</h3>
                        <span
                          className={`wrap-anywhere mt-0.5 inline-block rounded border px-2 py-0.5 font-mono text-[11px] ${toneBadge}`}
                        >
                          {stack.badge}
                        </span>
                      </div>
                    </div>
                  </div>
                  <pre className="code-surface mobile-scroll mb-4 max-w-full rounded-lg border p-3 text-[11px] leading-relaxed text-muted-foreground sm:p-4">
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
      <section className="container grid min-w-0 gap-4 border-t border-border/40 py-10 lg:grid-cols-2 sm:gap-6 sm:py-12">
        <Card className="premium-surface min-w-0 border-primary/20 transition-colors">
          <CardContent className="min-w-0 p-5 sm:p-8">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-700/20 bg-orange-600/10 text-orange-800">
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
                <div key={i} className="flex min-w-0 gap-3 text-sm">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-orange-700/20 bg-orange-600/10 text-xs font-bold text-orange-800">
                    {i + 1}
                  </div>
                  <span className="wrap-anywhere leading-6">{step}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="premium-surface min-w-0 border-primary/20 transition-colors">
          <CardContent className="min-w-0 p-5 sm:p-8">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-green-900/20 bg-green-900/10 text-green-900">
              <Code2 className="h-5 w-5" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">TypeScript SDK</h2>
            <pre className="code-surface mobile-scroll mt-6 max-w-full rounded-lg border p-3 text-xs text-muted-foreground sm:p-4">
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
      <section id="api" className="container border-t border-border/40 py-12 sm:py-16">
        <div className="mb-8">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">API Reference</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
                Every endpoint available to manage your agent&rsquo;s identity. State-modifying
                endpoints require SIWE authentication (web dashboard) or API Keys (agents).
              </p>
            </div>
            <div className="self-start rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
              USDC x402 Secured
            </div>
          </div>
        </div>

        <div className="space-y-12">
          {apiEndpoints.map((group) => (
            <div key={group.group}>
              <h3 className="text-xl font-semibold mb-4 text-primary">{group.group}</h3>
              <div className="grid min-w-0 gap-4 md:grid-cols-2">
                {group.endpoints.map((api) => (
                  <Card key={api.title} className="interactive-surface premium-surface min-w-0">
                    <CardContent className="flex h-full min-w-0 flex-col p-4 sm:p-5">
                      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="wrap-anywhere text-base font-semibold">{api.title}</div>
                        <MethodBadge method={api.method} />
                      </div>
                      <code className="mobile-scroll mb-3 block max-w-full rounded border border-border/60 bg-background/55 p-2 font-mono text-xs text-muted-foreground">
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
      <section id="agent-guide" className="container border-t border-border/40 py-12 sm:py-16">
        <div className="mb-8 sm:mb-10">
          <div className="mb-4 inline-flex max-w-full items-center gap-2 rounded-full border border-green-900/20 bg-green-900/10 px-3 py-2 text-sm text-green-900 sm:px-4">
            <ShieldCheck className="h-4 w-4" />
            <span className="wrap-anywhere">Autonomous Agent Guide</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Ownership &amp; Vault</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">
            How ownership works, how to fund the vault, and how autonomous renewal keeps your
            identity alive forever.
          </p>
        </div>

        <div className="grid min-w-0 gap-4 lg:grid-cols-2 sm:gap-6">
          <Card className="premium-surface min-w-0">
            <CardContent className="min-w-0 p-5 sm:p-8">
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
                <div className="premium-surface rounded-lg border p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-900 mt-0.5 shrink-0" />
                    <span>
                      <strong className="text-foreground">Owner:</strong> dashboard, DNS, email,
                      withdraw from vault, toggle auto-renew
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-stone-700 mt-0.5 shrink-0" />
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

          <Card className="premium-surface min-w-0">
            <CardContent className="min-w-0 p-5 sm:p-8">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Coins className="h-5 w-5 text-green-900" />
                Vault &amp; Auto-Renew
              </h3>
              <div className="space-y-3 text-sm leading-6 text-muted-foreground">
                <p>
                  RenewalVault holds USDC per domain. Keeper Bot checks every 5 minutes — when
                  expiry nears and vault has funds, it auto-renews.
                </p>
                <div className="premium-surface rounded-lg border p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-900 mt-0.5 shrink-0" />
                    <span>
                      <strong className="text-foreground">Deposit = ON:</strong> auto-renew enables
                      automatically
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-900 mt-0.5 shrink-0" />
                    <span>
                      <strong className="text-foreground">No cap:</strong> deposit anytime to extend
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-900 mt-0.5 shrink-0" />
                    <span>
                      <strong className="text-foreground">Withdraw:</strong> owner can pull unused
                      funds
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="premium-surface premium-elevated min-w-0 border-primary/30 lg:col-span-2">
            <CardContent className="min-w-0 p-5 sm:p-8">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Code2 className="h-5 w-5 text-primary" />
                Agent Autonomous Flow (SDK)
              </h3>
              <p className="text-sm text-muted-foreground mb-5">
                Full lifecycle — register, fund vault, check status, withdraw.
              </p>
              <pre className="code-surface mobile-scroll max-w-full rounded-lg border p-3 text-xs leading-relaxed text-muted-foreground sm:p-5">
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
