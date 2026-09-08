import assert from 'node:assert/strict';
import test from 'node:test';
import rejection from '../../../packages/shared/test/fixtures/registration-payment-rejection.json';
import {
  ATTEMPT_PREFIX,
  parsePaidRegistrationResponse,
  submitPaidRegistration,
  type RegistrationAttempt,
} from '../src/lib/registration-progress';
import {
  formatRegistrationPaymentAmount,
  readSubmissionReservation,
  runRegistrationSubmission,
  submissionReservationKey,
  SUBMISSION_REQUEST_TIMEOUT_MS,
  type RegistrationSubmissionDependencies,
} from '../src/lib/registration-submission';

const wallet = `0x${'1'.repeat(40)}`;
const otherWallet = `0x${'2'.repeat(40)}`;
const domain = 'payment.example';
const input = { wallet, domain, body: { preferredName: 'payment', tld: 'example' } };
const accepted = {
  registrationId: 'registration',
  statusUrl: '/api/v1/registrations/registration',
  status: 'processing',
  domain,
  paymentStatus: 'settled',
  pollAfterSeconds: 5,
};
const completed = {
  registrationId: 'registration',
  agentId: 'agent',
  domain,
  nftTokenId: 1,
  basename: null,
  ensName: null,
  txHash: `0x${'a'.repeat(64)}`,
  sslStatus: 'active',
  estimatedReadyAt: '2026-09-09T00:00:00.000Z',
  metadataUri: 'ipfs://synthetic',
  provisioningStatus: 'completed',
};

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    assert.fail('global storage cleanup is prohibited');
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const storage = new MemoryStorage();
  const state = {
    signatures: 0,
    paid: 0,
    ids: 0,
    remembered: [] as RegistrationAttempt[],
    accepted: [] as unknown[],
    phases: [] as Array<{ phase: string; amount?: string; expiresAt?: string | number }>,
  };
  let paidResponse = async () => Response.json(rejection, { status: 402 });
  const dependencies: RegistrationSubmissionDependencies = {
    storage,
    lock: async (_key, operation) => operation(),
    now: () => 1_000_000,
    randomId: () => `payment-${++state.ids}`,
    currentWallet: () => wallet,
    refreshTracking: async () => true,
    hasPurchase: () => false,
    fetcher: async (url, options) => {
      if (url === '/api/v1/auth/session')
        return Response.json(
          { authenticated: true, address: wallet },
          { headers: { Date: new Date(1_000_000).toUTCString() } },
        );
      assert.equal(url, '/api/v1/agents/register');
      if (new Headers(options?.headers).has('PAYMENT-SIGNATURE')) {
        state.paid++;
        assert.equal(readSubmissionReservation(storage, wallet, domain)?.phase, 'possibly_paid');
        assert.equal(
          state.remembered.length,
          0,
          'do not publish a confirming tracker before the response',
        );
        return paidResponse();
      }
      return Response.json(
        { accepts: [{ amount: '1234567', extra: { quoteExpiresAt: 1300 } }] },
        { status: 402 },
      );
    },
    createPaymentHeaders: async () => {
      state.signatures++;
      return { 'PAYMENT-SIGNATURE': 'synthetic-only' };
    },
    isSignatureCancellation: () => false,
    remember: (attempt) => {
      state.remembered.push(attempt);
      storage.setItem(`${ATTEMPT_PREFIX}${attempt.clientId}`, JSON.stringify(attempt));
    },
    accept: (_attempt, value) => {
      state.accepted.push(value);
    },
    onPhase: (phase, amount, expiresAt) => {
      state.phases.push({ phase, amount, expiresAt });
    },
  };
  return {
    storage,
    state,
    dependencies,
    respond: (next: typeof paidResponse) => {
      paidResponse = next;
    },
  };
}

