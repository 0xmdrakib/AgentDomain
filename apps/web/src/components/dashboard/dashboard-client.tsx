'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAccount, useChainId } from 'wagmi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, ExternalLink, Wallet, Loader2 } from 'lucide-react';
import { ConnectWalletButton } from '@/components/wallet/connect-wallet-button';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';
import { shortAddress, formatDate } from '@/lib/utils';

interface Agent {
  id: string;
  domain: string;
  basename: string | null;
  ensName: string | null;
  agentIdNft: number;
  status: string;
  framework: string | null;
  sslStatus: string;
  createdAt: string;
  expiresAt: string | null;
}

export function DashboardClient() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { balanceFormatted, isLoading: balanceLoading } = useUsdcBalance(address, chainId);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setAgents([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/v1/agents/by-wallet/${address}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as Agent[];
      })
      .then((agentList) => {
        if (cancelled) return;
        setAgents(Array.isArray(agentList) ? agentList : []);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  // Prevent hydration flash
  if (!mounted) return null;

  const renewalsDueCount = agents.filter((a) => {
    if (a.status !== 'active' || !a.expiresAt) return false;
    const daysUntilExpiry = (new Date(a.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return daysUntilExpiry <= 30 && daysUntilExpiry >= 0;
  }).length;

  return (
    <section className="container py-12">
      <div className="flex items-end justify-between mb-10 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Manage your agent fleet.</p>
        </div>
        <Link href="/register">
          <Button variant="gradient">
            <Plus className="h-4 w-4" />
            Register agent
          </Button>
        </Link>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-10">
        <Stat label="Total agents" value={String(agents.length)} loading={loading} />
        <Stat
          label="Active identities"
          value={String(agents.filter((a) => a.status === 'active').length)}
          loading={loading}
        />
        <Stat
          label="Wallet balance"
          value={isConnected ? `$${Number(balanceFormatted).toFixed(2)}` : '—'}
          loading={balanceLoading}
        />
        <Stat label="Renewals due" value={String(renewalsDueCount)} loading={loading} />
      </div>

      {/* Wallet not connected */}
      {!isConnected ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Wallet className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-semibold mb-2">Connect your wallet</h2>
            <p className="text-sm text-muted-foreground mb-6">
              See your agents and manage renewals.
            </p>
            <ConnectWalletButton variant="gradient" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Your agents</CardTitle>
            {address && (
              <div className="text-xs font-mono text-muted-foreground">{shortAddress(address)}</div>
            )}
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-12 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
              </div>
            ) : agents.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-muted-foreground mb-4">No agents yet.</p>
                <Link href="/register">
                  <Button variant="gradient">
                    <Plus className="h-4 w-4" />
                    Register your first agent
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {agents.map((agent) => (
                  <Link key={agent.id} href={`/agents/${agent.id}`}>
                    <div className="flex items-center justify-between gap-4 py-4 hover:bg-accent/30 -mx-6 px-6 transition-colors">
                      <div className="flex items-center gap-4 min-w-0">
                        <div
                          className="h-10 w-10 rounded-full flex-shrink-0"
                          style={avatarGradient(agent.domain)}
                        />
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{agent.domain}</div>
                          {agent.basename && (
                            <div className="text-xs font-mono text-muted-foreground truncate">
                              {agent.basename}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant={agent.status === 'active' ? 'success' : 'secondary'}>
                          {agent.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground hidden md:inline">
                          {formatDate(agent.createdAt)}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-10">
        <ResourceCard
          title="API Documentation"
          desc="Integrate AgentDomain into your agent."
          href="/docs"
        />
        <ResourceCard
          title="Agent API"
          desc="Let agents buy identities with x402 payments."
          href="/docs#api"
        />
        <ResourceCard
          title="SDK Example"
          desc="Use the TypeScript SDK registration flow."
          href="/docs#stacks"
        />
      </div>
    </section>
  );
}

function Stat({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return (
    <Card className="border-border/40">
      <CardContent className="p-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-3xl font-bold mt-2 tabular-nums">
          {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : value}
        </div>
      </CardContent>
    </Card>
  );
}

function ResourceCard({ title, desc, href }: { title: string; desc: string; href: string }) {
  return (
    <Link href={href}>
      <Card className="h-full border-border/40 transition-all hover:border-primary/50">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground mt-1">{desc}</p>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function avatarGradient(seed: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash << 5) - hash + seed.charCodeAt(i);
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 60) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${h1}, 70%, 55%), hsl(${h2}, 70%, 55%))`,
  };
}
