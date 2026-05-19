'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input as UiInput } from '@/components/ui/input';
import {
  Loader2,
  ShieldAlert,
  RefreshCw,
  ExternalLink,
  Search,
  RotateCcw,
  XCircle,
  ShieldCheck,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Wrench,
  Globe,
  Mail,
  ChevronRight,
  ClipboardList,
} from 'lucide-react';
import { useSiwe } from '@/hooks/use-siwe';
import { AuthButton } from '@/components/wallet/auth-button';
import { cn, formatDate, formatUsd, shortAddress } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type AdminTab = 'agents' | 'registrations' | 'renewals' | 'discounts' | 'create';

interface Stats {
  agents: { total: number; active: number; expired: number; revoked: number };
  registrations: {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    last24h: number;
    last7d: number;
  };
  renewals: { total: number; completed: number; failed: number };
  revenue: { totalUsdc: string };
  generatedAt: string;
}

type AgentStatus = 'pending' | 'active' | 'expired' | 'revoked';
type AgentStatusFilter = AgentStatus | 'all';
type RegStatusFilter = 'pending' | 'completed' | 'failed' | 'all';
type RenewalStatusFilter = 'scheduled' | 'in_progress' | 'completed' | 'failed' | 'all';

interface AdminAgent {
  id: string;
  walletAddress: string;
  agentIdNft: number;
  domain: string;
  basename: string | null;
  ensName: string | null;
  status: AgentStatus;
  sslStatus: 'pending' | 'provisioning' | 'active' | 'failed' | 'expired';
  framework: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

interface AdminRegistration {
  id: string;
  agentId: string | null;
  payerAddress: string;
  paymentAmount: string;
  domainCost: string;
  basenameCost: string;
  ensCost: string;
  serviceFee: string;
  status: 'pending' | 'completed' | 'failed';
  errorMessage: string | null;
  requestParams: unknown;
  createdAt: string;
  completedAt: string | null;
  txHash: string | null;
  paymentTxHash?: string | null;
  progress?: {
    overall: 'pending' | 'running' | 'partial' | 'completed' | 'failed';
    currentStep: string | null;
    steps: Record<
      string,
      {
        status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
        updatedAt: string;
        error: string | null;
        txHash: string | null;
        note: string | null;
      }
    >;
  } | null;
}

interface AdminRegistrationCaseDetail {
  registration: AdminRegistration;
  agent: AdminAgent | null;
  dnsRecords: Array<{
    id: string;
    type: string;
    name: string;
    value: string;
    systemManaged: boolean;
    purpose: string | null;
  }>;
  ssl: {
    sslStatus: string;
    hostnameStatus: string;
    cloudflareCustomHostnameId: string;
  } | null;
  email: null | {
    inbox: {
      emailAddress: string;
      sesVerificationStatus: string;
    };
    messages: Array<{
      id: string;
      subject: string | null;
      fromAddress: string;
      receivedAt: string;
      read: boolean;
      verificationCodes?: string[] | null;
    }>;
  };
  caseSummary: {
    paymentSettled: boolean;
    identityComplete: boolean;
    partial: boolean;
    paymentTxHash: string | null;
    agentReady: boolean;
    sslReady: boolean;
    emailReady: boolean;
    messageCount: number;
    currentState: string;
  };
}

interface AdminRenewal {
  id: string;
  agentId: string;
  scheduledFor: string;
  amount: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'failed';
  txHash: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 10;

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function AdminDashboardClient() {
  const { session, signIn, loading: siweLoading, error: siweError } = useSiwe();
  const [tab, setTab] = useState<AdminTab>('agents');
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/stats', { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        setAccessDenied(true);
        return;
      }
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setStats((await res.json()) as Stats);
      setAccessDenied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session.authenticated) fetchStats();
    else setLoading(false);
  }, [fetchStats, session.authenticated]);

  if (!session.authenticated) {
    return (
      <section className="container py-12 text-center sm:py-16">
        <ShieldAlert className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Admin Access</h1>
        <p className="text-muted-foreground mb-6">
          Sign in with your admin wallet to access the console.
        </p>
        <div className="flex flex-col items-center gap-4">
          <AuthButton className="mx-auto inline-flex" />
          {siweError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive max-w-md">
              {siweError}
            </div>
          )}
          <Button variant="gradient" size="lg" onClick={signIn} disabled={siweLoading} className="w-full sm:w-auto">
            {siweLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign in with Ethereum'
            )}
          </Button>
        </div>
      </section>
    );
  }

  if (accessDenied) {
    return (
      <section className="container py-12 text-center sm:py-16">
        <ShieldAlert className="h-10 w-10 text-destructive mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
        <p className="text-muted-foreground">
          Your wallet is not on the admin list. Add your address to ADMIN_ADDRESSES env var.
        </p>
      </section>
    );
  }

  return (
    <section className="container py-10 sm:py-12">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Admin Console</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Platform-wide stats and operations.{' '}
            {stats?.generatedAt && (
              <span className="block text-xs sm:inline">
                Updated: {new Date(stats.generatedAt).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" onClick={fetchStats} disabled={loading} className="w-full sm:w-auto">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5 mb-6">
          <CardContent className="p-4 text-sm text-destructive">Error: {error}</CardContent>
        </Card>
      )}

      {loading && !stats && (
        <div className="py-16 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
        </div>
      )}

      {stats && (
        <>
          {/* Top stat cards */}
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total agents"
              value={stats.agents.total}
              breakdown={`${stats.agents.active} active`}
              tone="primary"
            />
            <StatCard
              label="Total revenue"
              value={formatUsd(Number(stats.revenue.totalUsdc) || 0)}
              breakdown="lifetime USDC"
              tone="success"
            />
            <StatCard
              label="Last 24h"
              value={stats.registrations.last24h}
              breakdown={`${stats.registrations.last7d} this week`}
            />
            <StatCard
              label="Failed registrations"
              value={stats.registrations.failed}
              breakdown={`of ${stats.registrations.total} total`}
              tone={stats.registrations.failed > 0 ? 'warning' : 'default'}
            />
          </div>

          {/* Tab bar */}
          <div className="premium-surface mb-6 flex gap-1 overflow-x-auto rounded-lg border p-1">
            {(
              [
                ['agents', 'Agents'],
                ['registrations', 'Registrations'],
                ['renewals', 'Renewals'],
                ['discounts', 'Discounts'],
                ['create', 'Create Agent'],
              ] as [AdminTab, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cn(
                  'whitespace-nowrap rounded-md border px-4 py-2.5 text-sm font-medium transition-colors',
                  tab === k
                    ? 'border-primary/35 bg-primary/10 text-foreground'
                    : 'text-muted-foreground hover:text-foreground border-transparent',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'agents' && <AgentsPanel />}
          {tab === 'registrations' && <RegistrationsPanel />}
          {tab === 'renewals' && <RenewalsPanel />}
          {tab === 'discounts' && <DiscountsPanel />}
          {tab === 'create' && <CreateAgentPanel />}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Agents Panel                                                       */
/* ------------------------------------------------------------------ */

function AgentsPanel() {
  const [data, setData] = useState<PaginatedResponse<AdminAgent> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AgentStatusFilter>('all');
  const [offset, setOffset] = useState(0);
  const [actionState, setActionState] = useState<Record<string, 'idle' | 'loading' | 'done'>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (query) params.set('q', query);
      if (status !== 'all') params.set('status', status);
      const res = await fetch(`/api/v1/admin/agents?${params}`, { credentials: 'include' });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setData((await res.json()) as PaginatedResponse<AdminAgent>);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [offset, query, status]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function doAction(agentId: string, endpoint: string, method: 'POST' | 'DELETE' = 'POST') {
    setActionState((s) => ({ ...s, [agentId]: 'loading' }));
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ reason: 'Admin action' }) : undefined,
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setActionState((s) => ({ ...s, [agentId]: 'done' }));
      fetchData();
    } catch (e) {
      setActionState((s) => ({ ...s, [agentId]: 'idle' }));
      setError(e instanceof Error ? e.message : 'Action failed');
    }
  }

  return (
    <Card>
      <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="text-base">Agent Operations</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">Search, revoke, re-provision SSL.</p>
        </div>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
            setOffset(0);
          }}
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents"
              className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
            />
          </div>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as AgentStatusFilter);
              setOffset(0);
            }}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="revoked">Revoked</option>
          </select>
          <Button type="submit" variant="secondary" className="w-full sm:w-auto">
            Search
          </Button>
        </form>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive mb-4">
            Error: {error}
          </div>
        )}
        {loading && !data ? (
          <div className="py-10 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
          </div>
        ) : data && data.items.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <th className="py-3 pr-3 font-medium">Agent</th>
                    <th className="py-3 pr-3 font-medium">Owner</th>
                    <th className="py-3 pr-3 font-medium">Status</th>
                    <th className="py-3 pr-3 font-medium">SSL</th>
                    <th className="py-3 pr-3 font-medium">Created</th>
                    <th className="py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((agent) => (
                    <tr key={agent.id} className="border-b border-border/30 last:border-0">
                      <td className="py-3.5 pr-3 min-w-52">
                        <div className="font-medium">{agent.domain}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          #{agent.agentIdNft} {agent.basename ?? agent.ensName ?? ''}
                        </div>
                        {agent.framework && (
                          <Badge variant="outline" className="mt-1.5 text-[10px]">
                            {agent.framework}
                          </Badge>
                        )}
                      </td>
                      <td className="py-3.5 pr-3 font-mono text-xs text-muted-foreground">
                        {shortAddress(agent.walletAddress)}
                      </td>
                      <td className="py-3.5 pr-3">
                        <StatusBadge status={agent.status} />
                      </td>
                      <td className="py-3.5 pr-3">
                        <SslBadge status={agent.sslStatus} />
                      </td>
                      <td className="py-3.5 pr-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(agent.createdAt)}
                      </td>
                      <td className="py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/agents/${agent.id}`}>View</Link>
                          </Button>
                          <RepairMenu
                            agentId={agent.id}
                            domain={agent.domain}
                            hasBasename={!!agent.basename}
                            hasEns={!!agent.ensName}
                            loading={actionState[agent.id + 'repair'] === 'loading'}
                            onAction={async (action) => {
                              setActionState((s) => ({ ...s, [agent.id + 'repair']: 'loading' }));
                              try {
                                const res = await fetch(`/api/v1/admin/agents/${agent.id}/repair`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ action }),
                                  credentials: 'include',
                                });
                                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                                setActionState((s) => ({ ...s, [agent.id + 'repair']: 'done' }));
                                fetchData();
                              } catch (e) {
                                setActionState((s) => ({ ...s, [agent.id + 'repair']: 'idle' }));
                                setError(e instanceof Error ? e.message : 'Repair failed');
                              }
                            }}
                          />
                          {agent.sslStatus !== 'active' && agent.sslStatus !== 'pending' && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={actionState[agent.id + 'ssl'] === 'loading'}
                              onClick={() =>
                                doAction(
                                  agent.id,
                                  `/api/v1/admin/agents/${agent.id}/ssl-reprovision`,
                                  'POST',
                                )
                              }
                            >
                              {actionState[agent.id + 'ssl'] === 'loading' ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <ShieldCheck className="h-3 w-3" />
                              )}
                              <span className="ml-1 hidden sm:inline">SSL</span>
                            </Button>
                          )}
                          {agent.status !== 'revoked' && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={actionState[agent.id + 'rev'] === 'loading'}
                              onClick={() =>
                                doAction(
                                  agent.id,
                                  `/api/v1/admin/agents/${agent.id}/revoke`,
                                  'POST',
                                )
                              }
                            >
                              {actionState[agent.id + 'rev'] === 'loading' ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <XCircle className="h-3 w-3" />
                              )}
                              <span className="ml-1 hidden sm:inline">Revoke</span>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 md:hidden">
              {data.items.map((agent) => (
                <div key={agent.id} className="premium-surface rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="wrap-anywhere font-medium">{agent.domain}</div>
                      <div className="wrap-anywhere mt-1 font-mono text-xs text-muted-foreground">
                        #{agent.agentIdNft} {agent.basename ?? agent.ensName ?? ''}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <StatusBadge status={agent.status} />
                        <SslBadge status={agent.sslStatus} />
                        {agent.framework && <Badge variant="outline">{agent.framework}</Badge>}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        Owner {shortAddress(agent.walletAddress)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Created {formatDate(agent.createdAt)}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <Button asChild variant="ghost" size="sm" className="w-full">
                        <Link href={`/agents/${agent.id}`}>View</Link>
                      </Button>
                      <RepairMenu
                        agentId={agent.id}
                        domain={agent.domain}
                        hasBasename={!!agent.basename}
                        hasEns={!!agent.ensName}
                        loading={actionState[agent.id + 'repair'] === 'loading'}
                        onAction={async (action) => {
                          setActionState((s) => ({ ...s, [agent.id + 'repair']: 'loading' }));
                          try {
                            const res = await fetch(`/api/v1/admin/agents/${agent.id}/repair`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action }),
                              credentials: 'include',
                            });
                            if (!res.ok) throw new Error(`HTTP ${res.status}`);
                            setActionState((s) => ({ ...s, [agent.id + 'repair']: 'done' }));
                            fetchData();
                          } catch (e) {
                            setActionState((s) => ({ ...s, [agent.id + 'repair']: 'idle' }));
                            setError(e instanceof Error ? e.message : 'Repair failed');
                          }
                        }}
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {agent.sslStatus !== 'active' && agent.sslStatus !== 'pending' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full sm:w-auto"
                        disabled={actionState[agent.id + 'ssl'] === 'loading'}
                        onClick={() =>
                          doAction(
                            agent.id,
                            `/api/v1/admin/agents/${agent.id}/ssl-reprovision`,
                            'POST',
                          )
                        }
                      >
                        {actionState[agent.id + 'ssl'] === 'loading' ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-3 w-3" />
                        )}
                        SSL
                      </Button>
                    )}
                    {agent.status !== 'revoked' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full sm:w-auto"
                        disabled={actionState[agent.id + 'rev'] === 'loading'}
                        onClick={() =>
                          doAction(
                            agent.id,
                            `/api/v1/admin/agents/${agent.id}/revoke`,
                            'POST',
                          )
                        }
                      >
                        {actionState[agent.id + 'rev'] === 'loading' ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <XCircle className="h-3 w-3" />
                        )}
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <Pagination
              total={data.total}
              offset={offset}
              hasMore={data.hasMore}
              pageSize={PAGE_SIZE}
              onChange={setOffset}
              loading={loading}
            />
          </>
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No agents match the current filters.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Registrations Panel                                                */
/* ------------------------------------------------------------------ */

