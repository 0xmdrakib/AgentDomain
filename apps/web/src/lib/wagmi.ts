import { http, createConfig } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

type InjectedProvider = {
  isMetaMask?: true;
  isRabby?: true;
  isCoinbaseWallet?: true;
  isBaseWallet?: true;
  providers?: InjectedProvider[];
};

function getInjectedProvider(
  window: unknown,
  predicate: (provider: InjectedProvider) => boolean,
) {
  const ethereum = (window as { ethereum?: InjectedProvider } | undefined)?.ethereum;
  const providers = ethereum?.providers ?? (ethereum ? [ethereum] : []);
  return providers.find(predicate) as never;
}

export function getWagmiConfig() {
  const canUseWalletConnect = typeof window !== 'undefined' && projectId;

  return createConfig({
    chains: [base, baseSepolia],
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
          provider: (window) => getInjectedProvider(window, (provider) => Boolean(provider.isRabby)),
        },
      }),
      injected({
        shimDisconnect: true,
        target: {
          id: 'baseApp',
          name: 'Base App',
          provider: (window) =>
            getInjectedProvider(
              window,
              (provider) => Boolean(provider.isCoinbaseWallet || provider.isBaseWallet),
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
                url: 'https://agentdomain.xyz',
                icons: ['https://agentdomain.xyz/icon.png'],
              },
            }) as ReturnType<typeof walletConnect>,
          ]
        : []),
    ],
    transports: {
      [base.id]: http('https://mainnet.base.org'),
      [baseSepolia.id]: http('https://sepolia.base.org'),
    },
    ssr: true,
  });
}
