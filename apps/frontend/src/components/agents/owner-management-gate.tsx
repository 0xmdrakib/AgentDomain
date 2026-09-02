'use client';

import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConnectWalletButton } from '@/components/wallet/connect-wallet-button';
import { useSiwe } from '@/hooks/use-siwe';
import { normalizeAddress } from '@/lib/address';
import { shortAddress } from '@/lib/utils';

export function OwnerManagementGate({
  ownerAddress,
  onRefresh,
}: {
  ownerAddress: string;
  onRefresh?: () => void;
}) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { session, signIn, loading, error } = useSiwe();
  const owner = normalizeAddress(ownerAddress);
  const connected = normalizeAddress(address);
  const connectedOwner = Boolean(owner && connected && owner === connected);

  async function handleSignIn() {
    const ok = await signIn();
    if (ok) {
      if (onRefresh) onRefresh();
      else router.refresh();
    }
  }

  return (
    <Card className="premium-surface border-primary/20">
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
              <LockKeyhole className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold">Owner management is private</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                DNS, renewal vault, email inbox, and metadata controls are only available to the
                owner wallet.
              </p>
              <div className="mt-2 font-mono text-xs text-muted-foreground">
                Owner {shortAddress(ownerAddress, 8)}
              </div>
              {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
            </div>
          </div>

          {!isConnected ? (
            <ConnectWalletButton className="w-full sm:w-auto" />
          ) : connectedOwner && !session.authenticated ? (
            <Button onClick={handleSignIn} disabled={loading} className="w-full sm:w-auto">
              <ShieldCheck className="h-4 w-4" />
              {loading ? 'Signing in...' : 'Sign in to manage'}
            </Button>
          ) : connectedOwner ? (
            <Button
              onClick={() => (onRefresh ? onRefresh() : router.refresh())}
              variant="outline"
              className="w-full sm:w-auto"
            >
              Open management
            </Button>
          ) : (
            <div className="rounded-lg border border-border/60 bg-background/55 px-3 py-2 text-sm text-muted-foreground">
              Connected wallet is not the owner.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
