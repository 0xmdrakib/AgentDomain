'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccount, useConnect } from 'wagmi';
import type { Connector } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { Check, Loader2, Wallet, X } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn, shortAddress } from '@/lib/utils';

interface ConnectWalletButtonProps {
  className?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
}

const CONNECTOR_LABELS: Record<string, string> = {
  injected: 'Injected Wallet',
  walletConnect: 'WalletConnect',
  coinbaseWalletSDK: 'Coinbase Wallet',
};

const CONNECTOR_DESCRIPTIONS: Record<string, string> = {
  injected: 'MetaMask, Rabby, Base',
  walletConnect: 'Open WalletConnect',
  coinbaseWalletSDK: 'Coinbase Wallet or Base App',
};

const CONNECTOR_ORDER = ['injected', 'walletConnect', 'coinbaseWalletSDK'];
const INJECTED_WALLET_ORDER = ['metaMask', 'rabby', 'baseApp'];
const CONNECT_TIMEOUT_MS = 20_000;

type InjectedWalletId = string;
type ConnectableConnector = Connector | ReturnType<typeof injected>;

type InjectedWalletOption = {
  id: InjectedWalletId;
  name: string;
  description: string;
  connector: ConnectableConnector;
  pendingId: string;
  installed: boolean;
  iconUrl?: string;
  fallback: string;
  accent: string;
};

type InjectedProvider = {
  isMetaMask?: true;
  isRabby?: true;
  isCoinbaseWallet?: true;
  isBaseWallet?: true;
  providers?: InjectedProvider[];
};

type Eip6963ProviderDetail = {
  info: {
    uuid: string;
    name: string;
    icon?: string;
    rdns: string;
  };
  provider: InjectedProvider;
};

type Eip6963AnnounceEvent = CustomEvent<Eip6963ProviderDetail>;

const INJECTED_WALLETS: Record<string, Omit<InjectedWalletOption, 'connector' | 'pendingId' | 'installed'>> = {
  metaMask: {
    id: 'metaMask',
    name: 'MetaMask',
    description: 'Browser extension wallet',
    iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg',
    fallback: 'M',
    accent: 'from-orange-400 to-amber-500',
  },
  rabby: {
    id: 'rabby',
    name: 'Rabby',
    description: 'DeFi-friendly injected wallet',
    iconUrl: 'https://rabby.io/assets/images/logo-128.png',
    fallback: 'R',
    accent: 'from-stone-700 to-stone-950',
  },
  baseApp: {
    id: 'baseApp',
    name: 'Base App',
    description: 'Coinbase Wallet or Base App',
    fallback: 'B',
    accent: 'from-stone-800 to-stone-950',
  },
};

