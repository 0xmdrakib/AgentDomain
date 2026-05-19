import { notFound } from 'next/navigation';
import Link from 'next/link';
import { LandingNav } from '@/components/landing/nav';
import { Footer } from '@/components/landing/footer';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Copy } from 'lucide-react';
import { RenewalManagement } from '@/components/agents/renewal-management';
import { DnsManagement } from '@/components/agents/dns-management';
import { agentsRepo, dnsRepo, emailRepo } from '@/db';
import { shortAddress, formatDate, timeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getAgentData(id: string) {
  try {
    const agent = await agentsRepo.getById(id);
    if (!agent) return null;

    const [dnsList, inbox] = await Promise.all([dnsRepo.list(id), emailRepo.getInboxByAgent(id)]);

    return { agent, dns: dnsList, inbox: inbox ?? null };
  } catch {
    return null;
  }
}

export default async function AgentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const data = await getAgentData(id);
  if (!data) return notFound();
  const { agent, dns, inbox } = data;

  return (
    <main className="min-h-screen bg-background">
      <LandingNav />

      <section className="container max-w-4xl py-10 sm:py-12">
        <div className="mb-6 sm:mb-8">
          <Link href="/registry" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to registry
          </Link>
        </div>

        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar seed={agent.domain} />
            <div className="min-w-0">
              <h1 className="wrap-anywhere text-2xl font-bold tracking-tight sm:text-3xl">{agent.domain}</h1>
              {agent.basename && (
                <div className="wrap-anywhere mt-1 font-mono text-sm text-muted-foreground">{agent.basename}</div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={agent.status === 'active' ? 'success' : 'secondary'}>
              {agent.status}
            </Badge>
            {agent.framework && <Badge variant="outline">{agent.framework}</Badge>}
            <Badge variant="outline">SSL: {agent.sslStatus}</Badge>
          </div>
        </div>

        {/* Identity grid */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:mb-10 md:grid-cols-2">
          <InfoCard
            title="Domain"
            value={agent.domain}
            href={`https://${agent.domain}`}
          />
          {agent.basename && (
            <InfoCard
              title="Basename"
              value={agent.basename}
              href={`https://www.base.org/name/${agent.basename.replace('.base.eth', '')}`}
            />
          )}
          {agent.ensName && <InfoCard title="ENS Name" value={agent.ensName} />}
          <InfoCard
            title="AgentID NFT"
            value={`#${agent.agentIdNft}`}
          />
          <InfoCard
            title="Owner"
            value={shortAddress(agent.walletAddress, 6)}
            href={`https://basescan.org/address/${agent.walletAddress}`}
          />
          {inbox && <InfoCard title="Email" value={inbox.emailAddress} />}
          <InfoCard title="Registered" value={formatDate(agent.createdAt)} />
          {agent.expiresAt && (
            <InfoCard title="Expires" value={`${formatDate(agent.expiresAt)} (${timeAgo(agent.expiresAt)})`} />
          )}
        </div>

        {/* Renewal Vault */}
        <RenewalManagement agentId={agent.id} tokenId={agent.agentIdNft} expiresAt={agent.expiresAt} />

        {/* DNS Management */}
        <DnsManagement agentId={agent.id} initialDns={dns} />

        {/* Metadata */}
        {agent.metadataUri && (
          <Card className="premium-surface">
            <CardContent className="p-4 sm:p-6">
              <h2 className="font-semibold mb-3">Metadata</h2>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <code className="wrap-anywhere flex-1 text-xs font-mono text-muted-foreground">
                  {agent.metadataUri}
                </code>
                <a
                  href={agent.metadataUri.replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/')}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline" size="sm" className="w-full sm:w-auto">
                    View
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </a>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      <Footer />
    </main>
  );
}

function InfoCard({ title, value, href }: { title: string; value: string; href?: string }) {
  const content = (
    <Card className="interactive-surface premium-surface h-full">
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{title}</div>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm break-all">{value}</span>
          {href && <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
        </div>
      </CardContent>
    </Card>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {content}
      </a>
    );
  }
  return content;
}

function Avatar({ seed }: { seed: string }) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash << 5) - hash + seed.charCodeAt(i);
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 60) % 360;
  return (
    <div
      className="h-16 w-16 rounded-full flex-shrink-0"
      style={{
        background: `linear-gradient(135deg, hsl(${h1}, 70%, 55%), hsl(${h2}, 70%, 55%))`,
      }}
    />
  );
}
