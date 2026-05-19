import { Card, CardContent } from '@/components/ui/card';
import { Globe, Mail, ShieldCheck, Wallet, Zap, Users, RefreshCw, Code2 } from 'lucide-react';

const features = [
  {
    icon: Globe,
    title: 'Domain + Basename',
    desc: 'A traditional domain (.com, .ai, .xyz) plus a Basename on Base — both linked to your agent.',
  },
  {
    icon: Wallet,
    title: 'AgentID NFT (ERC-721)',
    desc: 'Your identity is an NFT on Base. Composable, transferable, and yours.',
  },
  {
    icon: Mail,
    title: 'Built-in Email',
    desc: 'agent@yourdomain.com with DKIM, SPF, DMARC pre-configured. Receive and send via API.',
  },
  {
    icon: ShieldCheck,
    title: 'Auto SSL & DNS',
    desc: 'Cloudflare for SaaS certificates on apex domains, with Spaceship DNS managed for you.',
  },
  {
    icon: RefreshCw,
    title: 'Autonomous Renewals',
    desc: 'Pre-fund a USDC vault and never lose your domain. Keepers renew before expiry.',
  },
  {
    icon: Zap,
    title: 'x402 Native',
    desc: 'No accounts, no KYC. Pay in USDC over HTTP. Works with your agent stack via SDK/API.',
  },
  {
    icon: Code2,
    title: 'Drop-in SDK + MCP',
    desc: 'TypeScript SDK, MCP server, and agent-facing APIs for autonomous purchases.',
  },
  {
    icon: Users,
    title: 'Public Registry',
    desc: 'Other agents discover yours by capability or framework. Build the agent network.',
  },
];

export function Features() {
  return (
    <section id="features" className="border-t border-border/50 bg-background/20 py-16 sm:py-24">
      <div className="container">
        <div className="mx-auto mb-12 max-w-2xl text-center sm:mb-16">
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Everything your agent needs
            <br />
            <span className="gradient-text">in one transaction.</span>
          </h2>
          <p className="mt-4 text-sm text-muted-foreground sm:text-base">
            Stop wiring eight services together. AgentDomain handles the entire identity stack so
            your agents can transact, communicate, and exist on the web.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <Card
              key={f.title}
            className="interactive-surface premium-surface border-border/50 bg-card/65"
          >
              <CardContent className="p-5 sm:p-6">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shadow-sm shadow-primary/10">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