export function ConnectWalletButton({
  className,
  variant = 'gradient',
  size = 'sm',
}: ConnectWalletButtonProps) {
  const { address, isConnected, status } = useAccount();
  const { connectAsync, connectors, error, reset } = useConnect();
  const [open, setOpen] = useState(false);
  const [showInjectedSelector, setShowInjectedSelector] = useState(false);
  const [ready, setReady] = useState(false);
  const [pendingConnectorUid, setPendingConnectorUid] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [eip6963Providers, setEip6963Providers] = useState<Eip6963ProviderDetail[]>([]);

  useEffect(() => {
    if (status !== 'reconnecting') setReady(true);
  }, [status]);

  useEffect(() => {
    if (isConnected) {
      setOpen(false);
      setShowInjectedSelector(false);
      setPendingConnectorUid(null);
      setLocalError(null);
    }
  }, [isConnected]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function onAnnounce(event: Event) {
      const detail = (event as Eip6963AnnounceEvent).detail;
      if (!detail?.info?.uuid || !detail.info.name || !detail.provider) return;

      setEip6963Providers((current) => {
        const exists = current.some(
          (provider) =>
            provider.info.uuid === detail.info.uuid || provider.info.rdns === detail.info.rdns,
        );
        if (exists) return current;
        return [...current, detail].sort((a, b) => a.info.name.localeCompare(b.info.name));
      });
    }

    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
  }, []);

  function closeSelector() {
    reset();
    setOpen(false);
    setShowInjectedSelector(false);
    setPendingConnectorUid(null);
    setLocalError(null);
  }

  async function handleConnect(connector: ConnectableConnector, pendingId?: string) {
    reset();
    setPendingConnectorUid(pendingId ?? ('uid' in connector ? connector.uid : null));
    setLocalError(null);

    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      reset();
      setPendingConnectorUid(null);
    }, CONNECT_TIMEOUT_MS);

    try {
      await connectAsync({ connector });
    } catch (e) {
      reset();
      if (!isCancelledConnectError(e) && !timedOut) {
        setLocalError(e instanceof Error ? e.message : 'Failed to connect wallet');
      }
    } finally {
      window.clearTimeout(timeout);
      setPendingConnectorUid(null);
    }
  }

  const walletOptions = useMemo(() => {
    return connectors
      .filter((connector) => CONNECTOR_ORDER.includes(connector.id))
      .sort((a, b) => CONNECTOR_ORDER.indexOf(a.id) - CONNECTOR_ORDER.indexOf(b.id));
  }, [connectors]);

  const injectedOptions = useMemo(() => {
    if (typeof window === 'undefined') return [];

    const eip6963Options = eip6963Providers.map((detail) => {
      const id = normalizeInjectedWalletId(detail.info.rdns, detail.info.name);
      const meta = INJECTED_WALLETS[id];

      return {
        id,
        name: meta?.name ?? detail.info.name,
        description: meta?.description ?? 'Detected browser wallet',
        connector: injected({
          shimDisconnect: true,
          target: {
            id: detail.info.rdns || detail.info.uuid,
            name: detail.info.name,
            icon: detail.info.icon,
            provider: detail.provider as never,
          },
        }),
        pendingId: detail.info.uuid,
        installed: true,
        iconUrl: detail.info.icon ?? meta?.iconUrl,
        fallback: meta?.fallback ?? getInitials(detail.info.name),
        accent: meta?.accent ?? 'from-stone-700 to-stone-950',
      } satisfies InjectedWalletOption;
    });

    if (eip6963Options.length > 0) return dedupeInjectedOptions(eip6963Options);

    const knownOptions = INJECTED_WALLET_ORDER.map((id) => {
      const connector = connectors.find((item) => item.id === id);
      const meta = INJECTED_WALLETS[id];
      if (!connector || !meta || !isInjectedWalletAvailable(id)) return null;
      return { ...meta, connector, pendingId: connector.uid, installed: true } satisfies InjectedWalletOption;
    }).filter(Boolean) as InjectedWalletOption[];

    if (knownOptions.length > 0) return knownOptions;

    const browserConnector = connectors.find((item) => item.id === 'injected');
    if (browserConnector && hasAnyInjectedProvider()) {
      return [
        {
          id: 'browser',
          name: 'Browser Wallet',
          description: 'Detected injected wallet provider',
          connector: browserConnector,
          pendingId: browserConnector.uid,
          installed: true,
          fallback: 'W',
          accent: 'from-stone-700 to-stone-950',
        },
      ] satisfies InjectedWalletOption[];
    }

    return [];
  }, [connectors, eip6963Providers]);

  if (!ready || status === 'reconnecting') {
    return <div className={cn('h-9 w-36 rounded-md', className)} />;
  }

  return (
    <div className="relative inline-flex">
      <Button
        type="button"
        variant={isConnected ? 'outline' : variant}
        size={size}
        className={cn(isConnected && 'font-mono', className)}
        onClick={() => setOpen(true)}
      >
        {isConnected && address ? (
          <>
            <span className="h-2 w-2 rounded-full bg-orange-600" />
            {shortAddress(address)}
          </>
        ) : (
          <>
            <Wallet className="h-4 w-4" />
            Connect Wallet
          </>
        )}
      </Button>

      {open &&
        createPortal(
          <WalletProviderSelector
            connectors={walletOptions}
            pendingConnectorUid={pendingConnectorUid}
            errorMessage={localError ?? error?.message ?? null}
            onClose={closeSelector}
            onInjectedSelect={() => {
              reset();
              setLocalError(null);
              setPendingConnectorUid(null);
              setShowInjectedSelector(true);
            }}
            onConnect={handleConnect}
          />,
          document.body,
        )}

      {open &&
        showInjectedSelector &&
        createPortal(
          <InjectedWalletSelector
            wallets={injectedOptions}
            pendingConnectorUid={pendingConnectorUid}
            onClose={() => {
              reset();
              setShowInjectedSelector(false);
              setPendingConnectorUid(null);
              setLocalError(null);
            }}
            onConnect={handleConnect}
          />,
          document.body,
        )}
    </div>
  );
}

