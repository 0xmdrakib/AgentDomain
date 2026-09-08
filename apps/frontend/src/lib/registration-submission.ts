import { z } from 'zod';
import { formatUnits } from 'viem';
import { USDC_DECIMALS } from '@agentdomain/shared';
import {
  ATTEMPT_PREFIX,
  attemptStartedAt,
  readRegistrationSession,
  parsePaidRegistrationResponse,
  registrationAttemptSchema,
  registrationProgressSchema,
  registrationPaymentReferenceSchema,
  submitPaidRegistration,
  type RegistrationAccepted,
  type RegistrationAttempt,
  type RegistrationPaymentCompletion,
  type RegistrationPaymentRejection,
  type RegistrationProgress,
} from './registration-progress';
import { API_TIMEOUT_MS } from './transport-policy';

export const REGISTRATION_SUBMISSION_PREFIX = 'agentdomain:registration-submission:';
export const SUBMISSION_REVIEW_AFTER_MS = 120_000;
export const SUBMISSION_REQUEST_TIMEOUT_MS = API_TIMEOUT_MS;
export const SUBMISSION_UNCONFIRMED_MESSAGE =
  'Submission outcome is unconfirmed. Contact support to review this purchase; do not pay again.';

const reservationSchema = z
  .object({
    version: z.literal(1),
    wallet: z.string().regex(/^0x[0-9a-f]{40}$/),
    domain: z.string().min(1).max(253),
    clientId: z.string().regex(/^\d+-[a-zA-Z0-9-]+$/),
    phase: z.enum(['reserved', 'possibly_paid']),
    createdAt: z.number().int().nonnegative().safe(),
    submittedAt: z.number().int().nonnegative().safe().optional(),
    paymentReference: registrationPaymentReferenceSchema.optional(),
    reviewAfter: z.number().int().nonnegative().safe(),
  })
  .strict();
export type RegistrationSubmissionReservation = z.infer<typeof reservationSchema>;
export type SubmissionLock = <T>(key: string, operation: () => Promise<T>) => Promise<T>;
export type SubmissionErrorCode =
  | 'LOCKS_UNAVAILABLE'
  | 'CHECKOUT_BUSY'
  | 'EXISTING_SUBMISSION'
  | 'STORAGE_UNAVAILABLE'
  | 'PAYER_CHANGED'
  | 'TRACKING_UNAVAILABLE'
  | 'PREPARATION_FAILED'
  | 'PREPARATION_TIMEOUT'
  | 'INVALID_PAYMENT_REQUIREMENT'
  | 'SIGNATURE_CANCELLED'
  | 'SIGNATURE_FAILED';

export class RegistrationSubmissionError extends Error {
  constructor(readonly code: SubmissionErrorCode) {
    super(code);
    this.name = 'RegistrationSubmissionError';
  }
}

export interface RegistrationSubmissionDependencies {
  storage: Storage;
  lock?: SubmissionLock;
  fetcher?: typeof fetch;
  now?: () => number;
  randomId?: () => string;
  currentWallet(): string | null | undefined;
  refreshTracking(): Promise<boolean>;
  isTrackingReadyForPayer?(wallet: string): boolean;
  hasPurchase(wallet: string, domain: string): boolean;
  createPaymentHeaders(response: Response): Promise<Record<string, string>>;
  isSignatureCancellation(error: unknown): boolean;
  remember(attempt: RegistrationAttempt): void;
  accept(attempt: RegistrationAttempt, accepted: RegistrationAccepted | null): void;
  onPhase?(
    phase: 'preparing' | 'awaiting-signature' | 'processing',
    amount?: string,
    quoteExpiresAt?: string | number,
  ): void;
  onAttempt?(attempt: RegistrationAttempt): void;
}

export interface RegistrationTrackingOutcome {
  kind: 'tracking';
  attempt: RegistrationAttempt;
  accepted: RegistrationAccepted | null;
  reviewAfter: number;
}

export type RegistrationSubmissionOutcome =
  | RegistrationTrackingOutcome
  | {
      kind: 'rejected';
      attempt: RegistrationAttempt;
      rejection: RegistrationPaymentRejection;
      reservationReleased: boolean;
    }
  | { kind: 'completed'; attempt: RegistrationAttempt; completed: RegistrationPaymentCompletion };

