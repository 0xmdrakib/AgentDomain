'use client';

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { Check, ChevronDown, Copy, LogOut, Wallet } from 'lucide-react';
import { ConnectWalletButton } from './connect-wallet-button';
import { clearWalletConnectionStorage } from '@/lib/wagmi';
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
  const { disconnectAsync } = useDisconnect();
  const [ready, setReady] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const disconnectingRef = useRef(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status !== 'reconnecting') setReady(true);
  }, [status]);

  useEffect(() => {
    if (!isConnected) setShowMenu(false);
  }, [isConnected]);

  useEffect(() => {
    if (!showMenu) setCopied(false);
  }, [showMenu]);

  useEffect(
    () => () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    },
    [],
  );

  async function handleCopyAddress() {
    if (!address) return;

    try {
      await navigator.clipboard.writeText(address);
    } catch {
      return;
    }
    setCopied(true);
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => setCopied(false), 1600);
  }

  async function handleDisconnect() {
    if (disconnectingRef.current) return;
    disconnectingRef.current = true;
    setDisconnecting(true);

    try {
      await disconnectAsync();
    } catch {
      // Still clear local connector state so the next mobile connect starts cleanly.
    } finally {
      clearWalletConnectionStorage();
      setShowMenu(false);
      setDisconnecting(false);
      disconnectingRef.current = false;
    }
  }

  function handleDisconnectPointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    void handleDisconnect();
  }

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
        className="premium-surface flex h-10 max-w-full items-center justify-center gap-2 rounded-full border px-3 text-sm transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_18px_38px_-28px_rgba(20,21,18,0.5)]"
        onClick={() => setShowMenu(!showMenu)}
        aria-expanded={showMenu}
        aria-haspopup="menu"
      >
        <span className="h-2 w-2 rounded-full bg-orange-600 shadow-[0_0_0_3px_rgba(234,88,12,0.12)]" />
        <span className="hidden font-medium text-foreground sm:inline">Connected</span>
        <span className="font-mono text-xs text-muted-foreground">{shortAddress(address)}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {showMenu && (
        <WalletMenu onClose={() => setShowMenu(false)}>
          <div className="p-4">
            <div className="flex items-center gap-3">
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-[0_10px_24px_-16px_rgba(20,21,18,0.75)]">
                <Wallet className="h-4 w-4" strokeWidth={1.8} />
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-popover bg-emerald-500" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">Wallet connected</span>
                  <span className="rounded-full border border-emerald-600/20 bg-emerald-600/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                    Active
                  </span>
                </div>
                <div
                  className="mt-1 truncate font-mono text-xs text-muted-foreground"
                  title={address}
                >
                  {shortAddress(address)}
                </div>
              </div>

              <button
                type="button"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/75 bg-background text-muted-foreground transition-[border-color,background-color,color] hover:border-primary/35 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2"
                onClick={(event) => {
                  event.stopPropagation();
                  void handleCopyAddress();
                }}
                aria-label={copied ? 'Wallet address copied' : 'Copy wallet address'}
                title={copied ? 'Copied' : 'Copy wallet address'}
                role="menuitem"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-700" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>

            <div className="my-3 h-px bg-border/75" />

            <button
              type="button"
              className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-destructive/20 bg-card/55 px-3 py-2 text-sm font-medium text-destructive shadow-[inset_0_1px_0_rgba(255,255,255,0.68)] transition-[border-color,background-color] hover:border-destructive/35 hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-60"
              onPointerDown={handleDisconnectPointerDown}
              onClick={(event) => {
                event.stopPropagation();
                void handleDisconnect();
              }}
              disabled={disconnecting}
              role="menuitem"
            >
              <LogOut className="h-4 w-4" />
              {disconnecting ? 'Disconnecting...' : 'Disconnect wallet'}
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
      <div className="fixed inset-0 z-40" onPointerDown={onClose} aria-hidden />
      <div
        className="premium-surface premium-elevated absolute right-0 top-full z-50 mt-2 w-[min(92vw,324px)] overflow-hidden rounded-lg border"
        role="menu"
        aria-label="Connected wallet menu"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </>
  );
}
