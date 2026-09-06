import { z } from 'zod';
import { API_TIMEOUT_MS } from './transport-policy';

export const REGISTRATION_POLL_MS = 5_000;
export const REGISTRATION_MAX_POLL_MS = 300_000;
export const REGISTRATION_RETRY_JITTER_MS = 1_000;
export const REGISTRATION_BACKOFF_PREFIX = 'agentdomain:registration-read-backoff:';
export const REGISTRATION_PAGE_SIZE = 20;
// At most 48 status reads/minute/tab, including focus/storage triggers: two tabs stay below120.
// More tabs use shared payer-scoped 429 cooldowns; this is not a cross-tab rate-limit guarantee.
export const REGISTRATION_LIST_PAGES_PER_POLL = 2;
export const REGISTRATION_DETAILS_PER_POLL = 2;
export const REGISTRATION_MAX_DISCOVERY_OFFSET = 10_000;
export const REGISTRATION_CHANGED_EVENT = 'agentdomain:registration-completed';
export const ATTEMPT_PREFIX = 'agentdomain:registration-attempt:';
export const COMPLETION_PREFIX = 'agentdomain:registration-completed:';
export const REGISTRATION_NOTICE_PREFIX = 'agentdomain:registration-notice-dismissed:';

const identifier = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const domain = z.string().regex(/^[a-z0-9.-]+$/);
const wallet = z
  .string()
  .regex(/^0x[\da-fA-F]{40}$/)
  .transform((value) => value.toLowerCase());
const date = z.string().datetime({ offset: true });
const statusUrl = z.string().regex(/^\/api\/v1\/registrations\/[a-zA-Z0-9_-]+$/);
const paymentStatus = z.enum(['unknown', 'pending', 'settled', 'not_charged', 'refunded']);

// Project only the public contract. Unknown provider fields never enter view state.
export const registrationProgressSchema = z
  .object({
    registrationId: identifier,
    status: z.enum([
      'processing',
      'completed',
      'action_required',
      'failed',
      'refunded',
      'awaiting_payment',
    ]),
    statusUrl,
    domain,
    agentId: identifier.nullable(),
    paymentStatus,
    stage: z.enum([
      'payment',
      'domain',
      'dns',
      'ssl',
      'email',
      'basename',
      'ens',
      'mint',
      'finalizing',
      'complete',
    ]),
    messageCode: z.string(),
    startedAt: date,
    updatedAt: date,
    completedAt: date.nullable(),
    revision: z.number().int().nonnegative(),
    estimatedDurationSeconds: z.number().finite().nonnegative().nullable(),
    pollAfterSeconds: z
      .number()
      .finite()
      .positive()
      .transform((value) =>
        Math.min(REGISTRATION_MAX_POLL_MS / 1000, Math.max(REGISTRATION_POLL_MS / 1000, value)),
      ),
    completionEventId: z.string().min(1).nullable(),
  })
  .refine((value) => value.statusUrl === registrationPath(value.registrationId))
  .refine((value) => Date.parse(value.updatedAt) >= Date.parse(value.startedAt))
  .refine(
    (value) =>
      value.completedAt === null ||
      (Date.parse(value.completedAt) >= Date.parse(value.startedAt) &&
        Date.parse(value.completedAt) <= Date.parse(value.updatedAt)),
  )
  .refine(
    (value) =>
      value.status !== 'completed' ||
      (value.agentId !== null && value.paymentStatus === 'settled' && value.stage === 'complete'),
  )
  .refine((value) => value.status !== 'refunded' || value.paymentStatus === 'refunded');

export const registrationAcceptedSchema = z
  .object({
    registrationId: identifier,
    status: z.literal('processing'),
    statusUrl,
    domain,
    paymentStatus: z.literal('settled'),
    pollAfterSeconds: z.literal(5),
  })
  .refine((value) => value.statusUrl === registrationPath(value.registrationId));

export const registrationListSchema = z.object({
  items: z.array(registrationProgressSchema),
  hasMore: z.boolean(),
  total: z.number().int().nonnegative(),
});

export type RegistrationProgress = z.infer<typeof registrationProgressSchema>;
export type RegistrationAccepted = z.infer<typeof registrationAcceptedSchema>;

export const registrationAttemptSchema = z
  .object({
    wallet,
    domain,
    // The timestamp is part of the client ID; storage contains only these three fields.
    clientId: z.string().regex(/^\d+-[a-zA-Z0-9-]+$/),
  })
  .strict();
export type RegistrationAttempt = z.infer<typeof registrationAttemptSchema>;

export function registrationPath(id: string) {
  return `/api/v1/registrations/${encodeURIComponent(id)}`;
}

export function attemptStartedAt(attempt: RegistrationAttempt) {
  return Number(attempt.clientId.split('-')[0]);
}