export function formatRegistrationPaymentAmount(amount: string): string {
  return formatUnits(BigInt(amount), USDC_DECIMALS);
}

export function browserSubmissionLock(
  locks: Pick<LockManager, 'request'> | undefined,
): SubmissionLock | undefined {
  if (!locks) return undefined;
  return async (key, operation) =>
    await locks.request(key, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) throw new RegistrationSubmissionError('CHECKOUT_BUSY');
      return operation();
    });
}

function canonicalPayer(value: string): string {
  const wallet = value.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) throw new RegistrationSubmissionError('PAYER_CHANGED');
  return wallet;
}

function canonicalDomain(value: string): string {
  const domain = value.toLowerCase();
  if (
    domain.length > 253 ||
    domain.split('.').length < 2 ||
    !domain.split('.').every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
  ) {
    throw new RegistrationSubmissionError('PREPARATION_FAILED');
  }
  return domain;
}

export function submissionReservationKey(wallet: string, domain: string): string {
  return `${REGISTRATION_SUBMISSION_PREFIX}${canonicalPayer(wallet)}:${canonicalDomain(domain)}`;
}

export function readSubmissionReservation(
  storage: Storage,
  wallet: string,
  domain: string,
): RegistrationSubmissionReservation | null {
  try {
    const raw = storage.getItem(submissionReservationKey(wallet, domain));
    if (raw === null) return null;
    const result = reservationSchema.parse(JSON.parse(raw));
    if (
      result.wallet !== canonicalPayer(wallet) ||
      result.domain !== canonicalDomain(domain) ||
      (result.phase === 'possibly_paid'
        ? result.submittedAt === undefined || result.submittedAt < result.createdAt
        : result.submittedAt !== undefined) ||
      result.reviewAfter !== (result.submittedAt ?? result.createdAt) + SUBMISSION_REVIEW_AFTER_MS
    )
      throw new Error('Reservation mismatch');
    return result;
  } catch {
    throw new RegistrationSubmissionError('STORAGE_UNAVAILABLE');
  }
}

/** Fresh payer-authenticated rejection evidence must name this reservation's signed nonce. */
export async function releaseUnchargedSubmissionReservation(
  attempt: RegistrationAttempt,
  progress: RegistrationProgress,
  dependencies: {
    storage: Storage;
    lock?: SubmissionLock;
    currentWallet(): string | null | undefined;
    isCurrent(): boolean;
  },
): Promise<boolean> {
  try {
    const clean = registrationAttemptSchema.parse(attempt);
    const evidence = registrationProgressSchema.parse(progress);
    if (
      evidence.status !== 'failed' ||
      evidence.paymentStatus !== 'not_charged' ||
      evidence.messageCode !== 'PAYMENT_NOT_SUBMITTED' ||
      evidence.agentId !== null ||
      evidence.completedAt !== null ||
      evidence.completionEventId !== null ||
      evidence.domain !== clean.domain ||
      evidence.paymentReference === undefined
    )
      return false;
    const lock =
      dependencies.lock ??
      browserSubmissionLock(
        typeof window === 'undefined' || typeof navigator === 'undefined'
          ? undefined
          : navigator.locks,
      );
    if (!lock) return false;
    const { storage } = dependencies;
    const key = submissionReservationKey(clean.wallet, clean.domain);
    const attemptKey = `${ATTEMPT_PREFIX}${clean.clientId}`;
    const originalAttempt = storage.getItem(attemptKey);
    if (originalAttempt !== null) {
      const saved = registrationAttemptSchema.parse(JSON.parse(originalAttempt));
      if (
        saved.wallet !== clean.wallet ||
        saved.domain !== clean.domain ||
        saved.clientId !== clean.clientId
      )
        return false;
    }
    const original = storage.getItem(key);
    const reservation = readSubmissionReservation(storage, clean.wallet, clean.domain);
    if (
      !reservation ||
      reservation.clientId !== clean.clientId ||
      reservation.phase !== 'possibly_paid' ||
      reservation.paymentReference !== evidence.paymentReference
    )
      return false;
    const current = () =>
      dependencies.currentWallet()?.toLowerCase() === clean.wallet && dependencies.isCurrent();
    if (!current()) return false;
    return await lock(key, async () => {
      // Re-read after acquiring checkout's non-waiting lock: same-ID rewrites are successors too.
      if (
        !current() ||
        storage.getItem(attemptKey) !== originalAttempt ||
        storage.getItem(key) !== original
      )
        return false;
      const latest = readSubmissionReservation(storage, clean.wallet, clean.domain);
      if (
        !latest ||
        latest.paymentReference !== evidence.paymentReference ||
        latest.paymentReference !== reservation.paymentReference ||
        latest.clientId !== clean.clientId ||
        latest.phase !== 'possibly_paid' ||
        latest.createdAt !== reservation?.createdAt ||
        latest.submittedAt !== reservation?.submittedAt
      )
        return false;
      if (!current() || storage.getItem(key) !== original) return false;
      // Keep an operational guard if confirming deletion fails for an orphaned reservation.
      if (latest && originalAttempt === null) {
        const fallback = JSON.stringify(clean);
        storage.setItem(attemptKey, fallback);
        if (
          storage.getItem(attemptKey) !== fallback ||
          !current() ||
          storage.getItem(key) !== original
        )
          return false;
      }
      if (latest) storage.removeItem(key);
      return storage.getItem(key) === null;
    });
  } catch {
    // Missing/busy locks, replaced ownership and storage failures retain the purchase guard.
    return false;
  }
}

