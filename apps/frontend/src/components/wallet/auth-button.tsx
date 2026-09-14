'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useAccount, useConfig } from 'wagmi';
import { Check, ChevronDown, Copy, LogOut, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { ConnectWalletButton } from './connect-wallet-button';
import { clearWalletConnectionStorage } from '@/lib/wagmi';
import { disconnectWalletConnections } from '@/lib/wallet-connections';
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
  const config = useConfig();
  const [ready, setReady] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const disconnectingRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
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
      await disconnectWalletConnections(config);
      clearWalletConnectionStorage();
      setShowMenu(false);
    } catch {
      toast.error('Could not disconnect wallet', {
        description: 'The wallet is still connected. Please try again.',
      });
    } finally {
      setDisconnecting(false);
      disconnectingRef.current = false;
    }
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
        ref={triggerRef}
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
        <WalletMenu anchorRef={triggerRef} onClose={() => setShowMenu(false)}>
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

function WalletMenu({
  children,
  anchorRef,
  onClose,
}: {
  children: ReactNode;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 324, maxHeight: 0 });

  useLayoutEffect(() => {
    function alignMenu() {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(324, window.innerWidth - 32);
      const maxHeight = window.innerHeight - 32;
      const height = Math.min(menuRef.current?.scrollHeight ?? 0, maxHeight);
      const below = anchor.bottom + 8;
      setPosition({
        left: Math.max(16, Math.min(anchor.right - width, window.innerWidth - width - 16)),
        top: Math.max(
          16,
          below + height <= window.innerHeight - 16 ? below : anchor.top - height - 8,
        ),
        width,
        maxHeight,
      });
    }
    alignMenu();
    window.addEventListener('resize', alignMenu);
    window.addEventListener('scroll', alignMenu, true);
    return () => {
      window.removeEventListener('resize', alignMenu);
      window.removeEventListener('scroll', alignMenu, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    const anchor = anchorRef.current;
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus({ preventScroll: true });
    return () => {
      if (anchor?.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchorRef]);

  return createPortal(
    <div data-agentdomain-wallet-menu="true" className="fixed inset-0 z-[80]">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        ref={menuRef}
        className="premium-surface premium-elevated fixed overflow-y-auto rounded-lg border"
        style={position}
        role="menu"
        aria-label="Connected wallet menu"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
