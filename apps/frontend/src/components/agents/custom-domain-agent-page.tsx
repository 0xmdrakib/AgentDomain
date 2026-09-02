import Link from 'next/link';
import {
  Bot,
  CalendarClock,
  ExternalLink,
  Fingerprint,
  Globe2,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import type { PublicAgentView } from '@/lib/backend-contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn, formatDate, shortAddress, timeAgo } from '@/lib/utils';

export function CustomDomainAgentPage({
  agent,
  requestedHost,
}: {
  agent: PublicAgentView | null;
  requestedHost: string;
}) {
  if (!agent) {
    return <UnknownDomainPage requestedHost={requestedHost} />;
  }

  const ownerAddress = agent.ownerAddress;
  const metadata = {
    name: agent.displayName,
    description: agent.description ?? 'Verified AI agent identity registered on AgentDomain.',
  };
  const capabilities = agent.capabilities;

  return (
    <main className="min-h-screen bg-background">
      <section className="container max-w-5xl py-8 sm:py-12">
        <header className="mb-10 flex flex-col gap-5 border-b border-border/60 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <Avatar seed={agent.domain} />
            <div className="min-w-0">
              <div className="wrap-anywhere text-lg font-semibold tracking-tight sm:text-xl">
                {metadata.name}
              </div>
              <div className="wrap-anywhere text-sm text-muted-foreground">{agent.domain}</div>
            </div>
          </Link>
          <Badge variant={agent.sslStatus === 'active' ? 'success' : 'secondary'}>
            SSL {agent.sslStatus}
          </Badge>
        </header>

        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <section>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge variant="outline">AgentID #{agent.agentIdNft}</Badge>
              {agent.framework && <Badge variant="secondary">{agent.framework}</Badge>}
              {agent.basename && <Badge variant="outline">{agent.basename}</Badge>}
            </div>
            <h1 className="wrap-anywhere max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
              {metadata.name}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              {metadata.description}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild>
                <Link href={`https://agentdomain.app/agents/${agent.id}`}>
                  View full identity
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a
                  href={`https://basescan.org/address/${ownerAddress}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Owner wallet
                  <Wallet className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </section>

          <Card className="premium-surface">
            <CardContent className="grid gap-3 p-4 sm:p-5">
              <Fact icon={Globe2} label="Domain" value={agent.domain} />
              <Fact icon={Fingerprint} label="AgentID NFT" value={`#${agent.agentIdNft}`} />
              <Fact icon={Wallet} label="Owner" value={shortAddress(ownerAddress, 8)} />
              <Fact icon={ShieldCheck} label="Status" value={agent.status} />
              {agent.expiresAt && (
                <Fact
                  icon={CalendarClock}
                  label="Expires"
                  value={`${formatDate(agent.expiresAt)} (${timeAgo(agent.expiresAt)})`}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {capabilities.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Capabilities
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {capabilities.map((capability) => (
                <div
                  key={capability}
                  className="rounded-lg border border-border/70 bg-card/70 px-4 py-3 text-sm"
                >
                  {capability}
                </div>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function UnknownDomainPage({ requestedHost }: { requestedHost: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md premium-surface">
        <CardContent className="p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-secondary">
            <Bot className="h-6 w-6 text-muted-foreground" />
          </div>
          <h1 className="wrap-anywhere text-xl font-semibold">Identity not found</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {requestedHost} is routed through AgentDomain, but no active agent identity is attached
            to this domain.
          </p>
          <Button asChild className="mt-5">
            <Link href="https://agentdomain.app/registry">Browse registry</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Globe2; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/45 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="wrap-anywhere text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}

function Avatar({ seed }: { seed: string }) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash << 5) - hash + seed.charCodeAt(i);
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 48) % 360;
  return (
    <div
      className={cn('h-12 w-12 shrink-0 rounded-lg border border-border/70 shadow-sm')}
      style={{
        background: `linear-gradient(135deg, hsl(${h1}, 70%, 55%), hsl(${h2}, 70%, 55%))`,
      }}
    />
  );
}
