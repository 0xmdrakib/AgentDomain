'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccount, useConnect, useSwitchChain } from 'wagmi';
import type { Connector } from 'wagmi';
import { base } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import { Check, Loader2, Wallet, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button, type ButtonProps } from '@/components/ui/button';
import { getBaseChainSwitchCopy } from '@/lib/base-chain';
import { clearWalletConnectionStorage } from '@/lib/wagmi';
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
const WALLET_DIALOG_OPEN_ATTR = 'data-agentdomain-wallet-dialog-open';
const BASE_APP_ICON_URL =
  'data:image/svg+xml,%3Csvg xmlns%3D%22http://www.w3.org/2000/svg%22 viewBox%3D%220 0 512 512%22%3E%3Crect width%3D%22512%22 height%3D%22512%22 rx%3D%2298%22 fill%3D%22%230052FF%22/%3E%3Ccircle cx%3D%22256%22 cy%3D%22256%22 r%3D%22132%22 fill%3D%22white%22/%3E%3Crect x%3D%22218%22 y%3D%22218%22 width%3D%2276%22 height%3D%2276%22 rx%3D%2214%22 fill%3D%22%230052FF%22/%3E%3C/svg%3E';

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

type WalletConnectorMessage = {
  type: string;
  data?: unknown;
  uid?: string;
};

const INJECTED_WALLETS: Record<
  string,
  Omit<InjectedWalletOption, 'connector' | 'pendingId' | 'installed'>
> = {
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
    iconUrl: BASE_APP_ICON_URL,
    fallback: 'B',
    accent: 'from-blue-600 to-blue-800',
  },
};

