'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useWalletClient, useConfig } from 'wagmi';
import { getAccount, getWalletClient } from 'wagmi/actions';
import { type Address } from 'viem';
import { type RegistrationParams } from '@agentdomain/shared';
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
  formatRegistrationPaymentAmount,
  RegistrationSubmissionError,
  runRegistrationSubmission,
  SUBMISSION_UNCONFIRMED_MESSAGE,
} from '@/lib/registration-submission';

export interface RegistrationState {
  phase:
    | 'idle'
    | 'preparing'
    | 'awaiting-signature'
    | 'submitting'
    | 'processing'
    | 'action-required'
    | 'success'
    | 'error';
  message?: string;
  error?: string;
  result?: Pick<RegistrationProgress, 'domain' | 'agentId'>;
  payment?: { amountAtomic: string; amountUsdc: string; quoteExpiresAt?: string | number };
  paymentStatus?: RegistrationProgress['paymentStatus'];
  rejectionCode?: string;
  messageCode?: 'SUBMISSION_UNCONFIRMED';
}

function retryableUnchargedState(previous: RegistrationState): RegistrationState {
  return {
    ...previous,
    phase: 'error',
    paymentStatus: 'not_charged',
    rejectionCode: 'PAYMENT_NOT_SUBMITTED',
    error:
      'Payment was not submitted. This checkout was not charged. Check the price before trying again.',
    message: undefined,
    messageCode: undefined,
    payment: undefined,
    result: undefined,
  };
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
  const releasedRejection =
    attempt && attempt.wallet === address?.toLowerCase()
      ? tracker.getReleasedRejection?.(attempt)
      : undefined;
  const walletReady = Boolean(
    address &&
    walletClient?.account?.address?.toLowerCase() === address.toLowerCase() &&
    !isLoading &&
    !isFetching,
  );

  useEffect(() => {
    if (!releasedRejection) return;
    setAttempt(null);
    setReviewAfter(null);
    setState(retryableUnchargedState);
  }, [releasedRejection]);

  useEffect(() => {
    if (
      !attempt ||
      progress ||
      accepted ||
      releasedRejection ||
      reviewAfter === null ||
      attempt.wallet !== address?.toLowerCase()
    )
      return;
    const timer = window.setTimeout(
      () =>
        setState((previous) => ({
          ...previous,
          phase: 'action-required',
          messageCode: 'SUBMISSION_UNCONFIRMED',
          message: SUBMISSION_UNCONFIRMED_MESSAGE,
        })),
      Math.max(0, reviewAfter - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [attempt, progress, accepted, releasedRejection, reviewAfter, address]);

  async function register(
    params: Omit<RegistrationParams, 'wallet'> & { turnstileToken?: string },
  ): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!address) throw new Error('Wallet required');
      setAttempt(null);
      setReviewAfter(null);
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
          onPhase: (phase, amount, quoteExpiresAt) =>
            setState((previous) => ({
              phase: phase === 'processing' ? 'submitting' : phase,
              payment:
                amount === undefined
                  ? previous.payment
                  : {
                      amountAtomic: amount,
                      amountUsdc: formatRegistrationPaymentAmount(amount),
                      quoteExpiresAt,
                    },
              paymentStatus: 'pending',
              message:
                phase === 'awaiting-signature'
                  ? `Sign payment of ${formatRegistrationPaymentAmount(amount!)} USDC`
                  : phase === 'processing'
                    ? 'Submitting signed payment. Settlement is not yet confirmed.'
                    : undefined,
            })),
        },
      );
      if (result.kind === 'rejected') {
        setAttempt(null);
        setReviewAfter(null);
        setState((previous) => ({
          ...previous,
          phase: result.reservationReleased ? 'error' : 'action-required',
          paymentStatus: 'not_charged',
          rejectionCode: result.rejection.code,
          error: `${result.rejection.message} No settlement was attempted. Review the quote before starting a new checkout.`,
          message: result.reservationReleased
            ? undefined
            : 'This payment submission was rejected without settlement. A checkout reservation remains on this device and needs review before another payment.',
        }));
        return;
      }
      if (result.kind === 'completed') {
        setReviewAfter(null);
        setState((previous) => ({
          ...previous,
          phase: 'success',
          result: result.completed,
          paymentStatus: 'settled',
        }));
        void tracker.refresh().catch(() => {
          /* A failed background read cannot undo a validated completed response. */
        });
        return;
      }
      setReviewAfter(result.reviewAfter);
      setState((previous) => ({
        ...previous,
        phase: 'processing',
        paymentStatus: result.accepted ? 'settled' : 'pending',
      }));
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
        : code === 'QUOTE_REFRESH_REQUIRED'
          ? 'The quote needs refreshing before submission. Check the price again; no payment request was sent.'
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

  const visibleState: RegistrationState =
    operationWallet && operationWallet !== address?.toLowerCase()
      ? { phase: 'idle' as const }
      : releasedRejection
        ? retryableUnchargedState(state)
        : progress?.status === 'completed'
          ? {
              ...state,
              phase: 'success' as const,
              result: progress,
              paymentStatus: 'settled' as const,
            }
          : {
              ...state,
              paymentStatus:
                progress &&
                progress.paymentStatus !== 'unknown' &&
                progress.paymentStatus !== 'pending'
                  ? progress.paymentStatus
                  : accepted
                    ? 'settled'
                    : state.paymentStatus,
            };

  return {
    state: {
      ...visibleState,
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
