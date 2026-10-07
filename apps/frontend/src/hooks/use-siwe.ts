'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useChainId, useSignMessage, useConfig } from 'wagmi';
import { SiweMessage } from 'siwe';
import { getAddress } from 'viem';
import { clearWalletConnectionStorage } from '@/lib/wagmi';
import { disconnectWalletConnections } from '@/lib/wallet-connections';
import { formatWalletAuthError } from '@/lib/wallet-auth-errors';
import { requestSiwe } from '@/lib/siwe-request';

export interface SiweSession {
  authenticated: boolean;
  address?: string;
  chainId?: number;
  expiresAt?: number;
}

export interface UseSiweReturn {
  session: SiweSession;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
}

/**
 * Sign-In with Ethereum hook.
 *
 * Wraps the full SIWE flow:
 *   1. fetch nonce from /api/v1/auth/nonce
 *   2. construct EIP-4361 message
 *   3. ask wagmi to sign
 *   4. POST to /api/v1/auth/verify
 *   5. cache session in state and refresh from /api/v1/auth/session on mount
 */
export function useSiwe(): UseSiweReturn {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const config = useConfig();

  const [session, setSession] = useState<SiweSession>({ authenticated: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeOperation = useRef<AbortController | null>(null);
  const sessionRead = useRef<AbortController | null>(null);

  // Obsolete HTTP is abortable; a wallet prompt stays pending until the wallet settles it.
  useEffect(
    () => () => {
      activeOperation.current?.abort();
    },
    [address, chainId, isConnected],
  );

  // Refresh session on mount + whenever wallet changes
  useEffect(() => {
    setError(null);
    setSession({ authenticated: false });
    if (!address) {
      return;
    }

    let cancelled = false;
    const refresh = () => {
      if (activeOperation.current) return;
      sessionRead.current?.abort();
      const controller = new AbortController();
      sessionRead.current = controller;
      return requestSiwe<SiweSession>('session', { signal: controller.signal })
        .then((data) => {
          if (cancelled || controller.signal.aborted) return;
          const nextSession = data;
          if (
            nextSession.authenticated &&
            nextSession.address &&
            nextSession.address.toLowerCase() !== address.toLowerCase()
          ) {
            setSession({ authenticated: false });
            return;
          }
          setSession(nextSession);
          setError(null);
        })
        .catch((e) => {
          if (cancelled || controller.signal.aborted) return;
          setSession({ authenticated: false });
          setError(formatWalletAuthError(e));
        })
        .finally(() => {
          if (sessionRead.current === controller) sessionRead.current = null;
        });
    };
    void refresh();
    window.addEventListener('agentdomain:session-changed', refresh);
    return () => {
      cancelled = true;
      sessionRead.current?.abort();
      sessionRead.current = null;
      window.removeEventListener('agentdomain:session-changed', refresh);
    };
  }, [address]);

  const signIn = useCallback(async (): Promise<boolean> => {
    if (activeOperation.current) return false;
    if (!isConnected || !address) {
      setError('Connect your wallet first');
      return false;
    }
    const controller = new AbortController();
    activeOperation.current = controller;
    sessionRead.current?.abort();
    setLoading(true);
    setError(null);

    try {
      // 1. Fetch nonce
      const { nonce } = await requestSiwe<{ nonce: string }>('nonce', {
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();

      // 2. Build SIWE message — SIWE 3.x requires EIP-55 checksummed address.
      const checksummedAddress = getAddress(address);
      const message = new SiweMessage({
        domain: window.location.host,
        address: checksummedAddress,
        statement: 'Sign in to AgentDomain to manage your agent identities.',
        uri: window.location.origin,
        version: '1',
        chainId,
        nonce,
        issuedAt: new Date().toISOString(),
      });

      const messageString = message.prepareMessage();

      // 3. Sign
      const signature = await signMessageAsync({
        account: checksummedAddress,
        message: messageString,
      });
      controller.signal.throwIfAborted();

      // 4. Verify
      const data = await requestSiwe<{ address: string; chainId: number }>('verify', {
        signal: controller.signal,
        body: JSON.stringify({ message: messageString, signature }),
      });
      controller.signal.throwIfAborted();
      setSession({
        authenticated: true,
        address: data.address,
        chainId: data.chainId,
      });
      window.dispatchEvent(new Event('agentdomain:session-changed'));
      return true;
    } catch (e) {
      if (!controller.signal.aborted) setError(formatWalletAuthError(e));
      return false;
    } finally {
      activeOperation.current = null;
      setLoading(false);
    }
  }, [address, chainId, isConnected, signMessageAsync]);

  const signOut = useCallback(async () => {
    if (activeOperation.current) return;
    const controller = new AbortController();
    activeOperation.current = controller;
    sessionRead.current?.abort();
    setLoading(true);
    setError(null);
    try {
      await requestSiwe('sign-out', {
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      setSession({ authenticated: false });
      window.dispatchEvent(new Event('agentdomain:session-changed'));
      try {
        await disconnectWalletConnections(config);
      } finally {
        clearWalletConnectionStorage();
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(formatWalletAuthError(e));
    } finally {
      activeOperation.current = null;
      setLoading(false);
    }
  }, [config]);

  return { session, loading, error, signIn, signOut };
}