export function ConnectWalletButton({
  className,
  variant = 'gradient',
  size = 'sm',
}: ConnectWalletButtonProps) {
  const { address, isConnected, status } = useAccount();
  const { connectAsync, connectors, error, reset } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [showInjectedSelector, setShowInjectedSelector] = useState(false);
  const [ready, setReady] = useState(false);
  const [pendingConnectorUid, setPendingConnectorUid] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [walletConnectUri, setWalletConnectUri] = useState<string | null>(null);
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
      setWalletConnectUri(null);
    }
  }, [isConnected]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;

    document.body.setAttribute(WALLET_DIALOG_OPEN_ATTR, 'true');
    return () => {
      document.body.removeAttribute(WALLET_DIALOG_OPEN_ATTR);
    };
  }, [open]);

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

  useEffect(() => {
    const walletConnectConnector = connectors.find((connector) => connector.id === 'walletConnect');
    if (!walletConnectConnector) return;

    const onMessage = (event: WalletConnectorMessage) => {
      if (event.type === 'display_uri' && typeof event.data === 'string') {
        setWalletConnectUri(event.data);
      }
    };

    walletConnectConnector.emitter.on('message', onMessage);
    return () => walletConnectConnector.emitter.off('message', onMessage);
  }, [connectors]);

  function closeSelector() {
    reset();
    setOpen(false);
    setShowInjectedSelector(false);
    setPendingConnectorUid(null);
    setLocalError(null);
    setWalletConnectUri(null);
  }

  async function handleConnect(connector: ConnectableConnector, pendingId?: string) {
    const connectorId = 'id' in connector ? connector.id : pendingId;
    reset();
    if (shouldClearConnectorStorage(connectorId)) clearWalletConnectionStorage();
    setPendingConnectorUid(pendingId ?? ('uid' in connector ? connector.uid : null));
    setLocalError(null);
    setWalletConnectUri(null);

    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      reset();
      setPendingConnectorUid(null);
      setLocalError(
        connectorId === 'walletConnect'
          ? 'WalletConnect did not open. Tap Open wallet app, or use a wallet browser and try again.'
          : 'Wallet did not respond. Open your wallet app and try again.',
      );
      if (shouldClearConnectorStorage(connectorId)) clearWalletConnectionStorage();
    }, CONNECT_TIMEOUT_MS);

    try {
      const result = await connectAsync({ connector });
      await switchConnectedWalletToBase(connector, result.chainId);
    } catch (e) {
      reset();
      if (shouldClearConnectorStorage(connectorId)) clearWalletConnectionStorage();
      if (!isCancelledConnectError(e) && !timedOut) {
        setLocalError(e instanceof Error ? e.message : 'Failed to connect wallet');
      }
    } finally {
      window.clearTimeout(timeout);
      setPendingConnectorUid(null);
    }
  }

  async function switchConnectedWalletToBase(
    connector: ConnectableConnector,
    connectedChainId: number | undefined,
  ) {
    const chainId = connectedChainId ?? (await readConnectorChainId(connector));
    if (chainId === base.id) return;

    try {
      await switchChainAsync({ chainId: base.id });
    } catch (e) {
      const copy = getBaseChainSwitchCopy(e);
      if (copy.kind === 'cancelled') {
        toast.info(copy.title, { description: copy.description });
      } else {
        toast.error(copy.title, { description: copy.description });
      }
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
      return {
        ...meta,
        connector,
        pendingId: connector.uid,
        installed: true,
      } satisfies InjectedWalletOption;
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
            walletConnectUri={walletConnectUri}
            onClose={closeSelector}
            onInjectedSelect={() => {
              reset();
              setLocalError(null);
              setWalletConnectUri(null);
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
              setWalletConnectUri(null);
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
  walletConnectUri,
  onClose,
  onInjectedSelect,
  onConnect,
}: {
  connectors: Connector[];
  pendingConnectorUid: string | null;
  errorMessage: string | null;
  walletConnectUri: string | null;
  onClose: () => void;
  onInjectedSelect: () => void;
  onConnect: (connector: ConnectableConnector, pendingId?: string) => void;
}) {
  return (
    <div
      data-agentdomain-wallet-dialog="true"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-background/92 px-4 py-6 sm:bg-background/72 sm:px-6 sm:backdrop-blur-md"
    >
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

        {walletConnectUri && (
          <div className="border-t border-border/40 px-5 py-3">
            <a
              className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              href={buildWalletConnectLink(walletConnectUri)}
              target="_blank"
              rel="noreferrer"
            >
              Open wallet app
            </a>
          </div>
        )}

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
    <div
      data-agentdomain-wallet-dialog="true"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-background/92 px-4 py-6 sm:bg-background/75 sm:px-6 sm:backdrop-blur-md"
    >
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
              No injected wallet found. Install MetaMask, Rabby, or Coinbase Wallet/Base App and try
              again.
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
  const [iconFailed, setIconFailed] = useState(false);
  const showIcon = Boolean(wallet.iconUrl && !iconFailed);
  const isBaseApp = wallet.id === 'baseApp';

  return (
    <div
      className={cn(
        'relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br text-sm font-bold text-white shadow-[0_10px_22px_-16px_rgba(20,21,18,0.75)]',
        isBaseApp ? 'rounded-xl' : 'rounded-full',
        wallet.accent,
      )}
    >
      {pending ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <>
          <span>{wallet.fallback}</span>
          {showIcon && (
            // Wallet artwork is a small, non-LCP runtime image with a native error fallback.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={wallet.iconUrl}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className={cn(
                'absolute inset-0 h-full w-full object-contain',
                isBaseApp ? 'bg-transparent p-0' : 'bg-white p-1.5',
              )}
              onError={() => setIconFailed(true)}
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
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'W'
  );
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
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('user rejected') ||
    message.includes('user denied') ||
    message.includes('user closed') ||
    message.includes('cancel') ||
    message.includes('modal closed') ||
    message.includes('request rejected')
  );
}

function shouldClearConnectorStorage(connectorId: string | undefined) {
  return connectorId === 'walletConnect' || connectorId === 'coinbaseWalletSDK';
}

async function readConnectorChainId(connector: ConnectableConnector) {
  if (!('getChainId' in connector) || typeof connector.getChainId !== 'function') return null;
  try {
    return await connector.getChainId();
  } catch {
    return null;
  }
}

function buildWalletConnectLink(uri: string) {
  return `https://link.walletconnect.com/wc?uri=${encodeURIComponent(uri)}`;
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
