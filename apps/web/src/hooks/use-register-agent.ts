'use client';

import { useState } from 'react';
import { useAccount, usePublicClient, useWalletClient, useChainId } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { type Address, type Hex, parseUnits } from 'viem';
import { USDC_BASE, USDC_BASE_SEPOLIA, USDC_DECIMALS } from '@agentdomain/shared';
import type { RegistrationParams, RegistrationResult } from '@agentdomain/shared';

/**
 * Registration state lifecycle.
 */
export type RegistrationPhase =
  | 'idle'
  | 'preparing'
  | 'awaiting-signature'
  | 'submitting'
  | 'provisioning'
  | 'success'
  | 'error';

export interface RegistrationState {
  phase: RegistrationPhase;
  message?: string;
  result?: RegistrationResult;
  error?: string;
}

/**
 * Hook that orchestrates the full agent registration flow from the browser:
 *   1. Confirm wallet connected + on right chain
 *   2. POST to /agents/register without payment → expect 402
 *   3. Build EIP-3009 signed payment payload using walletClient.signTypedData
 *   4. Retry POST with X-Payment header
 *   5. Show provisioning result
 */
export function useRegisterAgent() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [state, setState] = useState<RegistrationState>({ phase: 'idle' });

  async function register(
    params: Omit<RegistrationParams, 'wallet'> & { turnstileToken?: string; discountCode?: string },
  ): Promise<RegistrationResult> {
    if (!address || !walletClient || !publicClient) {
      throw new Error('Wallet not connected');
    }

    const isMainnet = chainId === base.id;
    const network = isMainnet ? 'base' : 'base-sepolia';
    const usdcAddress = isMainnet ? USDC_BASE : USDC_BASE_SEPOLIA;

    setState({ phase: 'preparing', message: 'Preparing registration...' });

    // 1. Initial call without payment - expect 402
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';
    const initialRes = await fetch(`${apiUrl}/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, wallet: address }),
    });

    if (initialRes.status !== 402) {
      // Either succeeded immediately (shouldn't happen) or errored
      if (!initialRes.ok) {
        const errBody = await safeJson(initialRes);
        const errMsg = (errBody as { message?: string })?.message ?? `HTTP ${initialRes.status}`;
        setState({ phase: 'error', error: errMsg });
        throw new Error(errMsg);
      }
      const result = (await initialRes.json()) as RegistrationResult;
      setState({ phase: 'success', result });
      return result;
    }

    // 2. Parse the x402 challenge
    const challengeHeader = initialRes.headers.get('X-Payment-Required');
    let challenge: Challenge | undefined;
    if (challengeHeader) {
      challenge = JSON.parse(challengeHeader) as Challenge;
    } else {
      const body = (await initialRes.json()) as { accepts?: Challenge[] };
      challenge = body.accepts?.[0];
    }
    if (!challenge) {
      setState({ phase: 'error', error: 'Server returned 402 without payment requirement' });
      throw new Error('Missing payment requirement');
    }

    // 3. Build EIP-3009 transferWithAuthorization signature
    setState({
      phase: 'awaiting-signature',
      message: `Sign payment of $${formatUsdcAmount(challenge.maxAmountRequired)} USDC`,
    });

    const validAfter = 0n;
    const validBefore = BigInt(
      Math.floor(Date.now() / 1000) + (challenge.maxTimeoutSeconds ?? 300),
    );
    const nonce = randomNonceHex();
    const targetChainId = network === 'base' ? base.id : baseSepolia.id;

    const signature = await walletClient.signTypedData({
      account: address,
      domain: {
        name: 'USD Coin',
        version: '2',
        chainId: targetChainId,
        verifyingContract: usdcAddress,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: address,
        to: challenge.payTo,
        value: BigInt(challenge.maxAmountRequired),
        validAfter,
        validBefore,
        nonce,
      },
    });

    // 4. Retry with payment header
    setState({ phase: 'submitting', message: 'Submitting payment...' });

    const paymentPayload = {
      x402Version: 1,
      scheme: 'exact',
      network,
      payload: {
        signature,
        authorization: {
          from: address,
          to: challenge.payTo,
          value: challenge.maxAmountRequired,
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
          nonce,
        },
      },
    };

    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(paymentPayload))));

    setState({ phase: 'provisioning', message: 'Provisioning your identity...' });

    const finalRes = await fetch(`${apiUrl}/agents/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment': encoded,
      },
      body: JSON.stringify({ ...omitTurnstileToken(params), wallet: address }),
    });

    if (!finalRes.ok) {
      const errBody = await safeJson(finalRes);
      const errMsg = (errBody as { message?: string })?.message ?? `HTTP ${finalRes.status}`;
      setState({ phase: 'error', error: errMsg });
      throw new Error(errMsg);
    }

    const result = (await finalRes.json()) as RegistrationResult;
    setState({ phase: 'success', result });
    return result;
  }

  function reset() {
    setState({ phase: 'idle' });
  }

  return { state, register, reset };
}

function omitTurnstileToken<T extends { turnstileToken?: string }>(params: T) {
  const { turnstileToken: _turnstileToken, ...rest } = params;
  return rest;
}

interface Challenge {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  payTo: Address;
  asset: Address;
  maxTimeoutSeconds?: number;
}

function randomNonceHex(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ('0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')) as Hex;
}

function formatUsdcAmount(atomic: string): string {
  try {
    const n = Number(atomic) / 10 ** USDC_DECIMALS;
    return n.toFixed(2);
  } catch {
    return atomic;
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
