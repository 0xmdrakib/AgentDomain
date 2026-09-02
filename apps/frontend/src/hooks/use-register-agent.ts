'use client';

import { useState } from 'react';
import { useAccount, useWalletClient, useConfig } from 'wagmi';
import { getWalletClient } from 'wagmi/actions';
import { type Address } from 'viem';
import { USDC_DECIMALS } from '@agentdomain/shared';
import { createX402PaymentHeaders } from '@agentdomain/sdk';
import type { RegistrationParams, RegistrationResult } from '@agentdomain/shared';
import {
  BASE_MAINNET_CHAIN_ID,
  BaseChainRequiredError,
  isBaseChainMismatchError,
  isBaseChainRequiredError,
} from '@/lib/base-chain';
import { useBaseChainGuard } from '@/hooks/use-base-chain';
import { getTransactionErrorCopy, type TransactionRequestStage } from '@/lib/transaction-errors';

/**
 * Registration state lifecycle.
 */
export type RegistrationPhase =
  | 'idle'
  | 'preparing'
  | 'awaiting-signature'
  | 'submitting'
  | 'provisioning'
  | 'recovery'
  | 'success'
  | 'error';

export interface RegistrationState {
  phase: RegistrationPhase;
  message?: string;
  result?: RegistrationResult;
  error?: string;
  recovery?: RegistrationRecoveryResponse;
  walletReady?: boolean;
}

export interface RegistrationRecoveryResponse {
  error?: string;
  message?: string;
  domain?: string;
  registrationId?: string;
  paymentTxHash?: string | null;
  refundEligible?: boolean;
  progress?: unknown;
}

export class RegistrationRecoveryError extends Error {
  constructor(public readonly recovery: RegistrationRecoveryResponse) {
    super(
      recovery.message ??
        'Payment was accepted, but provisioning needs recovery. Do not pay again.',
    );
    this.name = 'RegistrationRecoveryError';
  }
}

export function isRegistrationRecoveryError(error: unknown): error is RegistrationRecoveryError {
  return error instanceof RegistrationRecoveryError;
}

/**
 * Hook that orchestrates the full agent registration flow from the browser:
 *   1. Confirm wallet connected + on right chain
 *   2. POST to /agents/register without payment → expect 402
 *   3. Create an official x402 v2 payment payload with the connected wallet
 *   4. Retry POST with PAYMENT-SIGNATURE
 *   5. Show provisioning result
 */
export function useRegisterAgent() {
  const { address } = useAccount();
  const config = useConfig();
  const { ensureBaseChain } = useBaseChainGuard();
  const {
    data: walletClient,
    isLoading: walletClientLoading,
    isFetching: walletClientFetching,
  } = useWalletClient();
  const [state, setState] = useState<RegistrationState>({ phase: 'idle', walletReady: false });
  const walletReady = Boolean(
    address &&
    walletClient?.account?.address?.toLowerCase() === address.toLowerCase() &&
    !walletClientLoading &&
    !walletClientFetching,
  );

  async function register(
    params: Omit<RegistrationParams, 'wallet'> & { turnstileToken?: string },
  ): Promise<RegistrationResult> {
    let requestStage: TransactionRequestStage = 'transaction';

    try {
      if (!address) {
        throw new Error('Connect your wallet before registering.');
      }

      setState({ phase: 'preparing', message: 'Preparing wallet...' });
      if (!(await ensureBaseChain())) {
        throw new BaseChainRequiredError();
      }

      const targetChainId = BASE_MAINNET_CHAIN_ID;
      const walletAddress = address as Address;
      let signingWalletClient = walletClient;
      const signerMatchesRequest =
        signingWalletClient?.account?.address?.toLowerCase() === walletAddress.toLowerCase() &&
        signingWalletClient.chain?.id === targetChainId;

      if (!signerMatchesRequest) {
        signingWalletClient = await getWalletClient(config, {
          account: walletAddress,
          chainId: targetChainId,
        });
      }

      if (!signingWalletClient?.account) {
        throw new Error('Wallet signer is not ready. Reconnect your wallet and try again.');
      }

      setState({ phase: 'preparing', message: 'Preparing registration...' });

      // 1. Initial call without payment - expect 402
      const apiUrl = '/api/v1';
      const initialRes = await fetch(`${apiUrl}/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, wallet: walletAddress }),
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

      // 2. Read the quoted amount for UI; the SDK validates the full challenge.
      const paymentRequired = (await initialRes.clone().json()) as {
        accepts?: Array<{ amount?: string }>;
      };
      const amountAtomic = paymentRequired.accepts?.[0]?.amount;
      if (!amountAtomic) {
        setState({ phase: 'error', error: 'Server returned 402 without payment requirement' });
        throw new Error('Missing payment requirement');
      }
      const turnstilePass = initialRes.headers.get('X-Turnstile-Pass');

      // 3. Build EIP-3009 transferWithAuthorization signature
      requestStage = 'signature';
      setState({
        phase: 'awaiting-signature',
        message: `Sign payment of $${formatUsdcAmount(amountAtomic)} USDC`,
      });
      const paymentHeaders = await createX402PaymentHeaders(initialRes, signingWalletClient);

      // 4. Retry with payment header
      requestStage = 'transaction';
      setState({ phase: 'submitting', message: 'Submitting payment...' });

      setState({ phase: 'provisioning', message: 'Provisioning your identity...' });

      const finalRes = await fetch(`${apiUrl}/agents/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...paymentHeaders,
          ...(turnstilePass ? { 'X-Turnstile-Pass': turnstilePass } : {}),
        },
        body: JSON.stringify({ ...omitTurnstileToken(params), wallet: walletAddress }),
      });

      if (finalRes.status === 202) {
        const recovery = ((await safeJson(finalRes)) ?? {}) as RegistrationRecoveryResponse;
        const message =
          recovery.message ??
          'Payment was accepted, but provisioning needs recovery. Do not pay again.';
        setState({ phase: 'recovery', error: message, recovery });
        throw new RegistrationRecoveryError({ ...recovery, message });
      }

      if (!finalRes.ok) {
        const errBody = await safeJson(finalRes);
        const errMsg = (errBody as { message?: string })?.message ?? `HTTP ${finalRes.status}`;
        setState({ phase: 'error', error: errMsg });
        throw new Error(errMsg);
      }

      const result = (await finalRes.json()) as RegistrationResult;
      setState({ phase: 'success', result });
      return result;
    } catch (error) {
      if (error instanceof RegistrationRecoveryError) {
        throw error;
      }
      if (isBaseChainRequiredError(error) || isBaseChainMismatchError(error)) {
        setState({ phase: 'idle' });
        throw new BaseChainRequiredError();
      }
      const copy = getTransactionErrorCopy(error, {
        action: 'Registration',
        stage: requestStage,
        fallback: 'Registration could not be completed. Please check your wallet and try again.',
      });
      if (copy.kind === 'cancelled') {
        setState({ phase: 'idle' });
      } else {
        setState({ phase: 'error', error: copy.description });
      }
      throw error;
    }
  }

  function reset() {
    setState({ phase: 'idle' });
  }

  return { state: { ...state, walletReady }, register, reset };
}

function omitTurnstileToken<T extends { turnstileToken?: string }>(params: T) {
  const sanitized = { ...params };
  delete sanitized.turnstileToken;
  return sanitized;
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