export function matchAttempt(attempt: RegistrationAttempt, items: RegistrationProgress[]) {
  const matches = items.filter(
    (item) =>
      item.domain === attempt.domain && Date.parse(item.startedAt) >= attemptStartedAt(attempt),
  );
  // Ambiguity is not permission to attach an unrelated purchase or pay again.
  return matches.length === 1 ? matches[0] : undefined;
}

export function isRegistrationTerminal(item: RegistrationProgress) {
  return ['completed', 'refunded'].includes(item.status);
}

export function canAdvanceRegistration(previous: RegistrationProgress, next: RegistrationProgress) {
  if (
    previous.registrationId !== next.registrationId ||
    previous.domain !== next.domain ||
    Date.parse(previous.startedAt) !== Date.parse(next.startedAt) ||
    next.revision < previous.revision
  )
    return false;
  const before = Date.parse(previous.updatedAt);
  const after = Date.parse(next.updatedAt);
  if (!Number.isFinite(after) || after < before) return false;
  if (
    previous.completionEventId &&
    next.completionEventId &&
    previous.completionEventId !== next.completionEventId
  )
    return false;
  if (isRegistrationTerminal(previous) && next.status !== previous.status) {
    if (after <= before || (next.status !== 'refunded' && next.status !== 'action_required'))
      return false;
    if (previous.status === 'refunded' && next.paymentStatus !== 'refunded') return false;
  }
  return (
    next.revision > previous.revision ||
    after > before ||
    // Legacy status projection can recover recorded settlement without changing stored timestamps.
    (((previous.status === 'action_required' &&
      previous.paymentStatus === 'unknown' &&
      previous.stage === 'payment') ||
      (previous.status === 'processing' &&
        previous.paymentStatus === 'settled' &&
        previous.stage === 'finalizing' &&
        previous.messageCode === 'REGISTRATION_PROCESSING' &&
        previous.agentId !== null &&
        previous.revision === 0 &&
        previous.completedAt === null &&
        previous.completionEventId === null)) &&
      next.status === 'completed' &&
      next.paymentStatus === 'settled' &&
      next.stage === 'complete' &&
      next.agentId !== null &&
      (previous.agentId === null || previous.agentId === next.agentId)) ||
    JSON.stringify(previous) === JSON.stringify(next)
  );
}

export function registrationStageLabel(stage: RegistrationProgress['stage']) {
  const labels: Record<RegistrationProgress['stage'], string> = {
    payment: 'Payment',
    domain: 'Domain registration',
    dns: 'DNS setup',
    ssl: 'HTTPS setup',
    email: 'Email setup',
    basename: 'Basename registration',
    ens: 'ENS registration',
    mint: 'Onchain identity',
    finalizing: 'Final checks',
    complete: 'Complete',
  };
  return labels[stage];
}

export function registrationPaymentStatus(
  item?: RegistrationProgress,
  accepted?: RegistrationAccepted,
) {
  const observed = item?.paymentStatus;
  return accepted && (observed == null || observed === 'unknown' || observed === 'pending')
    ? 'settled'
    : (observed ?? 'unknown');
}

export function registrationNoticeEligible(
  item?: RegistrationProgress,
  accepted?: RegistrationAccepted,
) {
  // Unknown server history is not evidence of an active checkout. Keep it on the dashboard.
  return !item || registrationPaymentStatus(item, accepted) !== 'unknown';
}

export function registrationCopy(item?: RegistrationProgress, accepted?: RegistrationAccepted) {
  if (!item)
    return accepted
      ? 'Payment confirmed. Registration is processing.'
      : 'Confirming payment and registration status. Do not pay again.';
  if (item.status === 'completed') return 'Registration complete';
  if (item.status === 'refunded') return 'Payment refunded';
  if (registrationPaymentStatus(item, accepted) === 'unknown')
    return 'Registration status needs verification. Do not pay again.';
  if (item.status === 'failed')
    return 'Registration could not be completed. Review payment status below.';
  const confirmed = registrationPaymentStatus(item, accepted) === 'settled';
  const stages: Record<RegistrationProgress['stage'], string> = {
    payment: confirmed ? 'Payment confirmed. Registration is processing.' : 'Confirming payment',
    domain: 'Registering domain',
    dns: 'Setting up DNS',
    ssl: 'Preparing HTTPS',
    email: 'Setting up email',
    basename: 'Registering Basename',
    ens: 'Registering ENS',
    mint: 'Creating onchain identity',
    finalizing: 'Finalizing registration',
    complete: 'Confirming completion',
  };
  const messages: Record<string, string> = {
    REGISTRATION_QUEUED: 'Registration queued',
    REGISTRATION_PROCESSING: stages[item.stage],
    REGISTRATION_RETRY_SCHEDULED: 'Registration is processing. Another check is scheduled.',
    DNS_PROPAGATION_PENDING: 'Waiting for DNS propagation',
    SSL_VALIDATION_PENDING: 'Waiting for HTTPS validation',
    EMAIL_VERIFICATION_PENDING: 'Waiting for email verification',
    REGISTRATION_REVIEW_REQUIRED: 'Registration needs review. Do not pay again.',
    PAYMENT_PENDING: confirmed ? stages[item.stage] : 'Confirming payment. Do not pay again.',
    PAYMENT_CONFIRMATION_REQUIRED: confirmed
      ? stages[item.stage]
      : 'Checking payment confirmation. Do not pay again.',
  };
  // Completion/refund codes alone never override the authoritative status.
  return Object.hasOwn(messages, item.messageCode)
    ? messages[item.messageCode]
    : 'Registration is processing. Checking for an update.';
}

