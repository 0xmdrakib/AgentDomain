import { API_TIMEOUT_MS } from './transport-policy';

const requests = {
  nonce: { path: 'nonce', method: 'GET', label: 'Sign-in request' },
  session: { path: 'session', method: 'GET', label: 'Session check' },
  verify: { path: 'verify', method: 'POST', label: 'Sign-in verification' },
  'sign-out': { path: 'session', method: 'DELETE', label: 'Sign-out request' },
} as const;

export function requestSiwe<T>(
  operation: 'nonce' | 'session' | 'verify',
  init?: RequestInit,
  fetcher?: typeof fetch,
): Promise<T>;
export function requestSiwe(
  operation: 'sign-out',
  init?: RequestInit,
  fetcher?: typeof fetch,
): Promise<void>;
export async function requestSiwe(
  operation: keyof typeof requests,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const request = requests[operation];
  const deadline = AbortSignal.timeout(API_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;

  try {
    signal.throwIfAborted();
    const response = await fetcher(`/api/v1/auth/${request.path}`, {
      ...init,
      method: request.method,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(operation === 'verify' ? { 'Content-Type': 'application/json' } : {}),
      },
      signal,
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      signal.throwIfAborted();
      const detail = operation === 'verify' ? (body?.message ?? body?.error) : null;
      throw new Error(
        typeof detail === 'string' && detail
          ? detail
          : `${request.label} failed (${response.status}). Please try again.`,
      );
    }

    // Keep the HTTP deadline active through body consumption, never through wallet approval.
    const data = operation === 'sign-out' ? undefined : await response.json();
    signal.throwIfAborted();
    return data;
  } catch (error) {
    if (init.signal?.aborted) throw init.signal.reason;
    if (deadline.aborted) throw new Error(`${request.label} timed out. Please try again.`);
    if (error instanceof TypeError)
      throw new Error('Authentication service is unavailable. Please try again.');
    throw error;
  }
}