/** UI escalation only. Age is never proof of no payment and never authorizes deleting a reservation. */
export function submissionReviewRequired(
  attempt: RegistrationAttempt,
  storage: Storage,
  now = Date.now(),
): boolean {
  try {
    const reservation = readSubmissionReservation(storage, attempt.wallet, attempt.domain);
    if (reservation?.clientId === attempt.clientId) {
      return reservation.phase === 'possibly_paid' && now >= reservation.reviewAfter;
    }
    return now - attemptStartedAt(attempt) >= SUBMISSION_REVIEW_AFTER_MS;
  } catch {
    return true;
  }
}

function persistReservation(
  storage: Storage,
  reservation: RegistrationSubmissionReservation,
): void {
  try {
    const key = submissionReservationKey(reservation.wallet, reservation.domain);
    const value = JSON.stringify(reservationSchema.parse(reservation));
    storage.setItem(key, value);
    if (storage.getItem(key) !== value) throw new Error('Reservation did not persist');
  } catch {
    throw new RegistrationSubmissionError('STORAGE_UNAVAILABLE');
  }
}

function hasSavedAttempt(storage: Storage, wallet: string, domain: string): boolean {
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(ATTEMPT_PREFIX)) continue;
      let value: unknown;
      try {
        value = JSON.parse(storage.getItem(key) ?? 'null');
      } catch {
        continue;
      }
      const attempt = registrationAttemptSchema.safeParse(value);
      if (attempt.success && attempt.data.wallet === wallet && attempt.data.domain === domain)
        return true;
    }
    return false;
  } catch {
    throw new RegistrationSubmissionError('STORAGE_UNAVAILABLE');
  }
}

function clearUnsubmittedReservation(
  storage: Storage,
  reservation: RegistrationSubmissionReservation,
): void {
  // A lock holder may remove only its own provably untransmitted reservation, never a possibly-paid successor.
  const current = readSubmissionReservation(storage, reservation.wallet, reservation.domain);
  if (current?.clientId === reservation.clientId && current.phase === 'reserved') {
    storage.removeItem(submissionReservationKey(reservation.wallet, reservation.domain));
  }
}

function clearRejectedReservation(
  storage: Storage,
  reservation: RegistrationSubmissionReservation,
): boolean {
  const key = submissionReservationKey(reservation.wallet, reservation.domain);
  const current = readSubmissionReservation(storage, reservation.wallet, reservation.domain);
  if (
    current?.clientId !== reservation.clientId ||
    current.phase !== 'possibly_paid' ||
    current.createdAt !== reservation.createdAt ||
    current.submittedAt !== reservation.submittedAt
  )
    return false;
  storage.removeItem(key);
  return storage.getItem(key) === null;
}