test('only the complete, conclusive 4xx rejection contract is evidence of no settlement', () => {
  assert.equal(
    rejection.error,
    rejection.code,
    'The fixture includes the actual backend error alias',
  );
  for (const status of [400, 401, 402, 403, 409, 422, 429]) {
    assert.deepEqual(parsePaidRegistrationResponse(status, rejection), {
      status: 'rejected',
      settlementAttempted: false,
      code: rejection.code,
      message: rejection.message,
    });
  }
  for (const status of [200, 202, 302, 408, 500, 502, 503, 504])
    assert.equal(parsePaidRegistrationResponse(status, rejection), null, String(status));
  const { error: _alias, ...withoutAlias } = rejection;
  assert.equal(_alias, rejection.code);
  assert.deepEqual(
    parsePaidRegistrationResponse(409, withoutAlias),
    parsePaidRegistrationResponse(409, rejection),
  );
  for (const body of [
    {},
    null,
    { code: rejection.code, message: rejection.message },
    { ...rejection, paymentSubmission: { status: 'rejected' } },
    { ...rejection, paymentSubmission: { status: 'rejected', settlementAttempted: true } },
    { ...rejection, paymentSubmission: { status: 'rejected', settlementAttempted: 'false' } },
    { ...rejection, paymentStatus: 'settled' },
    { ...rejection, error: 'PAYMENT_STATUS_UNCERTAIN' },
    { ...rejection, error: null },
    { ...rejection, error: `${rejection.code} ` },
    { ...rejection, paymentTxHash: `0x${'a'.repeat(64)}` },
    { ...rejection, registrationId: 'already-created' },
    { ...rejection, paymentIdentifier: `0x${'a'.repeat(64)}` },
    { ...rejection, status: 'processing' },
    { ...rejection, paymentSubmission: { ...rejection.paymentSubmission, settled: true } },
    { ...rejection, code: '' },
    { ...rejection, message: '' },
  ])
    assert.equal(parsePaidRegistrationResponse(402, body), null);
});

test('accepted and completed evidence is projected without turning partial 200s into completion', () => {
  assert.deepEqual(parsePaidRegistrationResponse(202, accepted), accepted);
  assert.equal(
    parsePaidRegistrationResponse(202, {
      ...accepted,
      paymentSubmission: rejection.paymentSubmission,
    }),
    null,
  );
  const expected = {
    status: 'completed',
    registrationId: 'registration',
    domain,
    agentId: 'agent',
  };
  assert.deepEqual(
    parsePaidRegistrationResponse(200, { ...completed, privateProvider: 'omit' }),
    expected,
  );
  assert.deepEqual(
    parsePaidRegistrationResponse(200, { ...completed, provisioningStatus: undefined }),
    expected,
  );
  for (const value of [
    {},
    accepted,
    { ...completed, provisioningStatus: 'processing' },
    { ...completed, provisioningStatus: 'recovery_required' },
    { ...completed, sslStatus: 'pending' },
    { ...completed, txHash: '0x' },
    { ...completed, paymentStatus: 'unknown' },
    { ...completed, status: 'processing' },
    { ...completed, agentId: null },
  ])
    assert.equal(parsePaidRegistrationResponse(200, value), null);
  const progress = {
    ...accepted,
    status: 'completed',
    agentId: 'agent',
    stage: 'complete',
    messageCode: 'REGISTRATION_COMPLETE',
    startedAt: completed.estimatedReadyAt,
    updatedAt: completed.estimatedReadyAt,
    completedAt: completed.estimatedReadyAt,
    revision: 1,
    estimatedDurationSeconds: null,
    completionEventId: 'completion',
  };
  assert.deepEqual(parsePaidRegistrationResponse(200, progress), expected);
  assert.equal(parsePaidRegistrationResponse(200, { ...progress, paymentStatus: 'unknown' }), null);
});

test('a rejected paid request releases only its own reservation, creates no tracker, and never re-signs automatically', async () => {
  const f = fixture();
  const other = { wallet: otherWallet, domain, clientId: '999999-history' };
  f.storage.setItem(`${ATTEMPT_PREFIX}${other.clientId}`, JSON.stringify(other));
  f.storage.setItem('unrelated-history', 'preserve');
  f.storage.setItem(submissionReservationKey(otherWallet, domain), 'preserve-other-wallet');
  const before = new Map(f.storage.values);
  const result = await runRegistrationSubmission(input, f.dependencies);
  assert.equal(result.kind, 'rejected');
  assert.deepEqual(f.storage.values, before);
  assert.deepEqual(f.state.remembered, []);
  assert.deepEqual(f.state.accepted, []);
  assert.equal(f.state.signatures, 1);
  assert.equal(f.state.paid, 1);
  // A second payment requires a separate explicit checkout action after definitive rejection.
  await runRegistrationSubmission(input, f.dependencies);
  assert.equal(f.state.signatures, 2);
  assert.equal(f.state.paid, 2);
});

