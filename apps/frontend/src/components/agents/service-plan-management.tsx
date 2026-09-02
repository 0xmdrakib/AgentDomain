'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConfig, useWalletClient } from 'wagmi';
import { getWalletClient } from 'wagmi/actions';
import { base } from 'wagmi/chains';
import { CreditCard, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { type Address } from 'viem';
import { createX402PaymentHeaders } from '@agentdomain/sdk';
import {
  ENTERPRISE_PLAN_OFFERS,
  SERVICE_PLAN_CATALOG,
  USDC_DECIMALS,
  type ServicePlanSku,
} from '@agentdomain/shared';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useSiwe } from '@/hooks/use-siwe';
import { useBaseChainGuard } from '@/hooks/use-base-chain';
import {
  getBaseChainSwitchCopy,
  isBaseChainMismatchError,
  isBaseChainRequiredError,
} from '@/lib/base-chain';
import { getTransactionErrorCopy } from '@/lib/transaction-errors';
import { cn } from '@/lib/utils';

type PlanKey = 'included' | 'starter' | 'pro' | 'enterprise';
type BillingInterval = 'yearly';

interface PlanStatus {
  agentId: string;
  domain: string;
  entitlement: {
    plan: PlanKey;
    planSku?: ServicePlanSku;
    status: string;
    interval: BillingInterval | null;
    autoRenew: boolean;
    currentPeriodEnd: string | null;
    limits: {
      monthlyEmails: number;
      requestsPerSecond: number;
      apiKeys: number;
      dnsRecords: number;
      emailAliases: number;
      emailRetentionDays: number;
    };
    supportTier: string;
    registryPriority: boolean;
  };
  subscription: {
    prepaidBalance?: string;
    currentPeriodEnd?: string;
    autoRenew?: boolean;
  } | null;
  renewalPlan: PlanKey;
  renewalPlanSku?: ServicePlanSku;
  upgradeQuotes?: Record<
    'starter' | 'pro' | 'enterprise',
    | {
        available: true;
        plan: 'starter' | 'pro' | 'enterprise';
        currentPlan: PlanKey;
        periodStart: string;
        periodEnd: string;
        amountUsdc: string;
        amountAtomic: string;
        currentCreditUsdc: string;
        targetTotalUsdc: string;
        alreadyCovered: boolean;
        label: string;
      }
    | { available: false; message: string }
  >;
  registryVisibility: {
    hidden: boolean;
    hiddenUntil: string | null;
    requestedHidden: boolean;
    canHide: boolean;
    defaultHidden: boolean;
  };
}

const planOptions = [
  {
    key: 'starter',
    label: 'Starter',
    price: '$59/year',
    description:
      '25k combined emails/month, 5 API keys, 50 DNS records, 5 aliases, registry privacy',
  },
  {
    key: 'pro',
    label: 'Pro',
    price: '$120/year',
    description:
      '50k combined emails/month, 10 API keys, 100 DNS records, 10 aliases, priority support',
  },
  {
    key: 'enterprise',
    label: 'Enterprise',
    price: 'From $240/year',
    description: '100k–5M combined emails/month, 25 API keys, 200 DNS records, 20 aliases',
  },
] as const;