async function prepareRegistration(body: object, fetcher: typeof fetch): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher('/api/v1/agents/register', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Prefer: 'respond-async' },
          body: JSON.stringify(body),
        });
        // Include response decoding in the deadline; do not leave a hung body stream holding the checkout lock.
        const content = await response.text();
        return new Response(content, { status: response.status, headers: response.headers });
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new RegistrationSubmissionError('PREPARATION_TIMEOUT'));
        }, SUBMISSION_REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Called only by an explicit checkout action. Browser coordination does not replace backend payment claims. */
export async function runRegistrationSubmission(
  input: {
    wallet: string;
    domain: string;
    body: object;
  },
  dependencies: RegistrationSubmissionDependencies,
): Promise<RegistrationSubmissionOutcome> {
  const wallet = canonicalPayer(input.wallet);
  const domain = canonicalDomain(input.domain);
  if (!dependencies.lock) throw new RegistrationSubmissionError('LOCKS_UNAVAILABLE');
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? Date.now;
  const body = JSON.parse(JSON.stringify({ ...input.body, wallet })) as Record<string, unknown>;
  if (`${body.preferredName}.${body.tld}`.toLowerCase() !== domain)
    throw new RegistrationSubmissionError('PREPARATION_FAILED');

  return dependencies.lock(submissionReservationKey(wallet, domain), async () => {
    const checkPayer = async () => {
      if (dependencies.currentWallet()?.toLowerCase() !== wallet)
        throw new RegistrationSubmissionError('PAYER_CHANGED');
      const session = await readRegistrationSession(fetcher);
      if (session.wallet !== wallet || dependencies.currentWallet()?.toLowerCase() !== wallet) {
        throw new RegistrationSubmissionError('PAYER_CHANGED');
      }
      return session;
    };
    const checkPurchase = () => {
      if (
        dependencies.hasPurchase(wallet, domain) ||
        hasSavedAttempt(dependencies.storage, wallet, domain)
      ) {
        throw new RegistrationSubmissionError('EXISTING_SUBMISSION');
      }
    };
    const prior = readSubmissionReservation(dependencies.storage, wallet, domain);
    if (prior?.phase === 'possibly_paid')
      throw new RegistrationSubmissionError('EXISTING_SUBMISSION');
    checkPurchase();
    // Acquiring the Web Lock proves a previous reserved-only owner's execution has ended.
    // Reclaiming that state still requires this fresh explicit user action; nothing is auto-submitted on reload.
    const session = await checkPayer();
    if (!(await dependencies.refreshTracking()) && !dependencies.isTrackingReadyForPayer?.(wallet))
      throw new RegistrationSubmissionError('TRACKING_UNAVAILABLE');
    checkPurchase();
    const createdAt = now();
    const attempt = registrationAttemptSchema.parse({
      wallet,
      domain,
      clientId: `${session.now}-${(dependencies.randomId ?? (() => crypto.randomUUID()))()}`,
    });
    const reservation: RegistrationSubmissionReservation = {
      ...attempt,
      version: 1,
      phase: 'reserved',
      createdAt,
      reviewAfter: createdAt + SUBMISSION_REVIEW_AFTER_MS,
    };
    persistReservation(dependencies.storage, reservation);
    let possiblyPaid = false;
    let paidReservation: RegistrationSubmissionReservation | null = null;
    let reviewAfter = reservation.reviewAfter;
    const markPossiblyPaid = (paymentReference?: string) => {
      possiblyPaid = true;
      const submittedAt = now();
      reviewAfter = submittedAt + SUBMISSION_REVIEW_AFTER_MS;
      paidReservation = {
        ...reservation,
        phase: 'possibly_paid',
        submittedAt,
        reviewAfter,
        ...(paymentReference ? { paymentReference } : {}),
      };
      persistReservation(dependencies.storage, paidReservation);
      dependencies.onAttempt?.(attempt);
      dependencies.onPhase?.('processing');
    };
    const outcome = (accepted: RegistrationAccepted | null): RegistrationSubmissionOutcome => {
      try {
        dependencies.remember(attempt);
      } catch {
        /* The durable possibly-paid reservation still prevents a duplicate after reload. */
      }
      try {
        dependencies.onAttempt?.(attempt);
      } catch {
        /* UI failure cannot establish that a payment was not sent. */
      }
      try {
        dependencies.accept(attempt, accepted);
      } catch {
        /* Never downgrade an uncertain transmission to unpaid. */
      }
      return { kind: 'tracking', attempt, accepted, reviewAfter };
    };
    try {
      dependencies.onPhase?.('preparing');
      const initial = await prepareRegistration(body, fetcher);
      if (initial.status !== 402) {
        if (!initial.ok) throw new RegistrationSubmissionError('PREPARATION_FAILED');
        const parsed = parsePaidRegistrationResponse(
          initial.status,
          await initial.json().catch(() => null),
        );
        if (
          !parsed ||
          !('domain' in parsed) ||
          parsed.domain !== domain ||
          (parsed.status !== 'completed' && parsed.status !== 'processing')
        )
          throw new RegistrationSubmissionError('PREPARATION_FAILED');
        markPossiblyPaid();
        if (parsed.status === 'completed') return { kind: 'completed', attempt, completed: parsed };
        return outcome(parsed);
      }
      const encodedRequirement = initial.headers.get('PAYMENT-REQUIRED');
      const requirement = (
        encodedRequirement ? JSON.parse(atob(encodedRequirement)) : await initial.clone().json()
      ) as {
        accepts?: Array<{
          amount?: unknown;
          extra?: { quoteExpiresAt?: unknown; requestBinding?: unknown };
        }>;
      };
      const amount = requirement.accepts?.[0]?.amount;
      if (
        requirement.accepts?.length !== 1 ||
        typeof amount !== 'string' ||
        !/^\d{1,78}$/.test(amount)
      )
        throw new RegistrationSubmissionError('INVALID_PAYMENT_REQUIREMENT');
      const expiresAt = requirement.accepts[0].extra?.quoteExpiresAt;
      const binding = requirement.accepts[0].extra?.requestBinding;
      const reference = registrationPaymentReferenceSchema.safeParse(binding);
      if (binding !== undefined && !reference.success)
        throw new RegistrationSubmissionError('INVALID_PAYMENT_REQUIREMENT');
      const quoteExpiresAt =
        typeof expiresAt === 'string' ||
        (typeof expiresAt === 'number' && Number.isFinite(expiresAt))
          ? expiresAt
          : undefined;
      await checkPayer();
      dependencies.onPhase?.('awaiting-signature', amount, quoteExpiresAt);
      let paymentHeaders: Record<string, string>;
      try {
        paymentHeaders = await dependencies.createPaymentHeaders(initial);
      } catch (error) {
        throw new RegistrationSubmissionError(
          dependencies.isSignatureCancellation(error) ? 'SIGNATURE_CANCELLED' : 'SIGNATURE_FAILED',
        );
      }
      await checkPayer();
      if (
        !(await dependencies.refreshTracking()) &&
        !dependencies.isTrackingReadyForPayer?.(wallet)
      )
        throw new RegistrationSubmissionError('TRACKING_UNAVAILABLE');
      await checkPayer();
      checkPurchase();
      const current = readSubmissionReservation(dependencies.storage, wallet, domain);
      if (current?.clientId !== reservation.clientId || current.phase !== 'reserved') {
        throw new RegistrationSubmissionError('EXISTING_SUBMISSION');
      }
      markPossiblyPaid(reference.success ? reference.data : undefined);
      const { turnstileToken: _turnstileToken, ...paidBody } = body;
      void _turnstileToken;
      const response = await submitPaidRegistration(
        paidBody,
        paymentHeaders,
        initial.headers.get('X-Turnstile-Pass'),
        fetcher,
      );
      if (response?.status === 'rejected') {
        let reservationReleased = false;
        try {
          reservationReleased = Boolean(
            paidReservation && clearRejectedReservation(dependencies.storage, paidReservation),
          );
        } catch {
          /* Preserve unreadable/local successor state without inventing payment uncertainty for this rejection. */
        }
        possiblyPaid = false;
        return { kind: 'rejected', attempt, rejection: response, reservationReleased };
      }
      if (response?.status === 'completed' && response.domain === domain)
        return { kind: 'completed', attempt, completed: response };
      return outcome(
        response?.status === 'processing' && response.domain === domain ? response : null,
      );
    } catch (error) {
      if (possiblyPaid) return outcome(null);
      try {
        clearUnsubmittedReservation(dependencies.storage, reservation);
      } catch {
        /* Failed cleanup remains fail-closed for later checkout. */
      }
      throw error;
    }
  });
}