test('network, 5xx, malformed responses, and an unmarked replacement 402 stay guarded without retries', async () => {
  for (const response of [
    async () => {
      throw new Error('lost response');
    },
    async () => Response.json(rejection, { status: 503 }),
    async () => Response.json(rejection, { status: 408 }),
    async () => Response.json({ ...rejection, error: 'PAYMENT_STATUS_UNCERTAIN' }, { status: 409 }),
    async () => Response.json({ ...rejection, paymentStatus: 'settled' }, { status: 409 }),
    async () =>
      Response.json({ ...rejection, paymentTxHash: `0x${'a'.repeat(64)}` }, { status: 409 }),
    async () => Response.json({ ...rejection, registrationId: 'already-created' }, { status: 409 }),
    async () =>
      Response.json(
        { ...rejection, paymentSubmission: { ...rejection.paymentSubmission, txHash: '0x1234' } },
        { status: 409 },
      ),
    async () => Response.json({ accepts: [{ amount: '9999999' }] }, { status: 402 }),
    async () => new Response('{', { status: 202 }),
    async () => Response.json({}, { status: 200 }),
    async () => Response.json({ ...accepted, domain: 'unrelated.example' }, { status: 202 }),
    async () => Response.json({ ...completed, domain: 'unrelated.example' }, { status: 200 }),
  ]) {
    const f = fixture();
    f.respond(response);
    const result = await runRegistrationSubmission(input, f.dependencies);
    assert.equal(result.kind, 'tracking');
    if (result.kind !== 'tracking') assert.fail();
    assert.equal(result.accepted, null);
    assert.equal(readSubmissionReservation(f.storage, wallet, domain)?.phase, 'possibly_paid');
    assert.equal(f.state.remembered.length, 1);
    await assert.rejects(runRegistrationSubmission(input, f.dependencies), /EXISTING_SUBMISSION/);
    assert.equal(f.state.signatures, 1);
    assert.equal(f.state.paid, 1);
  }
});

test('a rejected response cannot release a successor reservation or a same-ID rewritten transmission', async () => {
  for (const change of ['clientId', 'submittedAt'] as const) {
    const f = fixture();
    let successor = '';
    f.respond(async () => {
      const current = readSubmissionReservation(f.storage, wallet, domain)!;
      successor = JSON.stringify(
        change === 'clientId'
          ? { ...current, clientId: '1000000-successor' }
          : {
              ...current,
              submittedAt: current.submittedAt! + 1,
              reviewAfter: current.reviewAfter + 1,
            },
      );
      f.storage.setItem(submissionReservationKey(wallet, domain), successor);
      return Response.json(rejection, { status: 402 });
    });
    const result = await runRegistrationSubmission(input, f.dependencies);
    assert.equal(result.kind, 'rejected');
    if (result.kind !== 'rejected') assert.fail();
    assert.equal(result.reservationReleased, false);
    assert.deepEqual(f.state.remembered, []);
    assert.equal(f.storage.getItem(submissionReservationKey(wallet, domain)), successor);
    await assert.rejects(runRegistrationSubmission(input, f.dependencies), /EXISTING_SUBMISSION/);
  }
});

test('local cleanup failure preserves the guard without creating a false confirming tracker for a rejected payment', async () => {
  const f = fixture();
  f.storage.removeItem = () => {
    throw new Error('storage unavailable');
  };
  const result = await runRegistrationSubmission(input, f.dependencies);
  assert.equal(result.kind, 'rejected');
  if (result.kind !== 'rejected') assert.fail();
  assert.equal(result.reservationReleased, false);
  assert.equal(readSubmissionReservation(f.storage, wallet, domain)?.phase, 'possibly_paid');
  assert.deepEqual(f.state.remembered, []);
  assert.deepEqual(f.state.accepted, []);
  await assert.rejects(runRegistrationSubmission(input, f.dependencies), /EXISTING_SUBMISSION/);
});

test('accepted and completed outcomes require matching domains and keep replay reservations', async () => {
  for (const status of [200, 202]) {
    const f = fixture();
    f.respond(async () => Response.json(status === 200 ? completed : accepted, { status }));
    const result = await runRegistrationSubmission(input, f.dependencies);
    assert.equal(result.kind, status === 200 ? 'completed' : 'tracking');
    assert.equal(readSubmissionReservation(f.storage, wallet, domain)?.phase, 'possibly_paid');
    await assert.rejects(runRegistrationSubmission(input, f.dependencies), /EXISTING_SUBMISSION/);
    assert.equal(f.state.paid, 1);
  }
});