export function ServicePlanManagement({ agentId }: { agentId: string }) {
  const { address } = useAccount();
  const config = useConfig();
  const { data: walletClient } = useWalletClient();
  const { isBaseChain, isSwitchingBase, ensureBaseChain } = useBaseChainGuard();
  const { session, signIn } = useSiwe();
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [buying, setBuying] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'starter' | 'pro' | 'enterprise'>('starter');
  const [enterpriseSku, setEnterpriseSku] = useState<ServicePlanSku>('enterprise-100000');
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [renewalSaving, setRenewalSaving] = useState(false);
  const wrongChain = Boolean(address && !isBaseChain);

  function notifyRenewalStatusRefresh() {
    window.dispatchEvent(
      new CustomEvent('agentdomain:renewal-status-refresh', { detail: { agentId } }),
    );
  }

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/agents/${agentId}/plan?planSku=${encodeURIComponent(enterpriseSku)}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as PlanStatus;
      setStatus(data);
      if (data.entitlement.plan === 'enterprise' && data.entitlement.planSku)
        setEnterpriseSku(data.entitlement.planSku);
    } catch (e) {
      toast.error('Could not load premium plan', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [agentId, enterpriseSku]);

  useEffect(() => {
    if (!session.authenticated) return;
    void loadStatus();
  }, [loadStatus, session.authenticated]);

  async function updateRegistryVisibility(hidden: boolean) {
    try {
      if (!address) throw new Error('Connect the owner wallet first.');
      setVisibilitySaving(true);

      if (!session.authenticated) {
        const ok = await signIn();
        if (!ok) return;
      }

      const res = await fetch(`/api/v1/agents/${agentId}/plan`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registryHidden: hidden }),
      });
      if (!res.ok) throw new Error(await readError(res));

      const data = (await res.json()) as Pick<PlanStatus, 'entitlement' | 'registryVisibility'>;
      setStatus((current) =>
        current
          ? {
              ...current,
              entitlement: data.entitlement ?? current.entitlement,
              registryVisibility: data.registryVisibility,
            }
          : current,
      );
      toast.success(hidden ? 'Agent hidden from registry' : 'Agent visible in registry');
    } catch (e) {
      toast.error('Registry privacy update failed', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setVisibilitySaving(false);
    }
  }

  async function purchasePlan() {
    try {
      if (!address) throw new Error('Connect the owner wallet first.');
      if (wrongChain) {
        await ensureBaseChain();
        return;
      }
      setBuying(true);

      if (!session.authenticated) {
        const ok = await signIn();
        if (!ok) return;
      }

      const walletAddress = address as Address;
      let signer = walletClient;
      if (
        signer?.account?.address?.toLowerCase() !== walletAddress.toLowerCase() ||
        signer.chain?.id !== base.id
      ) {
        signer = await getWalletClient(config, { account: walletAddress, chainId: base.id });
      }
      if (!signer?.account) throw new Error('Wallet signer is not ready.');

      const body = JSON.stringify({
        plan: selectedPlan,
        planSku: selectedPlan === 'enterprise' ? enterpriseSku : selectedPlan,
      });

      const initial = await fetch(`/api/v1/agents/${agentId}/plan`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (initial.status !== 402) {
        if (!initial.ok) throw new Error(await readError(initial));
        await loadStatus();
        return;
      }

      toast.info(`Review $${total} USDC authorization`, {
        description: 'This is an x402 USDC payment signature on Base mainnet.',
      });
      const paymentHeaders = await createX402PaymentHeaders(initial, signer);

      const finalRes = await fetch(`/api/v1/agents/${agentId}/plan`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...paymentHeaders,
        },
        body,
      });
      if (!finalRes.ok) throw new Error(await readError(finalRes));
      await finalRes.json();
      toast.success('Premium plan updated');
      await loadStatus();
      notifyRenewalStatusRefresh();
    } catch (e) {
      if (isBaseChainRequiredError(e) || isBaseChainMismatchError(e)) {
        const copy = getBaseChainSwitchCopy(e);
        toast.info(copy.title, { description: copy.description });
        return;
      }
      const copy = getTransactionErrorCopy(e, {
        action: 'Plan purchase',
        stage: 'signature',
        fallback: 'Plan purchase could not be completed. Please check your wallet and try again.',
      });
      if (copy.kind === 'cancelled') {
        toast.info(copy.title, { description: copy.description });
      } else {
        toast.error(copy.title, { description: copy.description });
      }
    } finally {
      setBuying(false);
    }
  }

  async function updateRenewalPlan(planSku: ServicePlanSku) {
    const plan: PlanKey = planSku.startsWith('enterprise-') ? 'enterprise' : (planSku as PlanKey);
    try {
      if (!address) throw new Error('Connect the owner wallet first.');
      setRenewalSaving(true);
      if (!session.authenticated) {
        const ok = await signIn();
        if (!ok) return;
      }
      const res = await fetch(`/api/v1/agents/${agentId}/plan`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          renewalPlan: plan,
          renewalPlanSku: planSku,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as Pick<
        PlanStatus,
        'entitlement' | 'registryVisibility' | 'renewalPlan' | 'renewalPlanSku'
      >;
      setStatus((current) =>
        current
          ? {
              ...current,
              entitlement: data.entitlement ?? current.entitlement,
              registryVisibility: data.registryVisibility ?? current.registryVisibility,
              renewalPlan: data.renewalPlan ?? plan,
              renewalPlanSku: data.renewalPlanSku ?? planSku,
            }
          : current,
      );
      toast.success('Next renewal plan updated');
      notifyRenewalStatusRefresh();
    } catch (e) {
      toast.error('Renewal plan update failed', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRenewalSaving(false);
    }
  }

  const entitlement = status?.entitlement;
  const registryVisibility = status?.registryVisibility;
  const selectedQuote = status?.upgradeQuotes?.[selectedPlan];
  const selectedQuoteAvailable = selectedQuote?.available === true ? selectedQuote : null;
  const total =
    selectedQuoteAvailable?.amountUsdc ??
    formatUsdc(SERVICE_PLAN_CATALOG[selectedPlan].yearlyPriceUsdcAtomic.toString());
  const upgradeDisabled =
    !selectedQuoteAvailable ||
    selectedQuoteAvailable.alreadyCovered ||
    selectedQuoteAvailable.amountAtomic === '0';

  return (
    <Card className="premium-surface mb-6 min-w-0 overflow-hidden">
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <CreditCard className="h-5 w-5 shrink-0 text-primary" />
          Premium Plan
        </CardTitle>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4 px-4 pb-4 pt-0 sm:gap-5 sm:px-6 sm:pb-6">
        <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5">
          <Limit
            className="order-1 lg:order-none"
            label="Plan"
            value={
              entitlement
                ? SERVICE_PLAN_CATALOG[entitlement.plan].label
                : loading
                  ? 'Loading'
                  : 'Included'
            }
          />
          <Limit
            className="order-3 col-span-2 lg:order-none lg:col-span-1"
            label="Email"
            value={
              entitlement
                ? `${entitlement.limits.monthlyEmails.toLocaleString()} emails/month (sent + received)`
                : '-'
            }
          />
          <Limit
            className="order-2 lg:order-none"
            label="API keys"
            value={String(entitlement?.limits.apiKeys ?? '-')}
          />
          <Limit
            className="order-4 lg:order-none"
            label="DNS records"
            value={String(entitlement?.limits.dnsRecords ?? '-')}
          />
          <Limit
            className="order-5 lg:order-none"
            label="Email aliases"
            value={String(entitlement?.limits.emailAliases ?? '-')}
          />
        </div>

        {entitlement?.currentPeriodEnd && (
          <div className="flex min-w-0 flex-wrap gap-2 text-sm text-muted-foreground">
            <Badge variant="outline" className="max-w-full">
              <span className="wrap-anywhere">{entitlement.status}</span>
            </Badge>
            <Badge variant="outline" className="max-w-full">
              Covered until {new Date(entitlement.currentPeriodEnd).toLocaleDateString()}
            </Badge>
            <Badge variant="outline" className="max-w-full whitespace-normal text-left">
              <span className="wrap-anywhere">
                Next renewal: {formatPlanSkuLabel(status?.renewalPlanSku ?? 'included')}
              </span>
            </Badge>
          </div>
        )}

        <div className="min-w-0 rounded-lg border border-border/70 bg-background/45 p-3.5 sm:p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium">
                {registryVisibility?.hidden ? (
                  <EyeOff className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <Eye className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                Registry privacy
              </div>
              <div className="wrap-anywhere mt-1 text-sm text-muted-foreground">
                {registryVisibility?.hidden
                  ? `Hidden until ${registryVisibility.hiddenUntil ? new Date(registryVisibility.hiddenUntil).toLocaleDateString() : 'the current period ends'}`
                  : registryVisibility?.canHide
                    ? 'Visible in public registry'
                    : 'Available with Starter, Pro, or Enterprise'}
              </div>
            </div>
            <div className="flex w-full min-w-0 items-center justify-between gap-3 sm:w-auto sm:justify-start">
              {visibilitySaving && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              )}
              <Switch
                id="registry-hidden"
                checked={Boolean(registryVisibility?.hidden)}
                onCheckedChange={(checked) => void updateRegistryVisibility(checked)}
                disabled={
                  visibilitySaving ||
                  loading ||
                  (!registryVisibility?.canHide && !registryVisibility?.hidden)
                }
              />
              <Label
                htmlFor="registry-hidden"
                className="min-w-0 cursor-pointer text-right sm:whitespace-nowrap"
              >
                Hide from registry
              </Label>
            </div>
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-border/70 bg-background/45 p-3.5 sm:p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-medium">Next identity renewal</div>
              <div className="mt-1 text-sm text-muted-foreground">
                This plan is charged together with the RenewalVault identity renewal.
              </div>
            </div>
            <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:max-w-[28rem]">
              {renewalSaving && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              )}
              <select
                value={status?.renewalPlanSku ?? status?.renewalPlan ?? 'included'}
                onChange={(event) => void updateRenewalPlan(event.target.value as ServicePlanSku)}
                disabled={renewalSaving || loading}
                aria-label="Next identity renewal plan"
                className="h-10 min-w-0 flex-1 truncate rounded-md border border-input bg-background px-3 text-sm sm:w-auto"
              >
                {(['included', 'starter', 'pro'] as PlanKey[]).map((plan) => (
                  <option key={plan} value={plan}>
                    {SERVICE_PLAN_CATALOG[plan].label}
                  </option>
                ))}
                {ENTERPRISE_PLAN_OFFERS.map((offer) => (
                  <option key={offer.sku} value={offer.sku}>
                    Enterprise · {formatEmailVolume(offer.monthlyEmails)}/month · $
                    {Number(offer.yearlyPriceUsdcAtomic / 1_000_000n).toLocaleString()}/year
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="grid min-w-0 gap-3 md:grid-cols-3">
          {planOptions.map((plan) => {
            const quote = status?.upgradeQuotes?.[plan.key];
            return (
              <button
                key={plan.key}
                type="button"
                onClick={() => setSelectedPlan(plan.key)}
                className={cn(
                  'min-w-0 rounded-lg border p-3.5 text-left transition-colors sm:p-4',
                  selectedPlan === plan.key
                    ? 'border-primary/70 bg-primary/5'
                    : 'border-border/70 bg-background/45 hover:border-primary/35',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">{plan.label}</div>
                  {selectedPlan === plan.key && <ShieldCheck className="h-4 w-4 text-primary" />}
                </div>
                <div className="mt-2 font-mono text-sm">{plan.price}</div>
                <p className="wrap-anywhere mt-2 text-sm leading-6 text-muted-foreground">
                  {plan.description}
                </p>
                {quote?.available === true && (
                  <div className="wrap-anywhere mt-3 rounded-md border border-border/60 bg-background/55 p-2 text-xs text-muted-foreground">
                    Upgrade through expiry:{' '}
                    <span className="font-mono text-foreground">${quote.amountUsdc}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {selectedPlan === 'enterprise' && (
          <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border/70 bg-background/45 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4">
            <Label htmlFor="dashboard-enterprise-tier">Enterprise monthly volume</Label>
            <select
              id="dashboard-enterprise-tier"
              value={enterpriseSku}
              onChange={(event) => setEnterpriseSku(event.target.value as ServicePlanSku)}
              className="h-10 w-full min-w-0 truncate rounded-md border border-input bg-background px-3 text-sm sm:w-auto sm:max-w-[28rem]"
            >
              {ENTERPRISE_PLAN_OFFERS.map((offer) => (
                <option key={offer.sku} value={offer.sku}>
                  {formatEmailVolume(offer.monthlyEmails)}/month · $
                  {Number(offer.yearlyPriceUsdcAtomic / 1_000_000n).toLocaleString()}/year
                </option>
              ))}
            </select>
          </div>
        )}

        {selectedQuoteAvailable && Number(selectedQuoteAvailable.currentCreditUsdc) > 0 && (
          <div className="wrap-anywhere rounded-lg border border-border/70 bg-background/45 px-3.5 py-3 text-sm text-muted-foreground sm:px-4">
            Current plan credit: ${selectedQuoteAvailable.currentCreditUsdc}. Upgrade amount is
            calculated through {new Date(selectedQuoteAvailable.periodEnd).toLocaleDateString()}.
          </div>
        )}

        {wrongChain && (
          <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="font-medium text-destructive">Switch to Base mainnet</div>
                <div className="mt-1 text-muted-foreground">
                  Premium Plan payments only use USDC on Base.
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void ensureBaseChain()}
                disabled={isSwitchingBase}
                className="w-full sm:w-auto"
              >
                {isSwitchingBase ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Switch'}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="wrap-anywhere font-mono text-sm text-muted-foreground">
            Checkout total ${total} USDC
          </div>
          <Button
            onClick={wrongChain ? () => void ensureBaseChain() : purchasePlan}
            disabled={buying || isSwitchingBase || upgradeDisabled}
            className="w-full sm:w-auto"
          >
            {(buying || isSwitchingBase) && <Loader2 className="h-4 w-4 animate-spin" />}
            {wrongChain ? 'Switch to Base' : upgradeDisabled ? 'Already covered' : 'Upgrade'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function formatPlanSkuLabel(planSku: ServicePlanSku): string {
  if (!planSku.startsWith('enterprise-')) {
    return SERVICE_PLAN_CATALOG[planSku as PlanKey].label;
  }
  const offer = ENTERPRISE_PLAN_OFFERS.find((entry) => entry.sku === planSku);
  return offer ? `Enterprise · ${offer.monthlyEmails.toLocaleString()} emails/month` : 'Enterprise';
}

function formatEmailVolume(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M emails`;
  }
  return `${value / 1_000}k emails`;
}

function Limit({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div
      className={cn('min-w-0 rounded-lg border border-border/70 bg-background/45 p-3', className)}
    >
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="wrap-anywhere mt-1 font-mono text-sm font-semibold leading-5">{value}</div>
    </div>
  );
}

function formatUsdc(atomic: string) {
  const value = BigInt(atomic);
  const baseUnits = 10n ** BigInt(USDC_DECIMALS);
  const whole = value / baseUnits;
  const fraction = value % baseUnits;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '')}`;
}

async function readError(res: Response) {
  const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
  return body?.message ?? body?.error ?? `HTTP ${res.status}`;
}
