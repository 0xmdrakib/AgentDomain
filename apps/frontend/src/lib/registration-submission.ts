import { z } from 'zod';
import {
  ATTEMPT_PREFIX,
  attemptStartedAt,
  readRegistrationSession,
  registrationAcceptedSchema,
  registrationAttemptSchema,
  submitPaidRegistration,
  type RegistrationAccepted,
  type RegistrationAttempt,
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
  onPhase?(phase: 'preparing' | 'awaiting-signature' | 'processing', amount?: string): void;
  onAttempt?(attempt: RegistrationAttempt): void;
}

export interface RegistrationSubmissionOutcome {
  kind: 'tracking';
  attempt: RegistrationAttempt;
  accepted: RegistrationAccepted | null;
  reviewAfter: number;
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
    let reviewAfter = reservation.reviewAfter;
    const markPossiblyPaid = () => {
      possiblyPaid = true;
      const submittedAt = now();
      reviewAfter = submittedAt + SUBMISSION_REVIEW_AFTER_MS;
      persistReservation(dependencies.storage, {
        ...reservation,
        phase: 'possibly_paid',
        submittedAt,
        reviewAfter,
      });
      dependencies.remember(attempt);
      dependencies.onAttempt?.(attempt);
      dependencies.onPhase?.('processing');
    };
    const outcome = (accepted: RegistrationAccepted | null): RegistrationSubmissionOutcome => {
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
        const parsed = registrationAcceptedSchema.safeParse(await initial.json().catch(() => null));
        markPossiblyPaid();
        return outcome(parsed.success && parsed.data.domain === domain ? parsed.data : null);
      }
      const requirement = (await initial.clone().json()) as {
        accepts?: Array<{ amount?: unknown }>;
      };
      const amount = requirement.accepts?.[0]?.amount;
      if (typeof amount !== 'string' || !/^\d{1,78}$/.test(amount))
        throw new RegistrationSubmissionError('INVALID_PAYMENT_REQUIREMENT');
      await checkPayer();
      dependencies.onPhase?.('awaiting-signature', amount);
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
      markPossiblyPaid();
      const { turnstileToken: _turnstileToken, ...paidBody } = body;
      void _turnstileToken;
      const accepted = await submitPaidRegistration(
        paidBody,
        paymentHeaders,
        initial.headers.get('X-Turnstile-Pass'),
        fetcher,
      );
      return outcome(accepted?.domain === domain ? accepted : null);
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
