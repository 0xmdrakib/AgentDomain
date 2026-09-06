'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { LandingNav } from '@/components/landing/nav';
import { Footer } from '@/components/landing/footer';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import { RenewalManagement } from '@/components/agents/renewal-management';
import { DnsManagement } from '@/components/agents/dns-management';
import { EmailManagement } from '@/components/agents/email-management';
import { ServicePlanManagement } from '@/components/agents/service-plan-management';
import { ApiKeyManagement } from '@/components/agents/api-key-management';
import { OwnerManagementGate } from '@/components/agents/owner-management-gate';
import { shortAddress, formatDate, timeAgo } from '@/lib/utils';
import {
  managementViewSchema,
  type ManagementView,
  type PublicAgentView,
} from '@/lib/backend-contracts';
import { useSiwe } from '@/hooks/use-siwe';
import { normalizeAddress } from '@/lib/address';
import { API_TIMEOUT_MS } from '@/lib/transport-policy';
import { REGISTRATION_CHANGED_EVENT } from '@/lib/registration-progress';

export function AgentDetailClient({ agent }: { agent: PublicAgentView }) {
  const router = useRouter();
  const { address } = useAccount();
  const { session } = useSiwe();
  const wallet = normalizeAddress(address);
  const sessionWallet = normalizeAddress(session.address);
  const eligible = Boolean(session.authenticated && wallet && wallet === sessionWallet);
  const [loaded, setLoaded] = useState<{ wallet: string; value: ManagementView } | null>(null);
  const [revision, setRevision] = useState(0);
  const [managementError, setManagementError] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setRevision((value) => value + 1);
      router.refresh();
    };
    window.addEventListener(REGISTRATION_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(REGISTRATION_CHANGED_EVENT, refresh);
  }, [router]);

  useEffect(() => {
    setLoaded(null);
    setManagementError(false);
    if (!eligible || !wallet) return;
    const controller = new AbortController();
    fetch(`/api/v1/agents/${encodeURIComponent(agent.id)}/management-view`, {
      credentials: 'include',
      cache: 'no-store',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(API_TIMEOUT_MS)]),
    })
      .then(async (response) => {
        if ([401, 403, 404].includes(response.status)) return;
        if (!response.ok) throw new Error('Management unavailable');
        const view = managementViewSchema.parse(await response.json());
        if (view.agent.id !== agent.id) throw new Error('Invalid management response');
        if (!controller.signal.aborted) setLoaded({ wallet, value: view });
      })
      .catch(() => {
        if (!controller.signal.aborted) setManagementError(true);
      });
    return () => controller.abort();
  }, [agent.id, eligible, wallet, revision]);

  const management =
    eligible && loaded?.wallet === wallet && loaded.value.agent.id === agent.id
      ? loaded.value
      : null;
  const canManage = management !== null;
  const dns = management?.dns ?? [];
  const inbox = management?.inbox ?? null;
  const ownerAddress = agent.ownerAddress;
  const payerAddress = management?.agent.walletAddress ?? ownerAddress;
  const hasSeparatePayer = ownerAddress.toLowerCase() !== payerAddress.toLowerCase();
  const metadataUri = management?.agent.metadataUri;
  const metadataGateway = management?.publicConfig.metadataGateway.replace(/\/+$/, '');

  return (
    <main className="min-h-screen bg-background">
      <LandingNav />

      <section className="container max-w-6xl py-10 sm:py-12">
        <div className="mb-6 sm:mb-8">
          <Link href="/registry" className="text-sm text-muted-foreground hover:text-foreground">
            Back to registry
          </Link>
        </div>

        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar seed={agent.domain} />
            <div className="min-w-0">
              <h1 className="wrap-anywhere text-2xl font-bold tracking-tight sm:text-3xl">
                {agent.domain}
              </h1>
              {agent.basename && (
                <div className="wrap-anywhere mt-1 font-mono text-sm text-muted-foreground">
                  {agent.basename}
                </div>
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
          <InfoCard title="Domain" value={agent.domain} href={`https://${agent.domain}`} />
          {agent.basename && (
            <InfoCard
              title="Basename"
              value={agent.basename}
              href={`https://www.base.org/name/${agent.basename.replace('.base.eth', '')}`}
            />
          )}
          {agent.ensName && <InfoCard title="ENS Name" value={agent.ensName} />}
          <InfoCard title="AgentID NFT" value={`#${agent.agentIdNft}`} />
          <InfoCard
            title="Owner"
            value={shortAddress(ownerAddress, 6)}
            href={`https://basescan.org/address/${ownerAddress}`}
          />
          {canManage && hasSeparatePayer && (
            <InfoCard
              title="Payer"
              value={shortAddress(payerAddress, 6)}
              href={`https://basescan.org/address/${payerAddress}`}
            />
          )}
          {canManage && inbox && <InfoCard title="Email" value={inbox.emailAddress} />}
          <InfoCard title="Registered" value={formatDate(agent.createdAt)} />
          {agent.expiresAt && (
            <InfoCard
              title="Expires"
              value={`${formatDate(agent.expiresAt)} (${timeAgo(agent.expiresAt)})`}
            />
          )}
        </div>

        {management ? (
          <>
            {/* Renewal Vault */}
            <RenewalManagement
              agentId={agent.id}
              tokenId={agent.agentIdNft}
              expiresAt={agent.expiresAt ? new Date(agent.expiresAt) : null}
              ownerAddress={ownerAddress}
              contractAddresses={{
                usdc: management.publicConfig.usdc as `0x${string}`,
                renewalVault: management.publicConfig.renewalVault as `0x${string}` | null,
              }}
              builderCode={management.publicConfig.builderCode}
            />

            {/* Premium Plan */}
            <ServicePlanManagement agentId={agent.id} />

            {/* API Keys */}
            <ApiKeyManagement agentId={agent.id} />

            {/* Email Management */}
            <EmailManagement agentId={agent.id} inbox={inbox} />

            {/* DNS Management */}
            <DnsManagement agentId={agent.id} initialDns={dns} />

            {/* Metadata */}
            {metadataUri && (
              <Card className="premium-surface">
                <CardContent className="p-4 sm:p-6">
                  <h2 className="font-semibold mb-3">Metadata</h2>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <code className="wrap-anywhere flex-1 text-xs font-mono text-muted-foreground">
                      {metadataUri}
                    </code>
                    <a
                      href={metadataUri.replace('ipfs://', `${metadataGateway}/`)}
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
          </>
        ) : (
          <>
            {managementError && (
              <p role="alert" className="mb-4 text-sm text-destructive">
                Management is temporarily unavailable.
              </p>
            )}
            <OwnerManagementGate
              ownerAddress={ownerAddress}
              onRefresh={() => setRevision((value) => value + 1)}
            />
          </>
        )}
      </section>

      <Footer />
    </main>
  );
}

function InfoCard({ title, value, href }: { title: string; value: string; href?: string }) {
  const content = (
    <Card className="interactive-surface premium-surface h-full min-h-[78px]">
      <CardContent className="flex min-h-[78px] flex-col justify-center p-4">
        <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">{title}</div>
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