function RegistrationsPanel() {
  const [data, setData] = useState<PaginatedResponse<AdminRegistration> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RegStatusFilter>('all');
  const [offset, setOffset] = useState(0);
  const [actionState, setActionState] = useState<Record<string, 'idle' | 'loading' | 'done'>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (status !== 'all') params.set('status', status);
      const res = await fetch(`/api/v1/admin/registrations?${params}`, { credentials: 'include' });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setData((await res.json()) as PaginatedResponse<AdminRegistration>);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [offset, status]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function doAction(regId: string, endpoint: string, label: string) {
    setActionState((s) => ({ ...s, [regId + label]: 'loading' }));
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Admin action' }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setActionState((s) => ({ ...s, [regId + label]: 'done' }));
      fetchData();
    } catch (e) {
      setActionState((s) => ({ ...s, [regId + label]: 'idle' }));
      setError(e instanceof Error ? e.message : 'Action failed');
    }
  }

  return (
    <Card>
      <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="text-base">Registration History</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Retry failed registrations or process refunds.
          </p>
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as RegStatusFilter);
            setOffset(0);
          }}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive mb-4">
            Error: {error}
          </div>
        )}
        {loading && !data ? (
          <div className="py-10 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
          </div>
        ) : data && data.items.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <th className="py-3 pr-3 font-medium">Payer</th>
                    <th className="py-3 pr-3 font-medium">Amount</th>
                    <th className="py-3 pr-3 font-medium">Status</th>
                    <th className="py-3 pr-3 font-medium">Error</th>
                    <th className="py-3 pr-3 font-medium">Created</th>
                    <th className="py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((reg) => {
                    const key = reg.id;
                    return (
                      <tr key={key} className="border-b border-border/30 last:border-0">
                        <td className="py-3.5 pr-3 font-mono text-xs text-muted-foreground">
                          {shortAddress(reg.payerAddress)}
                        </td>
                        <td className="py-3.5 pr-3 font-mono text-sm">${reg.paymentAmount}</td>
                        <td className="py-3.5 pr-3">
                          <RegistrationStatusBadge status={reg.status} />
                        </td>
                        <td className="py-3.5 pr-3 max-w-48">
                          {reg.errorMessage ? (
                            <span
                              className="text-xs text-destructive truncate block max-w-48"
                              title={reg.errorMessage}
                            >
                              {reg.errorMessage.length > 60
                                ? reg.errorMessage.slice(0, 60) + '…'
                                : reg.errorMessage}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3.5 pr-3 text-muted-foreground whitespace-nowrap">
                          {formatDate(reg.createdAt)}
                        </td>
                      <td className="py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedId(key)}
                          >
                            <ClipboardList className="h-3 w-3" />
                            <span className="ml-1 hidden sm:inline">Inspect</span>
                          </Button>
                          {reg.status === 'failed' && (
                            <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={actionState[key + 'retry'] === 'loading'}
                                  onClick={() =>
                                    doAction(
                                      key,
                                      `/api/v1/admin/registrations/${key}/retry`,
                                      'retry',
                                    )
                                  }
                                >
                                  {actionState[key + 'retry'] === 'loading' ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <RotateCcw className="h-3 w-3" />
                                  )}
                                  <span className="ml-1 hidden sm:inline">Retry</span>
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={actionState[key + 'refund'] === 'loading'}
                                  onClick={() =>
                                    doAction(
                                      key,
                                      `/api/v1/admin/registrations/${key}/refund`,
                                      'refund',
                                    )
                                  }
                                >
                                  {actionState[key + 'refund'] === 'loading' ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <XCircle className="h-3 w-3" />
                                  )}
                                  <span className="ml-1 hidden sm:inline">Refund</span>
                                </Button>
                              </>
                            )}
                            {reg.status !== 'failed' && (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 md:hidden">
              {data.items.map((reg) => {
                const key = reg.id;
                return (
                <div key={key} className="premium-surface rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-muted-foreground">
                          {shortAddress(reg.payerAddress)}
                        </div>
                        <div className="mt-1 font-mono text-lg font-semibold">${reg.paymentAmount}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <RegistrationStatusBadge status={reg.status} />
                          <span className="text-xs text-muted-foreground">
                            {formatDate(reg.createdAt)}
                          </span>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedId(key)}>
                        <ClipboardList className="h-3 w-3" />
                        Inspect
                      </Button>
                    </div>
                    {reg.errorMessage && (
                      <div className="wrap-anywhere mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                        {reg.errorMessage}
                      </div>
                    )}
                    {reg.status === 'failed' && (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={actionState[key + 'retry'] === 'loading'}
                          onClick={() =>
                            doAction(
                              key,
                              `/api/v1/admin/registrations/${key}/retry`,
                              'retry',
                            )
                          }
                        >
                          {actionState[key + 'retry'] === 'loading' ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                          Retry
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={actionState[key + 'refund'] === 'loading'}
                          onClick={() =>
                            doAction(
                              key,
                              `/api/v1/admin/registrations/${key}/refund`,
                              'refund',
                            )
                          }
                        >
                          {actionState[key + 'refund'] === 'loading' ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          Refund
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Pagination
              total={data.total}
              offset={offset}
              hasMore={data.hasMore}
              pageSize={PAGE_SIZE}
              onChange={setOffset}
              loading={loading}
            />
          </>
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No registrations found.
          </div>
        )}
      </CardContent>
      {selectedId && (
        <RegistrationCaseDrawer
          registrationId={selectedId}
          onClose={() => setSelectedId(null)}
          onRefresh={fetchData}
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Renewals Panel                                                     */
/* ------------------------------------------------------------------ */

function RenewalsPanel() {
  const [data, setData] = useState<PaginatedResponse<AdminRenewal> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RenewalStatusFilter>('all');
  const [offset, setOffset] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (status !== 'all') params.set('status', status);
      const res = await fetch(`/api/v1/admin/renewals?${params}`, { credentials: 'include' });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setData((await res.json()) as PaginatedResponse<AdminRenewal>);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [offset, status]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <Card>
      <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="text-base">Renewal Jobs</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">Track autonomous renewal attempts.</p>
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as RenewalStatusFilter);
            setOffset(0);
          }}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
        >
          <option value="all">All statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive mb-4">
            Error: {error}
          </div>
        )}
        {loading && !data ? (
          <div className="py-10 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
          </div>
        ) : data && data.items.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <th className="py-3 pr-3 font-medium">Agent ID</th>
                    <th className="py-3 pr-3 font-medium">Amount</th>
                    <th className="py-3 pr-3 font-medium">Status</th>
                    <th className="py-3 pr-3 font-medium">Attempts</th>
                    <th className="py-3 pr-3 font-medium">Error</th>
                    <th className="py-3 pr-3 font-medium">Scheduled</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id} className="border-b border-border/30 last:border-0">
                      <td className="py-3.5 pr-3 font-mono text-xs text-muted-foreground">
                        {r.agentId.slice(0, 8)}…
                      </td>
                      <td className="py-3.5 pr-3 font-mono text-sm">${r.amount}</td>
                      <td className="py-3.5 pr-3">
                        <RenewalStatusBadge status={r.status} />
                      </td>
                      <td className="py-3.5 pr-3 text-muted-foreground">{r.attemptCount}</td>
                      <td className="py-3.5 pr-3 max-w-48">
                        {r.lastError ? (
                          <span
                            className="text-xs text-destructive truncate block max-w-48"
                            title={r.lastError}
                          >
                            {r.lastError.length > 60 ? r.lastError.slice(0, 60) + '…' : r.lastError}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-3.5 pr-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(r.scheduledFor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 md:hidden">
              {data.items.map((r) => (
                <div key={r.id} className="premium-surface rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-muted-foreground">
                        {r.agentId.slice(0, 8)}...
                      </div>
                      <div className="mt-1 font-mono text-lg font-semibold">${r.amount}</div>
                    </div>
                    <RenewalStatusBadge status={r.status} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                    <div>
                      <div className="uppercase tracking-wide">Attempts</div>
                      <div className="mt-1 text-sm text-foreground">{r.attemptCount}</div>
                    </div>
                    <div>
                      <div className="uppercase tracking-wide">Scheduled</div>
                      <div className="mt-1 text-sm text-foreground">{formatDate(r.scheduledFor)}</div>
                    </div>
                  </div>
                  {r.lastError && (
                    <div className="wrap-anywhere mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                      {r.lastError}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Pagination
              total={data.total}
              offset={offset}
              hasMore={data.hasMore}
              pageSize={PAGE_SIZE}
              onChange={setOffset}
              loading={loading}
            />
          </>
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground">No renewals found.</div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Create Agent Form                                                  */
/* ------------------------------------------------------------------ */

function DiscountsPanel() {
  const [codes, setCodes] = useState<Array<{
    id: string;
    code: string;
    usageLimit: number;
    usedCount: number;
    discountPercent: number;
    isActive: boolean;
    createdAt: string;
  }> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function fetchCodes() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/discounts', { credentials: 'include' });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setCodes(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCodes();
  }, []);

  async function createCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      const res = await fetch('/api/v1/admin/discounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: (data.code as string).toUpperCase(),
          usageLimit: Number(data.usageLimit) || 1,
          discountPercent: Number(data.discountPercent) || 90,
        }),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error((err as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      form.reset();
      fetchCodes();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function deactivate(id: string, code: string) {
    try {
      const res = await fetch(`/api/v1/admin/discounts/${id}/deactivate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fetchCodes();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deactivate failed');
    }
  }

  return (
    <div className="space-y-6">
      {/* Create form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate Discount Code</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            90% off the $2.39/year service fee. Single-use codes expire after first use. Multi-use codes
            have a configurable limit.
          </p>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive mb-4">
              {error}
            </div>
          )}
          <form onSubmit={createCode} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_auto] sm:items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Code</label>
              <UiInput
                name="code"
                placeholder="AGENT2026"
                required
                className="h-10 font-mono text-sm uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Max Uses</label>
              <UiInput
                name="usageLimit"
                type="number"
                defaultValue={1}
                min={1}
                max={10000}
                required
                className="h-10 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Discount %</label>
              <UiInput
                name="discountPercent"
                type="number"
                defaultValue={90}
                min={1}
                max={100}
                required
                className="h-10 text-sm"
              />
            </div>
            <Button type="submit" variant="gradient" disabled={submitting} className="w-full sm:w-auto">
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Generate
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Code list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Codes</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="py-10 text-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
            </div>
          )}
          {codes && codes.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No discount codes yet.
            </div>
          )}
          {codes && codes.length > 0 && (
            <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <th className="py-3 pr-3 font-medium">Code</th>
                    <th className="py-3 pr-3 font-medium">Usage</th>
                    <th className="py-3 pr-3 font-medium">Discount</th>
                    <th className="py-3 pr-3 font-medium">Status</th>
                    <th className="py-3 pr-3 font-medium">Created</th>
                    <th className="py-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((c) => (
                    <tr key={c.id} className="border-b border-border/30 last:border-0">
                      <td className="py-3 pr-3 font-mono font-semibold">{c.code}</td>
                      <td className="py-3 pr-3 text-muted-foreground">
                        {c.usedCount} / {c.usageLimit}
                      </td>
                      <td className="py-3 pr-3 font-medium text-green-900">
                        {c.discountPercent}%
                      </td>
                      <td className="py-3 pr-3">
                        {c.isActive ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="destructive">Deactivated</Badge>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(c.createdAt)}
                      </td>
                      <td className="py-3 text-right">
                        {c.isActive && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => deactivate(c.id, c.code)}
                          >
                            <XCircle className="h-3 w-3" />
                            <span className="ml-1 hidden sm:inline">Deactivate</span>
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 md:hidden">
              {codes.map((c) => (
                <div key={c.id} className="premium-surface rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="wrap-anywhere font-mono font-semibold">{c.code}</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {c.usedCount} / {c.usageLimit} used
                      </div>
                    </div>
                    {c.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="destructive">Deactivated</Badge>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-green-900">{c.discountPercent}% off</span>
                    <span className="text-xs text-muted-foreground">{formatDate(c.createdAt)}</span>
                  </div>
                  {c.isActive && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={() => deactivate(c.id, c.code)}
                    >
                      <XCircle className="h-3 w-3" />
                      Deactivate
                    </Button>
                  )}
                </div>
              ))}
            </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateAgentPanel() {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));

    try {
      const res = await fetch('/api/v1/admin/agents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: data.domain,
          walletAddress: data.wallet,
          agentIdNft: data.tokenId ? Number(data.tokenId) : undefined,
          basename: data.basename || undefined,
          ensName: data.ens || undefined,
          framework: data.framework || undefined,
          sslStatus: data.sslStatus || 'pending',
          status: data.status || 'active',
          dnsTarget: data.dnsTarget || undefined,
        }),
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);
      setResult(`Agent created successfully. Domain: ${json.agent.domain}`);
      form.reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Manual Agent Creation</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Use when a domain was registered externally (Spaceship) but the agent row is missing from
          DB.
        </p>
      </CardHeader>
      <CardContent>
        {result && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-green-900/20 bg-green-900/10 p-3 text-sm text-green-900">
            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
            {result}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive mb-4 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Domain *" name="domain" placeholder="myagent.xyz" required />
            <FormField label="Wallet Address *" name="wallet" placeholder="0x..." required />
            <FormField
              label="Token ID"
              name="tokenId"
              placeholder="Auto-assigned if empty"
              type="number"
            />
            <FormField label="Framework" name="framework" placeholder="eliza, agentkit, etc." />
            <FormField label="Basename" name="basename" placeholder="myagent.base.eth" />
            <FormField label="ENS Name" name="ens" placeholder="myagent.eth" />
            <FormField label="DNS Target" name="dnsTarget" placeholder="https://..." />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">SSL Status</label>
              <select
                name="sslStatus"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none"
              >
                <option value="pending">pending</option>
                <option value="provisioning">provisioning</option>
                <option value="active">active</option>
                <option value="failed">failed</option>
                <option value="expired">expired</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Agent Status</label>
              <select
                name="status"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none"
              >
                <option value="active">active</option>
                <option value="pending">pending</option>
                <option value="expired">expired</option>
                <option value="revoked">revoked</option>
              </select>
            </div>
          </div>
          <Button type="submit" variant="gradient" disabled={submitting} className="w-full sm:w-auto">
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create Agent
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared Components                                                  */
/* ------------------------------------------------------------------ */

function FormField({
  label,
  name,
  placeholder,
  required,
  type = 'text',
}: {
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <UiInput
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
        className="h-10 font-mono text-sm"
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  breakdown,
  tone,
}: {
  label: string;
  value: string | number;
  breakdown?: string;
  tone?: 'default' | 'primary' | 'success' | 'warning';
}) {
  const colorClass = {
    default: 'text-foreground',
    primary: 'text-primary',
    success: 'text-green-900',
    warning: 'text-amber-400',
  }[tone ?? 'default'];

  return (
    <Card className="premium-surface interactive-surface">
      <CardContent className="p-4 sm:p-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`mt-2 text-2xl font-bold tabular-nums sm:text-3xl ${colorClass}`}>{value}</div>
        {breakdown && <div className="text-xs text-muted-foreground mt-1">{breakdown}</div>}
      </CardContent>
    </Card>
  );
}

function Pagination({
  total,
  offset,
  hasMore,
  pageSize,
  onChange,
  loading,
}: {
  total: number;
  offset: number;
  hasMore: boolean;
  pageSize: number;
  onChange: (v: number) => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span>
        Showing {offset + 1}-{Math.min(offset + pageSize, total)} of {total}
      </span>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          disabled={offset === 0 || loading}
          onClick={() => onChange(Math.max(0, offset - pageSize))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          disabled={!hasMore || loading}
          onClick={() => onChange(offset + pageSize)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AgentStatus }) {
  const variant =
    status === 'active'
      ? 'success'
      : status === 'pending'
        ? 'warning'
        : status === 'revoked'
          ? 'destructive'
          : 'outline';
  return (
    <Badge variant={variant as 'success' | 'warning' | 'destructive' | 'outline'}>{status}</Badge>
  );
}

function SslBadge({ status }: { status: AdminAgent['sslStatus'] }) {
  const variant =
    status === 'active'
      ? 'success'
      : status === 'failed' || status === 'expired'
        ? 'destructive'
        : 'outline';
  return <Badge variant={variant as 'success' | 'destructive' | 'outline'}>{status}</Badge>;
}

function RegistrationStatusBadge({ status }: { status: 'pending' | 'completed' | 'failed' }) {
  const variant =
    status === 'completed' ? 'success' : status === 'failed' ? 'destructive' : 'warning';
  return <Badge variant={variant as 'success' | 'warning' | 'destructive'}>{status}</Badge>;
}

function RenewalStatusBadge({
  status,
}: {
  status: 'scheduled' | 'in_progress' | 'completed' | 'failed';
}) {
  const variant =
    status === 'completed'
      ? 'success'
      : status === 'failed'
        ? 'destructive'
        : status === 'in_progress'
          ? 'warning'
          : 'outline';
  return (
    <Badge variant={variant as 'success' | 'warning' | 'destructive' | 'outline'}>{status}</Badge>
  );
}

function RegistrationCaseDrawer({
  registrationId,
  onClose,
  onRefresh,
}: {
  registrationId: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [data, setData] = useState<AdminRegistrationCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/v1/admin/registrations/${registrationId}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [registrationId]);

  async function runAction(endpoint: string, label: string) {
    setBusy(label);
    try {
      const body =
        label === 'repair'
          ? { action: 'dns' }
          : { reason: 'Admin case recovery' };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await res.json().catch(() => null);
      onRefresh();
      setLoading(true);
      const ref = await fetch(`/api/v1/admin/registrations/${registrationId}`, { credentials: 'include' });
      if (!ref.ok) throw new Error(`HTTP ${ref.status}`);
      setData((await ref.json()) as AdminRegistrationCaseDetail);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm">
      <div className="safe-bottom premium-surface absolute inset-x-0 bottom-0 h-[92svh] w-full overflow-y-auto rounded-t-lg border shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-w-3xl sm:rounded-none sm:border-l">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border/60 bg-background/95 px-4 py-4 backdrop-blur sm:px-5">
          <div className="min-w-0">
            <div className="text-sm text-muted-foreground">Registration case</div>
            <div className="wrap-anywhere font-mono text-sm">{registrationId}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <XCircle className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          {loading && (
            <div className="py-10 text-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {data && (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <InfoTile label="Payment" value={data.caseSummary.paymentSettled ? 'Settled' : 'Pending'} />
                <InfoTile label="Case state" value={data.caseSummary.currentState} />
                <InfoTile label="Domain" value={data.agent?.domain ?? 'No agent yet'} />
                <InfoTile label="Payment tx" value={data.caseSummary.paymentTxHash ?? 'None'} mono />
              </div>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="text-sm font-medium">Progress</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {Object.entries(data.registration.progress?.steps ?? {}).map(([step, s]) => (
                      <div key={step} className="premium-surface rounded-lg border p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-medium capitalize">{step}</span>
                          <Badge variant={stepBadgeVariant(s.status)}>{s.status}</Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{s.note ?? '—'}</div>
                        {s.txHash && <div className="mt-1 font-mono text-[11px]">{s.txHash}</div>}
                        {s.error && <div className="mt-1 text-xs text-destructive">{s.error}</div>}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="text-sm font-medium">Recovery actions</div>
                  <div className="grid gap-2 sm:flex sm:flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null || !data.agent}
                      className="w-full sm:w-auto"
                      onClick={() =>
                        runAction(`/api/v1/admin/agents/${data.agent?.id ?? ''}/repair`, 'repair')
                      }
                    >
                      <Wrench className="h-3 w-3" />
                      Repair bundle
                    </Button>
                    {data.agent && data.agent.sslStatus !== 'active' && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        className="w-full sm:w-auto"
                        onClick={() =>
                          runAction(
                            `/api/v1/admin/agents/${data.agent?.id ?? ''}/ssl-reprovision`,
                            'ssl',
                          )
                        }
                      >
                        <ShieldCheck className="h-3 w-3" />
                        Reprovision SSL
                      </Button>
                    )}
                    {data.registration.status === 'failed' && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => runAction(`/api/v1/admin/registrations/${registrationId}/retry`, 'retry')}
                          className="w-full sm:w-auto"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Retry registration
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => runAction(`/api/v1/admin/registrations/${registrationId}/refund`, 'refund')}
                          className="w-full sm:w-auto"
                        >
                          <XCircle className="h-3 w-3" />
                          Record refund
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="text-sm font-medium">Provisioning detail</div>
                  <div className="grid gap-2 text-sm md:grid-cols-2">
                    <InfoTile label="Agent" value={data.agent?.status ?? 'none'} />
                    <InfoTile label="SSL" value={data.ssl?.sslStatus ?? 'none'} />
                    <InfoTile label="Email" value={data.email ? 'Ready' : 'None'} />
                    <InfoTile label="Messages" value={String(data.caseSummary.messageCount)} />
                  </div>
                </CardContent>
              </Card>

              {data.dnsRecords?.length > 0 && (
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="text-sm font-medium">DNS records</div>
                    <div className="space-y-2">
                      {data.dnsRecords.map((record) => (
                        <div key={record.id} className="premium-surface rounded-lg border p-3 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-mono">
                              {record.type} {record.name}
                            </div>
                            <Badge variant={record.systemManaged ? 'outline' : 'secondary'}>
                              {record.systemManaged ? 'system' : 'user'}
                            </Badge>
                          </div>
                          <div className="mt-1 break-all text-muted-foreground">{record.value}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="premium-surface rounded-lg border p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-sm', mono && 'font-mono break-all')}>{value}</div>
    </div>
  );
}

function stepBadgeVariant(status: 'pending' | 'running' | 'success' | 'failed' | 'skipped') {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'destructive';
  if (status === 'running') return 'warning';
  return 'outline';
}

function RepairMenu({
  agentId: _agentId,
  loading,
  hasBasename,
  hasEns,
  onAction,
}: {
  agentId: string;
  domain: string;
  hasBasename: boolean;
  hasEns: boolean;
  loading: boolean;
  onAction: (action: 'dns' | 'email' | 'basename' | 'ens') => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        size="sm"
        disabled={loading}
        onClick={() => setOpen((v) => !v)}
        className="w-full sm:w-auto"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
        <span className="ml-1 hidden sm:inline">Repair</span>
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(82vw,18rem)] overflow-hidden rounded-xl border border-border/60 bg-popover p-1 shadow-2xl shadow-black/30 sm:w-52">
          <button
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition hover:bg-primary/15"
            onClick={() => {
              onAction('dns');
              setOpen(false);
            }}
          >
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            Reconfigure DNS
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition hover:bg-primary/15"
            onClick={() => {
              onAction('email');
              setOpen(false);
            }}
          >
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            Set up Email
          </button>
          {hasBasename && (
            <button
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition hover:bg-primary/15"
              onClick={() => {
                onAction('basename');
                setOpen(false);
              }}
            >
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              Register Basename
            </button>
          )}
          {hasEns && (
            <button
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition hover:bg-primary/15"
              onClick={() => {
                onAction('ens');
                setOpen(false);
              }}
            >
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              Register ENS Name
            </button>
          )}
        </div>
      )}
    </div>
  );
}
