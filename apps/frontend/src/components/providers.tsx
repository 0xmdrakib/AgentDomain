'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { WagmiProvider, useConfig } from 'wagmi';
import { getAccount, watchAccount } from 'wagmi/actions';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getWagmiConfig } from '@/lib/wagmi';
import {
  RegistrationTrackerProvider,
  useRegistrationTracker,
} from '@/components/register/registration-tracker-provider';
import { REGISTRATION_CHANGED_EVENT } from '@/lib/registration-progress';

/**
 * Top-level client providers. Mounted from the server layout via a client
 * boundary so we can use React hooks for query/wallet state.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [config] = useState(() => getWagmiConfig());
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
        },
      }),
  );

  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries();
    };
    window.addEventListener(REGISTRATION_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(REGISTRATION_CHANGED_EVENT, refresh);
  }, [queryClient]);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RegistrationTrackerProvider>
          <RegistrationWalletBridge />
          {children}
        </RegistrationTrackerProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function RegistrationWalletBridge() {
  const config = useConfig();
  const tracker = useRegistrationTracker();
  useEffect(() => {
    const synchronize = (account: ReturnType<typeof getAccount>) => {
      tracker.setExpectedWallet(account.status === 'connected' ? account.address : null);
    };
    synchronize(getAccount(config));
    return watchAccount(config, { onChange: synchronize });
  }, [config, tracker]);
  return null;
}