test('a crash while the response is pending is guarded by the durable reservation even before tracker publication', async () => {
  const f = fixture();
  const pending = deferred<Response>();
  const started = deferred<void>();
  f.respond(() => {
    started.resolve();
    return pending.promise;
  });
  const submission = runRegistrationSubmission(input, f.dependencies);
  await started.promise;
  assert.deepEqual(f.state.remembered, []);
  await assert.rejects(runRegistrationSubmission(input, f.dependencies), /EXISTING_SUBMISSION/);
  pending.resolve(Response.json({}, { status: 502 }));
  assert.equal((await submission).kind, 'tracking');
});

test('hung paid fetch and body parsing use the existing request deadline and never accept late responses', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  for (const hang of ['fetch', 'body']) {
    const pending = deferred<Response>();
    let signal: AbortSignal | null | undefined;
    const response = submitPaidRegistration(
      input.body,
      { 'PAYMENT-SIGNATURE': 'synthetic' },
      null,
      async (_url, options) => {
        signal = options?.signal;
        return hang === 'fetch'
          ? pending.promise
          : new Response(new ReadableStream(), { status: 202 });
      },
    );
    context.mock.timers.tick(SUBMISSION_REQUEST_TIMEOUT_MS);
    assert.equal(await response, null);
    assert.equal(signal?.aborted, true);
    pending.resolve(Response.json(accepted, { status: 202 }));
    assert.equal(await response, null);
  }
});

test('challenge atomic amounts and expiry are preserved exactly, including sub-cent and large values', async () => {
  assert.equal(formatRegistrationPaymentAmount('1'), '0.000001');
  assert.equal(formatRegistrationPaymentAmount('1234567'), '1.234567');
  assert.equal(
    formatRegistrationPaymentAmount('9007199254740993123456'),
    '9007199254740993.123456',
  );
  const f = fixture();
  await runRegistrationSubmission(input, f.dependencies);
  assert.deepEqual(f.state.phases[1], {
    phase: 'awaiting-signature',
    amount: '1234567',
    expiresAt: 1300,
  });
});

test('display uses the same authoritative PAYMENT-REQUIRED header as the signer, not a different body quote', async () => {
  const f = fixture();
  const fetcher = f.dependencies.fetcher!;
  f.dependencies.fetcher = async (url, options) => {
    const response = await fetcher(url, options);
    if (response.status !== 402 || new Headers(options?.headers).has('PAYMENT-SIGNATURE'))
      return response;
    response.headers.set(
      'PAYMENT-REQUIRED',
      btoa(
        JSON.stringify({
          accepts: [{ amount: '1000001', extra: { quoteExpiresAt: '2026-09-09T01:00:00Z' } }],
        }),
      ),
    );
    return response;
  };
  await runRegistrationSubmission(input, f.dependencies);
  assert.equal(f.state.phases[1].amount, '1000001');
  assert.equal(f.state.phases[1].expiresAt, '2026-09-09T01:00:00Z');
});

test('ambiguous or invalid payment options never request a signature or transmit payment', async () => {
  for (const accepts of [
    [],
    [{ amount: '1' }, { amount: '2' }],
    [{ amount: 1 }],
    [{ amount: '1.5' }],
  ]) {
    const f = fixture();
    const fetcher = f.dependencies.fetcher!;
    f.dependencies.fetcher = async (url, options) =>
      url === '/api/v1/agents/register'
        ? Response.json({ accepts }, { status: 402 })
        : fetcher(url, options);
    await assert.rejects(
      runRegistrationSubmission(input, f.dependencies),
      /INVALID_PAYMENT_REQUIREMENT/,
    );
    assert.equal(f.state.signatures, 0);
    assert.equal(f.state.paid, 0);
    assert.equal(readSubmissionReservation(f.storage, wallet, domain), null);
  }
});

test('a late conclusive rejection after the deadline cannot release an unknown submission reservation', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const pending = deferred<Response>();
  const started = deferred<void>();
  f.respond(() => {
    started.resolve();
    return pending.promise;
  });
  const submission = runRegistrationSubmission(input, f.dependencies);
  await started.promise;
  context.mock.timers.tick(SUBMISSION_REQUEST_TIMEOUT_MS);
  const result = await submission;
  assert.equal(result.kind, 'tracking');
  if (result.kind !== 'tracking') assert.fail();
  assert.equal(result.accepted, null);
  pending.resolve(Response.json(rejection, { status: 402 }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(readSubmissionReservation(f.storage, wallet, domain)?.phase, 'possibly_paid');
  assert.equal(f.state.remembered.length, 1);
  await assert.rejects(runRegistrationSubmission(input, f.dependencies), /EXISTING_SUBMISSION/);
  assert.equal(f.state.paid, 1);
});
