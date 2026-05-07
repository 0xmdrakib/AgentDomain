'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useChainId, useSignMessage, useDisconnect } from 'wagmi';
import { SiweMessage } from 'siwe';
import { getAddress } from 'viem';

export interface SiweSession {
  authenticated: boolean;
  address?: string;
  chainId?: number;
  expiresAt?: number;
  isAdmin?: boolean;
}

export interface UseSiweReturn {
  session: SiweSession;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
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
  const { disconnect } = useDisconnect();

  const [session, setSession] = useState<SiweSession>({ authenticated: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh session on mount + whenever wallet changes
  useEffect(() => {
    setError(null);
    if (!address) {
      setSession({ authenticated: false });
      return;
    }

    let cancelled = false;
    fetch('/api/v1/auth/session', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const nextSession = data as SiweSession;
        if (
          nextSession.authenticated &&
          nextSession.address &&
          nextSession.address.toLowerCase() !== address.toLowerCase()
        ) {
          setSession({ authenticated: false });
          return;
        }
        setSession(data as SiweSession);
      })
      .catch(() => {
        if (!cancelled) setSession({ authenticated: false });
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const signIn = useCallback(async () => {
    if (!isConnected || !address) {
      setError('Connect your wallet first');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      // 1. Fetch nonce
      const nonceRes = await fetch('/api/v1/auth/nonce', { credentials: 'include' });
      if (!nonceRes.ok) throw new Error('Failed to get nonce');
      const { nonce } = (await nonceRes.json()) as { nonce: string };

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
      const signature = await signMessageAsync({ message: messageString });

      // 4. Verify
      const verifyRes = await fetch('/api/v1/auth/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageString, signature }),
      });

      if (!verifyRes.ok) {
        const body = (await verifyRes.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(body.message ?? body.error ?? `Verification failed (${verifyRes.status})`);
      }

      const data = (await verifyRes.json()) as { address: string; chainId: number };
      setSession({
        authenticated: true,
        address: data.address,
        chainId: data.chainId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  }, [address, chainId, isConnected, signMessageAsync]);

  const signOut = useCallback(async () => {
    setLoading(true);
    try {
      await fetch('/api/v1/auth/session', {
        method: 'DELETE',
        credentials: 'include',
      });
      setSession({ authenticated: false });
      disconnect();
    } finally {
      setLoading(false);
    }
  }, [disconnect]);

  return { session, loading, error, signIn, signOut };
}
