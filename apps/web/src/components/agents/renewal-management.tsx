'use client';

import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { AlertTriangle, CalendarClock, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { RENEWAL_VAULT_ABI, USDC_ABI } from '@/lib/abis';
import { addresses } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { toast } from 'sonner';

interface RenewalManagementProps {
  agentId: string;
  tokenId: number;
  expiresAt?: Date | null;
}

interface RenewalStatus {
  autoRenewEnabled: boolean;
  vaultBalanceUsdc: string;
  renewalFeeUsdc: string;
  nextRenewalAmountUsdc: string;
  shortfallUsdc: string;
  hasEnoughBalanceForNextRenewal: boolean;
  estimatedYearsCovered: number;
  expiresAt: string | null;
  renewableFrom: string | null;
  daysUntilExpiry: number | null;
  renewalWindowDays: number;
  isRenewableNow: boolean;
  status: string;
  message: string;
}

export function RenewalManagement({ agentId, tokenId, expiresAt }: RenewalManagementProps) {
  const { isConnected } = useAccount();
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [status, setStatus] = useState<RenewalStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Read Contract: Balance
  const { data: vaultBalanceData, refetch: refetchBalance } = useReadContract({
    address: addresses.renewalVault,
    abi: RENEWAL_VAULT_ABI,
    functionName: 'balanceOfToken',
    args: [BigInt(tokenId)],
  });

  // Read Contract: Auto Renew Status
  const { data: autoRenewData, refetch: refetchAutoRenew } = useReadContract({
    address: addresses.renewalVault,
    abi: RENEWAL_VAULT_ABI,
    functionName: 'autoRenewEnabled',
    args: [BigInt(tokenId)],
  });

  // Write Contract
  const { writeContractAsync, isPending } = useWriteContract();

  const balanceFormatted = vaultBalanceData ? formatUnits(vaultBalanceData as bigint, 6) : '0.00';
  const isAutoRenewEnabled = autoRenewData as boolean | undefined;
  const displayedBalance = status?.vaultBalanceUsdc ?? balanceFormatted;
  const nextRenewalAmount = status?.nextRenewalAmountUsdc ?? '12';
  const shortfallAmount = status?.shortfallUsdc ?? '0';
  const hasShortfall = Number(shortfallAmount) > 0;
  const nextExpiry = status?.expiresAt ?? expiresAt?.toISOString() ?? null;

  const loadRenewalStatus = async () => {
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
  };

  useEffect(() => {
    if (!isConnected) return;
    loadRenewalStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, isConnected]);

  const handleToggleAutoRenew = async (checked: boolean) => {
    try {
      const txHash = await writeContractAsync({
        address: addresses.renewalVault,
        abi: RENEWAL_VAULT_ABI,
        functionName: 'setAutoRenew',
        args: [BigInt(tokenId), checked],
      });
      toast.success('Transaction submitted', { description: 'Updating auto-renew status...' });
      // We don't await the receipt strictly here, we just refetch after a delay or let the user see optimistic
      setTimeout(() => {
        refetchAutoRenew();
        loadRenewalStatus();
      }, 3000);
    } catch (err: any) {
      toast.error('Failed to update', { description: err.message || 'Transaction rejected' });
    }
  };

  const handleDeposit = async () => {
    if (!depositAmount || isNaN(Number(depositAmount))) return;
    try {
      const amountUnits = parseUnits(depositAmount, 6);
      
      // Step 1: Approve USDC
      const approveTx = await writeContractAsync({
        address: addresses.usdc,
        abi: USDC_ABI,
        functionName: 'approve',
        args: [addresses.renewalVault, amountUnits],
      });
      
      toast.success('Approval submitted', { description: 'Please wait for confirmation...' });
      
      // Note: Ideally we wait for approve receipt before calling deposit.
      // For UX in this template, we chain them. In a robust app, use `useWaitForTransactionReceipt`.
      
      // Step 2: Deposit
      const depositTx = await writeContractAsync({
        address: addresses.renewalVault,
        abi: RENEWAL_VAULT_ABI,
        functionName: 'deposit',
        args: [BigInt(tokenId), amountUnits],
      });
      
      toast.success('Deposit submitted', { description: 'Funds are being added to the vault.' });
      setDepositAmount('');
      
      // Auto-enable auto-renew if it's currently off
      if (!isAutoRenewEnabled) {
        try {
          await writeContractAsync({
            address: addresses.renewalVault,
            abi: RENEWAL_VAULT_ABI,
            functionName: 'setAutoRenew',
            args: [BigInt(tokenId), true],
          });
          toast.success('Auto-renew enabled', { 
            description: 'Your domain will now automatically renew as long as your vault has funds.' 
          });
          setTimeout(() => refetchAutoRenew(), 3000);
        } catch {
          toast.info('Deposit successful, but auto-renew was not enabled.', {
            description: 'You can enable it manually using the toggle above.',
          });
        }
      }
      
      setTimeout(() => {
        refetchBalance();
        loadRenewalStatus();
      }, 4000);
    } catch (err: any) {
      toast.error('Deposit failed', { description: err.message || 'Transaction rejected' });
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount || isNaN(Number(withdrawAmount))) return;
    try {
      const amountUnits = parseUnits(withdrawAmount, 6);
      
      const txHash = await writeContractAsync({
        address: addresses.renewalVault,
        abi: RENEWAL_VAULT_ABI,
        functionName: 'withdraw',
        args: [BigInt(tokenId), amountUnits],
      });
      
      toast.success('Withdrawal submitted', { description: 'Funds are returning to your wallet.' });
      setWithdrawAmount('');
      setTimeout(() => {
        refetchBalance();
        loadRenewalStatus();
      }, 4000);
    } catch (err: any) {
      toast.error('Withdrawal failed', { description: err.message || 'Transaction rejected' });
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
          Fund your domain's individual vault to allow our keeper bots to automatically renew your identity before it expires.
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
                  value={`$${Number(nextRenewalAmount).toFixed(2)}`}
                  sublabel="Next year"
                />
                <RenewalMetric
                  label="Vault balance"
                  value={`$${Number(displayedBalance).toFixed(2)}`}
                  sublabel="USDC"
                />
                <RenewalMetric
                  label="Need to deposit"
                  value={`$${Number(shortfallAmount).toFixed(2)}`}
                  sublabel={hasShortfall ? 'Missing' : 'Covered'}
                  tone={hasShortfall ? 'warning' : 'success'}
                />
              </div>

              <div className="rounded-lg border border-border/60 bg-background/55 p-4 shadow-inner shadow-black/10">
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
                          {status?.daysUntilExpiry !== null && status?.daysUntilExpiry !== undefined
                            ? ` (${status.daysUntilExpiry} days left)`
                            : ''}
                          {status?.renewableFrom
                            ? `, renewable from ${formatDate(new Date(status.renewableFrom))}`
                            : ''}
                        </>
                      ) : (
                        'Expiry date is not available yet.'
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={loadRenewalStatus}
                    disabled={statusLoading}
                    className="w-full sm:w-auto"
                  >
                    {statusLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Refresh
                  </Button>
                </div>
                {(status?.message || statusError) && (
                  <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                    {hasShortfall && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-orange-700" />}
                    <span>{statusError ?? status?.message}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/55 p-4 shadow-inner shadow-black/10">
              <Switch 
                id="auto-renew" 
                checked={isAutoRenewEnabled || false} 
                onCheckedChange={handleToggleAutoRenew}
                disabled={isPending || isAutoRenewEnabled === undefined}
              />
              <Label htmlFor="auto-renew" className="flex-1 cursor-pointer">
                <div className="font-medium">Enable Auto-Renew</div>
                <div className="text-xs text-muted-foreground">Keepers will renew this domain automatically when funds are available.</div>
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
                  placeholder={hasShortfall ? Number(shortfallAmount).toFixed(2) : '0.00'}
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="bg-background/70"
                />
                <Button onClick={handleDeposit} disabled={isPending || !depositAmount} variant="secondary" className="w-full sm:w-auto">
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Deposit
                </Button>
              </div>
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
                <Button onClick={handleWithdraw} disabled={isPending || !withdrawAmount || Number(balanceFormatted) === 0} variant="outline" className="w-full sm:w-auto">
                  Withdraw
                </Button>
              </div>
            </div>

          </div>

        </div>
      </CardContent>
    </Card>
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
    <div className="rounded-lg border border-border/60 bg-background/55 p-3 shadow-inner shadow-black/10">
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
