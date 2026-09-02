import { http, createConfig } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors';
import { BRAND_ASSETS } from '@/lib/brand-assets';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';
const WALLET_STORAGE_KEYS = new Set([
  'wagmi.store',
  'wagmi.recentconnectorid',
  'wagmi.walletconnect.requestedchains',
]);

type InjectedProvider = {
  isMetaMask?: true;
  isRabby?: true;
  isCoinbaseWallet?: true;
  isBaseWallet?: true;
  providers?: InjectedProvider[];
};

function getInjectedProvider(window: unknown, predicate: (provider: InjectedProvider) => boolean) {
  const ethereum = (window as { ethereum?: InjectedProvider } | undefined)?.ethereum;
  const providers = ethereum?.providers ?? (ethereum ? [ethereum] : []);
  return providers.find(predicate) as never;
}

export function getWagmiConfig() {
  const canUseWalletConnect = typeof window !== 'undefined' && projectId;
  const appOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'https://agentdomain.app';

  return createConfig({
    chains: [base],
    connectors: [
      // Coinbase Wallet: 'all' lets user choose Smart Wallet or EOA
      coinbaseWallet({
        appName: 'AgentDomain',
        preference: 'all',
      }),
      // Injected: MetaMask, Rabby, Base App, etc.
      injected({ shimDisconnect: true }),
      injected({
        shimDisconnect: true,
        target: {
          id: 'metaMask',
          name: 'MetaMask',
          provider: (window) =>
            getInjectedProvider(
              window,
              (provider) =>
                Boolean(provider.isMetaMask) &&
                !provider.isRabby &&
                !provider.isCoinbaseWallet &&
                !provider.isBaseWallet,
            ),
        },
      }),
      injected({
        shimDisconnect: true,
        target: {
          id: 'rabby',
          name: 'Rabby',
          provider: (window) =>
            getInjectedProvider(window, (provider) => Boolean(provider.isRabby)),
        },
      }),
      injected({
        shimDisconnect: true,
        target: {
          id: 'baseApp',
          name: 'Base App',
          provider: (window) =>
            getInjectedProvider(window, (provider) =>
              Boolean(provider.isCoinbaseWallet || provider.isBaseWallet),
            ),
        },
      }),
      // WalletConnect: 300+ mobile wallets
      ...(canUseWalletConnect
        ? [
            walletConnect({
              projectId,
              metadata: {
                name: 'AgentDomain',
                description: 'Identity infrastructure for AI agents',
                url: appOrigin,
                icons: [`${appOrigin}${BRAND_ASSETS.appIcon}`],
              },
            }) as ReturnType<typeof walletConnect>,
          ]
        : []),
    ],
    transports: {
      [base.id]: http('https://mainnet.base.org'),
    },
    ssr: true,
  });
}

export function clearWalletConnectionStorage() {
  if (typeof window === 'undefined') return;

  clearStorage(window.localStorage);
  clearStorage(window.sessionStorage);
}

function clearStorage(storage: Storage) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }

  for (const key of keys) {
    if (!shouldClearWalletStorageKey(key)) continue;
    try {
      storage.removeItem(key);
    } catch {
      // Ignore browser storage permission errors.
    }
  }
}

function shouldClearWalletStorageKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    WALLET_STORAGE_KEYS.has(normalized) ||
    normalized.startsWith('wc@2:') ||
    normalized.includes('walletconnect') ||
    normalized.includes('walletlink') ||
    normalized.includes('coinbasewallet') ||
    normalized.includes('coinbase.wallet') ||
    normalized.includes('coinbase-wallet') ||
    normalized.includes('cbwallet') ||
    normalized.startsWith('cbw')
  );
}
