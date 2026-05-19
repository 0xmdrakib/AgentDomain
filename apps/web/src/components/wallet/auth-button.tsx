'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { ChevronDown, LogOut } from 'lucide-react';
import { ConnectWalletButton } from './connect-wallet-button';
import { cn, shortAddress } from '@/lib/utils';

/**
 * Nav auth control.
 *
 * States:
 * - disconnected: opens the wallet selector
 * - connected: shows the connected address and wallet actions
 */
export function AuthButton({ className }: { className?: string }) {
  const { isConnected, address, status } = useAccount();
  const { disconnect } = useDisconnect();
  const [ready, setReady] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    if (status !== 'reconnecting') setReady(true);
  }, [status]);

  useEffect(() => {
    if (!isConnected) setShowMenu(false);
  }, [isConnected]);

  if (!ready || status === 'reconnecting') {
    return <div className={cn('h-10 w-36 rounded-full', className)} />;
  }

  if (!isConnected || !address) {
    return <ConnectWalletButton className={className} />;
  }

  return (
    <div className={cn('relative inline-flex', className)}>
      <button
        type="button"
        className="flex h-10 max-w-full items-center justify-center gap-2 rounded-full border border-primary/20 bg-card/70 px-3 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.78),0_10px_24px_-18px_rgba(20,21,18,0.42)] transition-colors hover:bg-accent/80"
        onClick={() => setShowMenu(!showMenu)}
      >
        <span className="h-2 w-2 rounded-full bg-orange-600 shadow-[0_0_0_3px_rgba(234,88,12,0.12)]" />
        <span className="hidden font-medium text-foreground sm:inline">Connected</span>
        <span className="font-mono text-xs text-muted-foreground">{shortAddress(address)}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {showMenu && (
        <WalletMenu onClose={() => setShowMenu(false)}>
          <div className="p-3">
            <div className="rounded-lg border border-border/50 bg-card/60 p-3">
              <div className="text-xs text-muted-foreground">Connected wallet</div>
              <div className="mt-1 break-all font-mono text-sm text-foreground">
                {shortAddress(address, 8)}
              </div>
            </div>
            <button
              type="button"
              className="mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
              onClick={() => {
                disconnect();
                setShowMenu(false);
              }}
            >
              <LogOut className="h-4 w-4" />
              Disconnect wallet
            </button>
          </div>
        </WalletMenu>
      )}
    </div>
  );
}

function WalletMenu({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div className="absolute right-0 top-full z-50 mt-2 w-[min(92vw,300px)] overflow-hidden rounded-xl border border-border/70 bg-popover shadow-[0_22px_48px_-34px_rgba(20,21,18,0.55)]">
        {children}
      </div>
    </>
  );
}
