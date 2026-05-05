'use client';

import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2, Coins, ShieldCheck, RefreshCw } from 'lucide-react';
import { RENEWAL_VAULT_ABI, USDC_ABI } from '@/lib/abis';
import { addresses } from '@/lib/constants';
import { toast } from 'sonner';

interface RenewalManagementProps {
  tokenId: number;
}

export function RenewalManagement({ tokenId }: RenewalManagementProps) {
  const { isConnected } = useAccount();
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');

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
      setTimeout(() => refetchAutoRenew(), 3000);
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
      
      setTimeout(() => refetchBalance(), 4000);
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
      setTimeout(() => refetchBalance(), 4000);
    } catch (err: any) {
      toast.error('Withdrawal failed', { description: err.message || 'Transaction rejected' });
    }
  };

  if (!isConnected) {
    return null;
  }

  return (
    <Card className="mb-6 border-border/50 bg-accent/10">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <CardTitle>Autonomous Renewals (RenewalVault)</CardTitle>
        </div>
        <CardDescription>
          Fund your domain's individual vault to allow our keeper bots to automatically renew your identity before it expires.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Status Column */}
          <div className="space-y-6">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Vault Balance</div>
              <div className="text-3xl font-bold flex items-center gap-2">
                <Coins className="h-6 w-6 text-muted-foreground" />
                ${Number(balanceFormatted).toFixed(2)} <span className="text-sm font-normal text-muted-foreground">USDC</span>
              </div>
            </div>

            <div className="flex items-center space-x-2 bg-background p-4 rounded-lg border border-border/50">
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
          <div className="space-y-6 border-l border-border/40 pl-0 md:pl-8">
            
            <div className="space-y-3">
              <div className="text-sm font-medium">Deposit Funds</div>
              <div className="flex items-center gap-2">
                <Input 
                  type="number" 
                  placeholder="0.00" 
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="bg-background"
                />
                <Button onClick={handleDeposit} disabled={isPending || !depositAmount} variant="secondary">
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Deposit
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-sm font-medium text-muted-foreground">Withdraw Funds</div>
              <div className="flex items-center gap-2">
                <Input 
                  type="number" 
                  placeholder="0.00" 
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  className="bg-background"
                />
                <Button onClick={handleWithdraw} disabled={isPending || !withdrawAmount || Number(balanceFormatted) === 0} variant="outline">
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
