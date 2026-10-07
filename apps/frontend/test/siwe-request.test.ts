import assert from 'node:assert/strict';
import test from 'node:test';
import { requestSiwe } from '../src/lib/siwe-request';
import { API_TIMEOUT_MS } from '../src/lib/transport-policy';

test('auth requests use the shared HTTP deadline, cookies, and uncached JSON', async (t) => {
  const deadline = new AbortController();
  const timeouts: number[] = [];
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    timeouts.push(ms);
    return deadline.signal;
  });
  const calls: { path: string; init: RequestInit }[] = [];
  const fetcher = (async (path, init) => {
    calls.push({ path: String(path), init: init! });
    return Response.json({ nonce: 'syntheticnonce' });
  }) as typeof fetch;
  await requestSiwe('nonce', {}, fetcher);
  await requestSiwe('session', {}, fetcher);
  await requestSiwe('verify', { body: 'signed-message' }, fetcher);
  await requestSiwe('sign-out', {}, fetcher);
  assert.deepEqual(timeouts, Array(4).fill(API_TIMEOUT_MS));
  assert.deepEqual(
    calls.map(({ path, init }) => [path, init.method]),
    [
      ['/api/v1/auth/nonce', 'GET'],
      ['/api/v1/auth/session', 'GET'],
      ['/api/v1/auth/verify', 'POST'],
      ['/api/v1/auth/session', 'DELETE'],
    ],
  );
  for (const { init } of calls) {
    assert.equal(init.credentials, 'include');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.signal, deadline.signal);
    assert.equal(new Headers(init.headers).get('Accept'), 'application/json');
  }
  assert.equal(calls[2].init.body, 'signed-message');
  assert.equal(new Headers(calls[2].init.headers).get('Content-Type'), 'application/json');
});

for (const operation of ['nonce', 'session', 'verify', 'sign-out'] as const) {
  test(`${operation} stalls abort with a retryable error and no automatic resend`, async (t) => {
    const deadline = new AbortController();
    t.mock.method(AbortSignal, 'timeout', () => deadline.signal);
    let sends = 0;
    const fetcher = (async (_path, init) => {
      sends++;
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
      });
    }) as typeof fetch;
    const result =
      operation === 'sign-out'
        ? requestSiwe(operation, {}, fetcher)
        : requestSiwe(operation, {}, fetcher);
    deadline.abort(new DOMException('Expired', 'TimeoutError'));
    await assert.rejects(result, /timed out\. Please try again\./);
    assert.equal(sends, 1);
  });
}

for (const status of [200, 503]) {
  test(`the deadline also bounds a stalled ${status} JSON response body`, async (t) => {
    const deadline = new AbortController();
    t.mock.method(AbortSignal, 'timeout', () => deadline.signal);
    const fetcher = (async (_path, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init!.signal!.addEventListener('abort', () => controller.error(init!.signal!.reason));
          },
        }),
        { status },
      )) as typeof fetch;
    const result = requestSiwe('verify', {}, fetcher);
    deadline.abort(new DOMException('Expired', 'TimeoutError'));
    await assert.rejects(result, /Sign-in verification timed out/);
  });
}

test('wallet/lifetime cancellation stays distinct from an HTTP timeout', async (t) => {
  const deadline = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => deadline.signal);
  const wallet = new AbortController();
  const reason = new DOMException('Wallet changed', 'AbortError');
  let sends = 0;
  const fetcher = (async (_path, init) => {
    sends++;
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
    });
  }) as typeof fetch;
  const result = requestSiwe('session', { signal: wallet.signal }, fetcher);
  wallet.abort(reason);
  await assert.rejects(result, (error) => error === reason);
  await assert.rejects(
    requestSiwe('nonce', { signal: wallet.signal }, fetcher),
    (error) => error === reason,
  );
  assert.equal(sends, 1, 'an already obsolete wallet must not start a request');
});

test('HTTP errors, including sign-out, are not accepted as successful authentication', async () => {
  const fetcher = (async () => Response.json({}, { status: 503 })) as typeof fetch;
  await assert.rejects(requestSiwe('nonce', {}, fetcher), /Sign-in request failed \(503\)/);
  await assert.rejects(requestSiwe('session', {}, fetcher), /Session check failed \(503\)/);
  await assert.rejects(requestSiwe('sign-out', {}, fetcher), /Sign-out request failed \(503\)/);
});

test('verification preserves existing server auth errors and sign-out accepts an empty success', async () => {
  const rejected = (async () =>
    Response.json({ message: 'NONCE_MISSING_OR_EXPIRED' }, { status: 401 })) as typeof fetch;
  await assert.rejects(requestSiwe('verify', {}, rejected), /NONCE_MISSING_OR_EXPIRED/);
  const empty = (async () => new Response(null, { status: 204 })) as typeof fetch;
  assert.equal(await requestSiwe('sign-out', {}, empty), undefined);
});

test('network failures provide visible retry copy without retrying signed requests', async () => {
  let sends = 0;
  const fetcher = (async () => {
    sends++;
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  await assert.rejects(requestSiwe('verify', {}, fetcher), /unavailable\. Please try again\./);
  assert.equal(sends, 1);
});