function WalletProviderSelector({
  connectors,
  pendingConnectorUid,
  errorMessage,
  onClose,
  onInjectedSelect,
  onConnect,
}: {
  connectors: Connector[];
  pendingConnectorUid: string | null;
  errorMessage: string | null;
  onClose: () => void;
  onInjectedSelect: () => void;
  onConnect: (connector: ConnectableConnector, pendingId?: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/72 px-4 py-6 backdrop-blur-md sm:px-6">
      <div className="absolute inset-0 z-0" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-[380px] flex-col overflow-hidden rounded-[24px] border border-border/80 bg-popover/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_24px_58px_-34px_rgba(20,21,18,0.56)]">
        <div className="flex items-start justify-between border-b border-border/40 px-5 py-5">
          <div className="min-w-0">
            <div className="text-base font-semibold tracking-tight">Connect wallet</div>
            <div className="mt-1 text-sm leading-5 text-muted-foreground">
              Choose one wallet provider to continue.
            </div>
          </div>
          <button
            type="button"
            className="ml-3 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onClose}
            aria-label="Close wallet selector"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2.5 overflow-y-auto px-3.5 py-3.5 sm:px-4">
          {connectors.map((connector) => (
            <WalletOption
              key={connector.uid}
              connector={connector}
              pending={pendingConnectorUid === connector.uid}
              onConnect={() => {
                if (connector.id === 'injected') {
                  onInjectedSelect();
                  return;
                }
                onConnect(connector);
              }}
            />
          ))}
        </div>

        {errorMessage && (
          <div className="border-t border-border/40 bg-destructive/10 px-5 py-3 text-xs leading-5 text-destructive">
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}

function InjectedWalletSelector({
  wallets,
  pendingConnectorUid,
  onClose,
  onConnect,
}: {
  wallets: InjectedWalletOption[];
  pendingConnectorUid: string | null;
  onClose: () => void;
  onConnect: (connector: ConnectableConnector, pendingId?: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/75 px-4 py-6 backdrop-blur-md sm:px-6">
      <div className="absolute inset-0 z-0" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-[390px] flex-col overflow-hidden rounded-[28px] border border-border/80 bg-popover/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_24px_58px_-34px_rgba(20,21,18,0.56)]">
        <div className="flex items-start justify-between px-6 pb-3 pt-6">
          <div className="min-w-0">
            <div className="text-lg font-semibold tracking-tight">Choose wallet</div>
            <div className="mt-2 text-sm leading-6 text-muted-foreground">
              Multiple browser wallets detected. Pick one to use on Base.
            </div>
          </div>
          <button
            type="button"
            className="ml-3 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onClose}
            aria-label="Close injected wallet selector"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2.5 overflow-y-auto px-5 pb-5 pt-3">
          {wallets.length > 0 ? (
            wallets.map((wallet) => (
              <button
                key={wallet.id}
                type="button"
                className="group flex min-h-[66px] w-full items-center gap-3 rounded-2xl border border-border/70 bg-card/70 px-3.5 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_8px_18px_-16px_rgba(20,21,18,0.4)] transition-all hover:border-primary/40 hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => onConnect(wallet.connector, wallet.pendingId)}
                disabled={pendingConnectorUid === wallet.pendingId}
              >
                <WalletLogo wallet={wallet} pending={pendingConnectorUid === wallet.pendingId} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{wallet.name}</div>
                  <div className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
                    {wallet.description}
                  </div>
                </div>
                <Check className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            ))
          ) : (
            <div className="rounded-2xl border border-border/60 bg-card/70 p-4 text-sm leading-6 text-muted-foreground">
              No injected wallet found. Install MetaMask, Rabby, or Coinbase Wallet/Base App and try again.
            </div>
          )}
        </div>
        <div className="border-t border-border/40 px-6 py-4">
          <button
            type="button"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function WalletLogo({ wallet, pending }: { wallet: InjectedWalletOption; pending: boolean }) {
  return (
    <div className={cn('relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br text-sm font-bold text-white shadow-[0_10px_22px_-16px_rgba(20,21,18,0.75)]', wallet.accent)}>
      {pending ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <>
          <span>{wallet.fallback}</span>
          {wallet.iconUrl && (
            <span
              className="absolute inset-0 bg-white bg-contain bg-center bg-no-repeat p-1.5"
              style={{ backgroundImage: `url(${wallet.iconUrl})` }}
              aria-hidden="true"
            />
          )}
        </>
      )}
    </div>
  );
}

function normalizeInjectedWalletId(rdns: string, name: string): string {
  const key = `${rdns} ${name}`.toLowerCase();
  if (key.includes('metamask')) return 'metaMask';
  if (key.includes('rabby')) return 'rabby';
  if (key.includes('base') || key.includes('coinbase')) return 'baseApp';
  return rdns || name.toLowerCase().replace(/\s+/g, '-');
}

function dedupeInjectedOptions(options: InjectedWalletOption[]) {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.id}:${option.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'W';
}

function hasAnyInjectedProvider() {
  return Boolean((window as Window & { ethereum?: unknown }).ethereum);
}

function isInjectedWalletAvailable(id: string) {
  const ethereum = (window as Window & { ethereum?: InjectedProvider }).ethereum;
  const providers: InjectedProvider[] = ethereum?.providers ?? (ethereum ? [ethereum] : []);
  return providers.some((provider) => {
    if (id === 'metaMask') {
      return Boolean(
        provider.isMetaMask &&
        !provider.isRabby &&
          !provider.isCoinbaseWallet &&
          !provider.isBaseWallet,
      );
    }
    if (id === 'rabby') return Boolean(provider.isRabby);
    if (id === 'baseApp') return Boolean(provider.isCoinbaseWallet || provider.isBaseWallet);
    return false;
  });
}

function isCancelledConnectError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('user rejected') ||
    message.includes('user denied') ||
    message.includes('user closed') ||
    message.includes('cancel') ||
    message.includes('modal closed') ||
    message.includes('request rejected')
  );
}

function WalletOption({
  connector,
  pending,
  onConnect,
}: {
  connector: Connector;
  pending: boolean;
  onConnect: () => void;
}) {
  const label = CONNECTOR_LABELS[connector.id] ?? connector.name;
  const description = CONNECTOR_DESCRIPTIONS[connector.id] ?? connector.name;

  return (
    <button
      type="button"
      className="group flex min-h-[66px] w-full items-center gap-3 rounded-2xl border border-border/70 bg-card/70 px-3.5 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_8px_18px_-16px_rgba(20,21,18,0.4)] transition-all hover:border-primary/40 hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={onConnect}
      disabled={pending}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_10px_22px_-16px_rgba(20,21,18,0.75)]">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{label}</div>
        <div className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
          {description}
        </div>
      </div>
      <Check className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
