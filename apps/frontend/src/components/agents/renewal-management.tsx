'use client';

import { useCallback, useState, useEffect } from 'react';
import { useAccount, usePublicClient, useReadContract, useSendTransaction } from 'wagmi';
import { parseUnits, formatUnits, getAddress, type Address, type Hex } from 'viem';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { AlertTriangle, CalendarClock, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { RENEWAL_VAULT_ABI } from '@/lib/abis';
import { getTransactionErrorCopy, type TransactionRequestStage } from '@/lib/transaction-errors';
import { useBaseChainGuard } from '@/hooks/use-base-chain';
import {
  BASE_MAINNET_CHAIN_ID,
  getBaseChainSwitchCopy,
  isBaseChainMismatchError,
  isBaseChainRequiredError,
} from '@/lib/base-chain';
import { formatDate, shortAddress } from '@/lib/utils';
import { useSiwe } from '@/hooks/use-siwe';
import { toast } from 'sonner';
import type { RenewalPriceSnapshot } from '@agentdomain/shared';
import {
  assertSuccessfulClientTransactionReceipt,
  attributePreparedBaseTransaction,
  buildAttributedSetAutoRenew,
  buildAttributedUsdcApproval,
  buildAttributedVaultDeposit,
  ClientTransactionAttributionError,
  resolveClientBuilderCode,
} from '@/lib/client-transaction-attribution';

interface RenewalManagementProps {
  agentId: string;
  tokenId: number;
  expiresAt?: Date | null;
  ownerAddress: string;
  contractAddresses: {
    usdc: Address;
    renewalVault: Address | null;
  };
  builderCode: string | null;
}

interface RenewalStatus {
  autoRenewEnabled: boolean;
  vaultBalanceUsdc: string;
  vaultBalanceAtomic?: string;
  pendingRenewalAmountUsdc?: string;
  pendingRenewalAmountAtomic?: string;
  renewalFeeUsdc: string;
  renewalFeeAtomic?: string;
  nextRenewalAmountUsdc: string;
  nextRenewalAmountAtomic?: string;
  shortfallUsdc: string;
  shortfallAtomic?: string;
  hasEnoughBalanceForNextRenewal: boolean;
  estimatedYearsCovered: number;
  expiresAt: string | null;
  renewableFrom: string | null;
  daysUntilExpiry: number | null;
  renewalWindowDays: number;
  isRenewableNow: boolean;
  status: string;
  message: string;
  warning?: string | null;
  warnings?: string[];
  renewalBreakdown?: {
    domainRenewalCostUsdc: string;
    platformFeeUsdc: string;
    premiumPlan?: 'included' | 'starter' | 'pro' | 'enterprise';
    premiumPlanFeeUsdc?: string;
    sslCertificationFeeUsdc: string;
    emailFeeUsdc: string;
    basenameRenewalCostUsdc?: string;
    ensRenewalCostUsdc?: string;
    totalUsdc: string;
  };
  renewalSnapshot?: RenewalPriceSnapshot | null;
  ownerAddress: string;
}

interface VaultWithdrawTx {
  to: `0x${string}`;
  data: Hex;
  value: '0';
}

export function RenewalManagement({
  agentId,
  tokenId,
  expiresAt,
  ownerAddress,
  contractAddresses,
  builderCode: configuredBuilderCode,
}: RenewalManagementProps) {
  const { address, isConnected } = useAccount();
  const { isBaseChain, isSwitchingBase, ensureBaseChain } = useBaseChainGuard();
  const publicClient = usePublicClient({ chainId: BASE_MAINNET_CHAIN_ID });
  const { session, signIn, loading: siweLoading, error: siweError } = useSiwe();
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [status, setStatus] = useState<RenewalStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const renewalVaultAddress = contractAddresses.renewalVault ?? undefined;
  const usdcAddress = contractAddresses.usdc;
  const isVaultConfigured = Boolean(renewalVaultAddress);
  const vaultMissingMessage =
    'RenewalVault contract address is not configured. Deposits and auto-renew are temporarily unavailable.';

  // Read Contract: Balance
  const { data: vaultBalanceData, refetch: refetchBalance } = useReadContract({
    address: renewalVaultAddress,
    abi: RENEWAL_VAULT_ABI,
    functionName: 'balanceOfToken',
    args: [BigInt(tokenId)],
    chainId: BASE_MAINNET_CHAIN_ID,
    query: { enabled: isVaultConfigured },
  });

  // Read Contract: Auto Renew Status
  const { data: autoRenewData, refetch: refetchAutoRenew } = useReadContract({
    address: renewalVaultAddress,
    abi: RENEWAL_VAULT_ABI,
    functionName: 'autoRenewEnabled',
    args: [BigInt(tokenId)],
    chainId: BASE_MAINNET_CHAIN_ID,
    query: { enabled: isVaultConfigured },
  });

  // Read Contract: Renewal window
  const { data: renewalWindowData } = useReadContract({
    address: renewalVaultAddress,
    abi: RENEWAL_VAULT_ABI,
    functionName: 'renewalWindow',
    chainId: BASE_MAINNET_CHAIN_ID,
    query: { enabled: isVaultConfigured },
  });

  const { sendTransactionAsync, isPending: isSendPending } = useSendTransaction();
  const isPending = isSendPending || isSwitchingBase;

  const balanceAtomic = (vaultBalanceData as bigint | undefined) ?? 0n;
  const balanceFormatted = formatUnits(balanceAtomic, 6);
  const isAutoRenewEnabled = autoRenewData as boolean | undefined;
  const statusRenewalFee = parseAtomic(status?.nextRenewalAmountAtomic);
  const renewalFeeAtomic = statusRenewalFee;
  const statusBalanceAtomic = parseAtomic(status?.vaultBalanceAtomic);
  const displayedBalanceAtomic = statusBalanceAtomic ?? balanceAtomic;
  const computedShortfallAtomic =
    renewalFeeAtomic === null
      ? null
      : displayedBalanceAtomic >= renewalFeeAtomic
        ? 0n
        : renewalFeeAtomic - displayedBalanceAtomic;
  const displayedBalance = status?.vaultBalanceUsdc ?? formatUnits(displayedBalanceAtomic, 6);
  const nextRenewalAmount =
    status?.nextRenewalAmountUsdc ??
    (renewalFeeAtomic !== null ? formatUnits(renewalFeeAtomic, 6) : null);
  const shortfallAmount =
    status?.shortfallUsdc ??
    (computedShortfallAtomic !== null ? formatUnits(computedShortfallAtomic, 6) : null);
  const hasShortfall = shortfallAmount !== null && Number(shortfallAmount) > 0;
  const nextExpiry = status?.expiresAt ?? expiresAt?.toISOString() ?? null;
  const renewalWindowSeconds =
    typeof renewalWindowData === 'bigint' && renewalWindowData > 0n
      ? Number(renewalWindowData)
      : null;
  const renewableFrom =
    status?.renewableFrom ??
    (nextExpiry && renewalWindowSeconds
      ? new Date(new Date(nextExpiry).getTime() - renewalWindowSeconds * 1000).toISOString()
      : null);
  const daysUntilExpiry =
    status?.daysUntilExpiry ??
    (nextExpiry
      ? Math.ceil((new Date(nextExpiry).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      : null);
  const needsAuth = isConnected && !session.authenticated;
  const authMessage = needsAuth
    ? 'Sign in with this wallet to load exact renewal status and protected vault details.'
    : null;
  const ownerWallet = normalizeAddress(status?.ownerAddress ?? ownerAddress);
  const connectedWallet = normalizeAddress(address);
  const isOwnerWallet = Boolean(ownerWallet && connectedWallet) && ownerWallet === connectedWallet;
  const purchaseSnapshot = status?.renewalSnapshot ?? null;
  const vaultAutoRenewTotal =
    status?.renewalBreakdown?.totalUsdc ??
    status?.nextRenewalAmountUsdc ??
    purchaseSnapshot?.autoRenewTotalUsdc ??
    null;

  const loadRenewalStatus = useCallback(async () => {
    if (!session.authenticated) {
      setStatus(null);
      setStatusError(null);
      return;
    }
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/renewal/status`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as RenewalStatus;
      setStatus(data);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Could not load renewal status');
    } finally {
      setStatusLoading(false);
    }
  }, [agentId, session.authenticated]);

  useEffect(() => {
    if (!isConnected || !session.authenticated) {
      setStatus(null);
      return;
    }
    loadRenewalStatus();
  }, [isConnected, loadRenewalStatus, session.authenticated]);

  useEffect(() => {
    if (!session.authenticated) return;
    const refreshRenewalStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ agentId?: string }>).detail;
      if (detail?.agentId && detail.agentId !== agentId) return;
      void loadRenewalStatus();
      void refetchBalance();
      void refetchAutoRenew();
    };
    window.addEventListener('agentdomain:renewal-status-refresh', refreshRenewalStatus);
    return () => {
      window.removeEventListener('agentdomain:renewal-status-refresh', refreshRenewalStatus);
    };
  }, [agentId, loadRenewalStatus, refetchAutoRenew, refetchBalance, session.authenticated]);

  const handleToggleAutoRenew = async (checked: boolean) => {
    if (!renewalVaultAddress) {
      toast.error('Renewal vault unavailable', { description: vaultMissingMessage });
      return;
    }
    if (!isOwnerWallet) {
      toast.error('Owner wallet required', {
        description: `Connect ${shortAddress(ownerAddress, 6)} to change auto-renew.`,
      });
      return;
    }
    if (!isBaseChain) {
      await ensureBaseChain();
      return;
    }
    if (!publicClient) {
      toast.error('Network unavailable', {
        description: 'Could not confirm transactions right now. Please reconnect your wallet.',
      });
      return;
    }
    const builderCode = requireTransactionBuilderCode(configuredBuilderCode);
    if (!builderCode) return;

    try {
      const txHash = await sendTransactionAsync({
        ...buildAttributedSetAutoRenew(renewalVaultAddress, BigInt(tokenId), checked, builderCode),
        chainId: BASE_MAINNET_CHAIN_ID,
      });
      toast.success('Transaction submitted', { description: 'Updating auto-renew status...' });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      assertSuccessfulClientTransactionReceipt(receipt, 'Auto-renew update');
      toast.success('Auto-renew updated');
      refetchAutoRenew();
      loadRenewalStatus();
    } catch (err) {
      if (showBaseChainToast(err)) return;
      showTransactionErrorToast(err, {
        action: 'Auto-renew update',
        fallback: 'Could not update auto-renew. Please check your wallet and try again.',
      });
    }
  };

  const handleDeposit = async () => {
    if (!depositAmount || isNaN(Number(depositAmount))) return;
    if (!renewalVaultAddress) {
      toast.error('Renewal vault unavailable', { description: vaultMissingMessage });
      return;
    }
    if (!isBaseChain) {
      await ensureBaseChain();
      return;
    }
    if (!publicClient) {
      toast.error('Network unavailable', {
        description: 'Could not confirm transactions right now. Please reconnect your wallet.',
      });
      return;
    }
    const builderCode = requireTransactionBuilderCode(configuredBuilderCode);
    if (!builderCode) return;
    let depositStage: TransactionRequestStage = 'approval';
    try {
      const amountUnits = parseUnits(depositAmount, 6);

      // Step 1: Approve USDC
      const approveTx = await sendTransactionAsync({
        ...buildAttributedUsdcApproval(usdcAddress, renewalVaultAddress, amountUnits, builderCode),
        chainId: BASE_MAINNET_CHAIN_ID,
      });

      toast.success('Approval submitted', { description: 'Waiting for confirmation...' });
      const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
      assertSuccessfulClientTransactionReceipt(approvalReceipt, 'USDC approval');

      // Step 2: Deposit
      depositStage = 'deposit';
      const depositTx = await sendTransactionAsync({
        ...buildAttributedVaultDeposit(
          renewalVaultAddress,
          BigInt(tokenId),
          amountUnits,
          builderCode,
        ),
        chainId: BASE_MAINNET_CHAIN_ID,
      });

      toast.success('Deposit submitted', { description: 'Waiting for vault confirmation...' });
      const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });
      assertSuccessfulClientTransactionReceipt(depositReceipt, 'RenewalVault deposit');
      setDepositAmount('');

      // Auto-enable auto-renew if it's currently off
      if (!isAutoRenewEnabled && isOwnerWallet) {
        try {
          const autoRenewTx = await sendTransactionAsync({
            ...buildAttributedSetAutoRenew(renewalVaultAddress, BigInt(tokenId), true, builderCode),
            chainId: BASE_MAINNET_CHAIN_ID,
          });
          const autoRenewReceipt = await publicClient.waitForTransactionReceipt({
            hash: autoRenewTx,
          });
          assertSuccessfulClientTransactionReceipt(autoRenewReceipt, 'Auto-renew enable');
          toast.success('Auto-renew enabled', {
            description:
              'Your domain will now automatically renew as long as your vault has funds.',
          });
          refetchAutoRenew();
        } catch {
          toast.info('Deposit successful, but auto-renew was not enabled.', {
            description: 'You can enable it manually using the toggle above.',
          });
        }
      } else if (!isAutoRenewEnabled) {
        toast.info('Deposit successful', {
          description: 'Connect the owner wallet to enable auto-renew.',
        });
      }

      refetchBalance();
      loadRenewalStatus();
    } catch (err) {
      if (showBaseChainToast(err)) return;
      showTransactionErrorToast(err, {
        action: 'Deposit',
        stage: depositStage,
        fallback: 'Deposit could not be completed. Please check your wallet and try again.',
      });
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount || isNaN(Number(withdrawAmount))) return;
    if (!isOwnerWallet) {
      toast.error('Owner wallet required', {
        description: `Connect ${shortAddress(ownerAddress, 6)} to withdraw vault funds.`,
      });
      return;
    }
    if (!session.authenticated) {
      const ok = await signIn();
      if (!ok) {
        toast.error('Sign-in failed', {
          description: 'Please approve the wallet signature and try again.',
        });
        return;
      }
    }
    if (!isBaseChain) {
      await ensureBaseChain();
      return;
    }
    if (!publicClient) {
      toast.error('Network unavailable', {
        description: 'Could not confirm transactions right now. Please reconnect your wallet.',
      });
      return;
    }
    const builderCode = requireTransactionBuilderCode(configuredBuilderCode);
    if (!builderCode) return;

    try {
      const res = await fetch(`/api/v1/agents/${agentId}/renewal/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount: withdrawAmount }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `Withdraw check failed with HTTP ${res.status}`);
      }
      const tx = (await res.json()) as VaultWithdrawTx;
      const attributedTx = attributePreparedBaseTransaction(
        {
          to: tx.to,
          data: tx.data,
          value: BigInt(tx.value),
        },
        builderCode,
      );
      const withdrawTx = await sendTransactionAsync({
        ...attributedTx,
        chainId: BASE_MAINNET_CHAIN_ID,
      });
      toast.success('Withdrawal submitted', { description: 'Waiting for Base confirmation...' });
      const withdrawalReceipt = await publicClient.waitForTransactionReceipt({ hash: withdrawTx });
      assertSuccessfulClientTransactionReceipt(withdrawalReceipt, 'RenewalVault withdrawal');

      toast.success('Withdrawal confirmed', { description: 'Funds returned to your wallet.' });
      setWithdrawAmount('');
      refetchBalance();
      loadRenewalStatus();
    } catch (err) {
      if (showBaseChainToast(err)) return;
      showTransactionErrorToast(err, {
        action: 'Withdrawal',
        fallback: 'Withdrawal could not be completed. Please check your wallet and try again.',
      });
    }
  };

  if (!isConnected) {
    return null;
  }

  return (
    <Card className="premium-surface premium-elevated mb-6 border-primary/25">
      <CardHeader className="p-4 sm:p-6">
        <div className="flex items-start gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <CardTitle>Autonomous Renewals (RenewalVault)</CardTitle>
        </div>
        <CardDescription>
          Fund this AgentID vault to allow keeper bots to renew the identity before it expires.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          {/* Status Column */}
          <div className="space-y-6">
            <div className="grid gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <RenewalMetric
                  label="Renewal needed"
                  value={formatNullableUsdc(nextRenewalAmount)}
                  sublabel="Next year"
                />
                <RenewalMetric
                  label="Vault balance"
                  value={`$${Number(displayedBalance).toFixed(2)}`}
                  sublabel="USDC"
                />
                <RenewalMetric
                  label="Need to deposit"
                  value={formatNullableUsdc(shortfallAmount)}
                  sublabel={
                    shortfallAmount === null ? 'Loading' : hasShortfall ? 'Missing' : 'Covered'
                  }
                  tone={shortfallAmount === null ? 'default' : hasShortfall ? 'warning' : 'success'}
                />
              </div>

              <div className="rounded-lg border border-border/60 bg-background/55 p-4 shadow-inner shadow-black/10">
                {status?.pendingRenewalAmountUsdc &&
                  Number(status.pendingRenewalAmountUsdc) > 0 && (
                    <div className="mb-3 grid gap-1 border-b border-border/50 pb-3 text-xs text-muted-foreground">
                      <BreakdownLine
                        label="Locked for renewal"
                        value={status.pendingRenewalAmountUsdc}
                      />
                    </div>
                  )}
                {status?.renewalBreakdown && (
                  <div className="mb-3 grid gap-1 border-b border-border/50 pb-3 text-xs text-muted-foreground">
                    <div className="mb-1 flex items-center justify-between gap-3 font-medium text-foreground">
                      <span>Live renewal quote</span>
                      <span>${Number(status.renewalBreakdown.totalUsdc).toFixed(2)}</span>
                    </div>
                    <BreakdownLine
                      label="Domain renewal"
                      value={status.renewalBreakdown.domainRenewalCostUsdc}
                    />
                    <BreakdownLine
                      label="Platform fee"
                      value={status.renewalBreakdown.platformFeeUsdc}
                    />
                    {Number(status.renewalBreakdown.premiumPlanFeeUsdc ?? 0) > 0 && (
                      <BreakdownLine
                        label={`${planLabel(status.renewalBreakdown.premiumPlan)} Premium Plan`}
                        value={status.renewalBreakdown.premiumPlanFeeUsdc ?? '0'}
                      />
                    )}
                    {Number(status.renewalBreakdown.basenameRenewalCostUsdc ?? 0) > 0 && (
                      <BreakdownLine
                        label="Basename renewal"
                        value={status.renewalBreakdown.basenameRenewalCostUsdc ?? '0'}
                      />
                    )}
                    {Number(status.renewalBreakdown.ensRenewalCostUsdc ?? 0) > 0 && (
                      <BreakdownLine
                        label="ENS renewal"
                        value={status.renewalBreakdown.ensRenewalCostUsdc ?? '0'}
                      />
                    )}
                  </div>
                )}
                {purchaseSnapshot && vaultAutoRenewTotal && (
                  <div className="mb-3 border-b border-border/50 pb-3 text-xs text-muted-foreground">
                    <SnapshotTotal label="Vault auto-renew total" value={vaultAutoRenewTotal} />
                    <p className="mt-1 leading-5">
                      Current live quote is used for funding. Earlier purchases are shown only as
                      historical context.
                    </p>
                  </div>
                )}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <CalendarClock className="h-4 w-4 text-muted-foreground" />
                      Next renewal window
                    </div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {nextExpiry ? (
                        <>
                          Expires {formatDate(new Date(nextExpiry))}
                          {daysUntilExpiry !== null && daysUntilExpiry !== undefined
                            ? ` (${daysUntilExpiry} days left)`
                            : ''}
                          {renewableFrom
                            ? `, renewable from ${formatDate(new Date(renewableFrom))}`
                            : ''}
                        </>
                      ) : (
                        'Expiry date is not available yet.'
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant={needsAuth ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={needsAuth ? signIn : loadRenewalStatus}
                    disabled={statusLoading || siweLoading}
                    className="w-full sm:w-auto"
                  >
                    {statusLoading || siweLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : needsAuth ? (
                      <ShieldCheck className="h-4 w-4" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    {needsAuth ? 'Sign in' : 'Refresh'}
                  </Button>
                </div>
                {(authMessage ||
                  siweError ||
                  status?.warning ||
                  status?.message ||
                  statusError) && (
                  <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                    {hasShortfall && (
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-orange-700" />
                    )}
                    <span>
                      {siweError ??
                        statusError ??
                        authMessage ??
                        status?.warning ??
                        status?.warnings?.[0] ??
                        status?.message}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/55 p-4 shadow-inner shadow-black/10">
              <Switch
                id="auto-renew"
                checked={isAutoRenewEnabled || false}
                onCheckedChange={handleToggleAutoRenew}
                disabled={
                  !isVaultConfigured ||
                  isPending ||
                  isAutoRenewEnabled === undefined ||
                  !isOwnerWallet
                }
              />
              <Label htmlFor="auto-renew" className="flex-1 cursor-pointer">
                <div className="font-medium">Enable Auto-Renew</div>
                <div className="text-xs text-muted-foreground">
                  {!isVaultConfigured
                    ? vaultMissingMessage
                    : !isBaseChain
                      ? 'Switch to Base mainnet to update auto-renew.'
                      : isOwnerWallet
                        ? 'Keepers will renew the provisioned identity services when funds are available.'
                        : `Connect owner wallet ${shortAddress(ownerAddress, 6)} to enable it.`}
                </div>
              </Label>
            </div>
          </div>

          {/* Action Column */}
          <div className="space-y-6 border-border/40 md:border-l md:pl-8">
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm font-medium">Deposit Funds</div>
                {hasShortfall && (
                  <button
                    type="button"
                    onClick={() => setDepositAmount(Number(shortfallAmount).toFixed(2))}
                    className="text-left text-xs font-medium text-primary hover:underline sm:text-right"
                  >
                    Fill missing ${Number(shortfallAmount).toFixed(2)}
                  </button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Input
                  type="number"
                  placeholder={
                    hasShortfall && shortfallAmount ? Number(shortfallAmount).toFixed(2) : '0.00'
                  }
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="bg-background/70"
                />
                <Button
                  onClick={handleDeposit}
                  disabled={isPending || !depositAmount || !isVaultConfigured}
                  variant="secondary"
                  className="w-full sm:w-auto"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  {!isBaseChain ? 'Switch to Base' : 'Deposit'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {isVaultConfigured
                  ? `Any wallet can deposit. Funds stay assigned to token #${tokenId}; only the owner can withdraw or enable auto-renew.`
                  : vaultMissingMessage}
              </p>
            </div>

            <div className="space-y-3">
              <div className="text-sm font-medium text-muted-foreground">Withdraw Funds</div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Input
                  type="number"
                  placeholder="0.00"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  className="bg-background/70"
                />
                <Button
                  onClick={handleWithdraw}
                  disabled={
                    isPending || !withdrawAmount || Number(balanceFormatted) === 0 || !isOwnerWallet
                  }
                  variant="outline"
                  className="w-full sm:w-auto"
                >
                  {!isBaseChain ? 'Switch to Base' : 'Withdraw'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Only the owner wallet can withdraw unused funds.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function parseAtomic(value: string | null | undefined): bigint | null {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function normalizeAddress(address: string | null | undefined) {
  if (!address) return null;
  try {
    return getAddress(address).toLowerCase();
  } catch {
    return address.toLowerCase();
  }
}

function formatNullableUsdc(value: string | null): string {
  if (value === null) return 'Loading';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Unavailable';
  return `$${amount.toFixed(2)}`;
}

function planLabel(plan: 'included' | 'starter' | 'pro' | 'enterprise' | undefined) {
  if (plan === 'enterprise') return 'Enterprise';
  if (plan === 'pro') return 'Pro';
  return 'Included';
}

function showTransactionErrorToast(
  error: unknown,
  opts: { action: string; fallback: string; stage?: TransactionRequestStage },
) {
  const copy = getTransactionErrorCopy(error, opts);
  if (copy.kind === 'cancelled') {
    toast.info(copy.title, { description: copy.description });
    return;
  }
  toast.error(copy.title, { description: copy.description });
}

function showBaseChainToast(error: unknown): boolean {
  if (!isBaseChainRequiredError(error) && !isBaseChainMismatchError(error)) return false;
  const copy = getBaseChainSwitchCopy(error);
  toast.info(copy.title, { description: copy.description });
  return true;
}

function requireTransactionBuilderCode(configuredBuilderCode: string | null): string | null {
  try {
    return resolveClientBuilderCode(configuredBuilderCode);
  } catch (error) {
    if (!(error instanceof ClientTransactionAttributionError)) throw error;
    toast.error('Transaction not submitted', { description: error.message });
    return null;
  }
}

function SnapshotTotal({ label, value }: { label: string; value: string | null }) {
  const amount = value ? Number(value) : null;
  return (
    <div className="flex items-center justify-between gap-3 font-medium text-foreground">
      <span>{label}</span>
      <span className="font-mono">
        {amount !== null && Number.isFinite(amount) ? `$${amount.toFixed(2)}` : 'Unavailable'}
      </span>
    </div>
  );
}

function BreakdownLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="font-mono text-foreground">${Number(value).toFixed(2)}</span>
    </div>
  );
}

function RenewalMetric({
  label,
  value,
  sublabel,
  tone = 'default',
}: {
  label: string;
  value: string;
  sublabel: string;
  tone?: 'default' | 'success' | 'warning';
}) {
  return (
    <div className="flex min-h-[104px] flex-col justify-center rounded-lg border border-border/60 bg-background/55 p-3 shadow-inner shadow-black/10">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={
          tone === 'warning'
            ? 'mt-2 font-mono text-xl font-bold text-orange-800'
            : tone === 'success'
              ? 'mt-2 font-mono text-xl font-bold text-green-900'
              : 'mt-2 font-mono text-xl font-bold text-foreground'
        }
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sublabel}</div>
    </div>
  );
}
