'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useWalletClient, useConfig } from 'wagmi';
import { getAccount, getWalletClient } from 'wagmi/actions';
import { type Address } from 'viem';
import { USDC_DECIMALS, type RegistrationParams } from '@agentdomain/shared';
import { createX402PaymentHeaders } from '@agentdomain/sdk';
import {
  BASE_MAINNET_CHAIN_ID,
  BaseChainRequiredError,
  isBaseChainMismatchError,
  isBaseChainRequiredError,
} from '@/lib/base-chain';
import { useBaseChainGuard } from '@/hooks/use-base-chain';
import { getTransactionErrorCopy } from '@/lib/transaction-errors';
import {
  useRegistrationSnapshot,
  useRegistrationTracker,
} from '@/components/register/registration-tracker-provider';
import { type RegistrationAttempt, type RegistrationProgress } from '@/lib/registration-progress';
import {
  browserSubmissionLock,
  RegistrationSubmissionError,
  runRegistrationSubmission,
  SUBMISSION_UNCONFIRMED_MESSAGE,
} from '@/lib/registration-submission';

export interface RegistrationState {
  phase:
    | 'idle'
    | 'preparing'
    | 'awaiting-signature'
    | 'processing'
    | 'action-required'
    | 'success'
    | 'error';
  message?: string;
  error?: string;
  result?: RegistrationProgress;
  messageCode?: 'SUBMISSION_UNCONFIRMED';
}

export function useRegisterAgent() {
  const { address } = useAccount();
  const config = useConfig();
  const { ensureBaseChain } = useBaseChainGuard();
  const { data: walletClient, isLoading, isFetching } = useWalletClient();
  const tracker = useRegistrationTracker();
  useRegistrationSnapshot();
  const busy = useRef(false);
  const [state, setState] = useState<RegistrationState>({ phase: 'idle' });
  const [attempt, setAttempt] = useState<RegistrationAttempt | null>(null);
  const [operationWallet, setOperationWallet] = useState<string | null>(null);
  const [reviewAfter, setReviewAfter] = useState<number | null>(null);
  const progress =
    attempt && attempt.wallet === address?.toLowerCase() ? tracker.matches(attempt) : undefined;
  const accepted =
    attempt && attempt.wallet === address?.toLowerCase()
      ? tracker.getAcceptance(attempt)
      : undefined;
  const walletReady = Boolean(
    address &&
    walletClient?.account?.address?.toLowerCase() === address.toLowerCase() &&
    !isLoading &&
    !isFetching,
  );

  useEffect(() => {
    if (
      !attempt ||
      progress ||
      accepted ||
      reviewAfter === null ||
      attempt.wallet !== address?.toLowerCase()
    )
      return;
    const timer = window.setTimeout(
      () =>
        setState({
          phase: 'action-required',
          messageCode: 'SUBMISSION_UNCONFIRMED',
          message: SUBMISSION_UNCONFIRMED_MESSAGE,
        }),
      Math.max(0, reviewAfter - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [attempt, progress, accepted, reviewAfter, address]);

  async function register(
    params: Omit<RegistrationParams, 'wallet'> & { turnstileToken?: string },
  ): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!address) throw new Error('Wallet required');
      setOperationWallet(address.toLowerCase());
      setState({ phase: 'preparing', message: 'Checking wallet and sign-in...' });
      if (!(await ensureBaseChain())) throw new BaseChainRequiredError();
      const walletAddress = address as Address;
      const domain = `${params.preferredName}.${params.tld}`.toLowerCase();
      const result = await runRegistrationSubmission(
        { wallet: walletAddress, domain, body: params },
        {
          storage: window.localStorage,
          lock: browserSubmissionLock(navigator.locks),
          currentWallet: () => getAccount(config).address,
          refreshTracking: () => tracker.refresh(),
          isTrackingReadyForPayer: (wallet) => tracker.isReadyForPayer(wallet),
          hasPurchase: (wallet, target) => tracker.hasPurchase(wallet, target),
          createPaymentHeaders: async (response) => {
            const client = await getWalletClient(config, {
              account: walletAddress,
              chainId: BASE_MAINNET_CHAIN_ID,
            });
            if (
              getAccount(config).address?.toLowerCase() !== walletAddress.toLowerCase() ||
              client.account.address.toLowerCase() !== walletAddress.toLowerCase()
            ) {
              throw new RegistrationSubmissionError('PAYER_CHANGED');
            }
            return createX402PaymentHeaders(response, client);
          },
          isSignatureCancellation: (error) =>
            getTransactionErrorCopy(error, {
              action: 'Registration',
              stage: 'signature',
              fallback: '',
            }).kind === 'cancelled',
          remember: (pending) => tracker.remember(pending),
          accept: (pending, accepted) => tracker.accept(pending, accepted),
          onAttempt: setAttempt,
          onPhase: (phase, amount) =>
            setState({
              phase,
              message:
                phase === 'awaiting-signature'
                  ? `Sign payment of $${(Number(amount) / 10 ** USDC_DECIMALS).toFixed(2)} USDC`
                  : undefined,
            }),
        },
      );
      setReviewAfter(result.reviewAfter);
      setState({ phase: 'processing' });
    } catch (error) {
      if (isBaseChainRequiredError(error) || isBaseChainMismatchError(error)) {
        setState({ phase: 'idle' });
        throw new BaseChainRequiredError();
      }
      const code = error instanceof RegistrationSubmissionError ? error.code : null;
      const cancelled = code === 'SIGNATURE_CANCELLED';
      if (code === 'EXISTING_SUBMISSION') {
        setState({
          phase: 'action-required',
          message:
            'A prior submission is being tracked. Review registration updates; do not pay again.',
        });
        return;
      }
      const message = cancelled
        ? 'Payment signature cancelled. No payment request was submitted.'
        : code === 'LOCKS_UNAVAILABLE'
          ? 'This browser cannot safely coordinate checkout across tabs. Web Locks support is required; no payment was submitted.'
          : code === 'CHECKOUT_BUSY'
            ? 'Checkout is already open in another tab for this payer and domain. Continue there; no new payment was submitted.'
            : code === 'PREPARATION_TIMEOUT'
              ? 'Checkout preparation timed out before payment signing. No payment was submitted.'
              : 'Checkout was not submitted. Confirm your payer sign-in and connection, then check registration updates before continuing.';
      setState(cancelled ? { phase: 'idle', message } : { phase: 'error', error: message });
      if (cancelled) return;
      throw new Error(message);
    } finally {
      busy.current = false;
    }
  }

  return {
    state: {
      ...(operationWallet && operationWallet !== address?.toLowerCase()
        ? { phase: 'idle' as const }
        : progress?.status === 'completed'
          ? { phase: 'success' as const, result: progress }
          : state),
      walletReady,
    },
    register,
    reset: () => {
      setAttempt(null);
      setOperationWallet(null);
      setReviewAfter(null);
      setState({ phase: 'idle' });
    },
  };
}
