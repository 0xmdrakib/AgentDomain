import type { IdentityInspectionInput, IdentityObservation } from './identity-observation';
import type { RenewalObservation } from './renewal-observation';
import { identityCheckResponseSchema, renewalCheckResponseSchema } from './identity-check-contract';

export class IdentityCheckRequestError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super('Identity check unavailable');
  }
}

export function requestIdentityCheck(input: IdentityInspectionInput, signal?: AbortSignal) {
  return requestCheck<IdentityObservation>('identity', input, signal);
}

export function requestRenewalCheck(input: IdentityInspectionInput, signal?: AbortSignal) {
  return requestCheck<RenewalObservation>('renewal', input, signal);
}

async function requestCheck<T>(
  kind: 'identity' | 'renewal',
  input: IdentityInspectionInput,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch('/api/v1/public/identity-inspection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, kind }),
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal,
  });
  if (response.status === 429) {
    const header = response.headers.get('Retry-After') ?? '';
    const seconds = /^\d{1,4}$/.test(header) ? Number(header) : 0;
    throw new IdentityCheckRequestError(
      'RATE_LIMITED',
      seconds >= 1 && seconds <= 3_600 ? seconds : undefined,
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const raw = payload && typeof payload === 'object' && 'code' in payload ? payload.code : null;
    const code =
      raw === 'INVALID_INPUT' || raw === 'VALIDATION_ERROR'
        ? 'INVALID_INPUT'
        : raw === 'WRONG_CHAIN' || raw === 'UNSAFE_SNAPSHOT'
          ? raw
          : 'UNAVAILABLE';
    throw new IdentityCheckRequestError(code);
  }
  const parsed = (
    kind === 'identity' ? identityCheckResponseSchema : renewalCheckResponseSchema
  ).safeParse(payload);
  if (!parsed.success) throw new IdentityCheckRequestError('UNAVAILABLE');
  return parsed.data as T;
}