export function durationLabel(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return minutes < 60
    ? `${minutes}m ${Math.floor(Math.max(0, seconds) % 60)}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function registrationEstimateCopy(estimate?: number | null, elapsed?: number | null) {
  if (estimate == null) return 'Timing varies; no estimate available.';
  return `Estimated setup: about ${durationLabel(estimate)}. Timing varies.${elapsed != null && elapsed > estimate ? ' Taking longer than estimated.' : ''}`;
}

export class RegistrationReadError extends Error {
  constructor(
    public readonly kind: 'unauthorized' | 'unavailable',
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(
      kind === 'unauthorized'
        ? 'Sign in with the paying wallet to continue.'
        : 'Registration updates are temporarily unavailable.',
    );
  }
}

export function registrationRetryAfterMs(
  value: string | null,
  now = Date.now(),
  serverDate?: string | null,
): number | undefined {
  if (!value?.trim()) return undefined;
  const text = value.trim();
  const seconds = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
  if (Number.isFinite(seconds))
    return Math.min(Number.MAX_SAFE_INTEGER - now, Math.ceil(seconds * 1000));
  const target = /^[A-Za-z]{3},/.test(text) ? Date.parse(text) : NaN;
  const serverNow = Date.parse(serverDate ?? '');
  return Number.isFinite(target)
    ? Math.max(0, target - (Number.isFinite(serverNow) ? serverNow : now))
    : undefined;
}

export async function registrationRead(
  path: string,
  fetcher = fetch,
  signal?: AbortSignal,
  expectedPayer?: string,
) {
  if (expectedPayer !== undefined) {
    expectedPayer = wallet.parse(expectedPayer);
    const url = new URL(path, 'https://registration.invalid');
    if (url.origin !== 'https://registration.invalid')
      throw new RegistrationReadError('unauthorized');
    url.searchParams.set('expectedPayer', expectedPayer);
    path = `${url.pathname}${url.search}`;
  }
  const response = await fetcher(path, {
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(API_TIMEOUT_MS)])
      : AbortSignal.timeout(API_TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });
  if (response.status === 401 || response.status === 403)
    throw new RegistrationReadError('unauthorized');
  if (!response.ok)
    throw new RegistrationReadError(
      'unavailable',
      response.status,
      registrationRetryAfterMs(
        response.headers.get('retry-after'),
        Date.now(),
        response.headers.get('date'),
      ),
    );
  if (
    expectedPayer !== undefined &&
    response.headers.get('x-authenticated-wallet')?.toLowerCase() !== expectedPayer
  )
    throw new RegistrationReadError('unauthorized');
  return response;
}

export async function readRegistrationSession(fetcher = fetch, signal?: AbortSignal) {
  const response = await registrationRead('/api/v1/auth/session', fetcher, signal);
  const session = z
    .object({ authenticated: z.boolean(), address: wallet.optional() })
    .parse(await response.json());
  if (!session.authenticated || !session.address) throw new RegistrationReadError('unauthorized');
  const serverTime = Date.parse(response.headers.get('date') ?? '');
  return { wallet: session.address, now: Number.isFinite(serverTime) ? serverTime : Date.now() };
}

export async function submitPaidRegistration(
  body: object,
  paymentHeaders: Record<string, string>,
  turnstilePass: string | null,
  fetcher = fetch,
): Promise<RegistrationAccepted | null> {
  try {
    const response = await fetcher('/api/v1/agents/register', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'respond-async',
        ...paymentHeaders,
        ...(turnstilePass ? { 'X-Turnstile-Pass': turnstilePass } : {}),
      },
      body: JSON.stringify(body),
    });
    if (response.status !== 202) return null;
    const result = registrationAcceptedSchema.safeParse(await response.json());
    return result.success ? result.data : null;
  } catch {
    // A lost response says nothing about settlement. Only authenticated reads resolve it.
    return null;
  }
}
