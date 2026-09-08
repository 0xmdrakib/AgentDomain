import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ATTEMPT_PREFIX,
  registrationCopy,
  registrationProgressSchema,
  type RegistrationAttempt,
  type RegistrationProgress,
} from '../src/lib/registration-progress';
import {
  browserSubmissionLock,
  readSubmissionReservation,
  releaseUnchargedSubmissionReservation,
  runRegistrationSubmission,
  submissionReservationKey,
  SUBMISSION_REVIEW_AFTER_MS,
  type SubmissionLock,
} from '../src/lib/registration-submission';
import { RegistrationTracker } from '../src/lib/registration-tracker';

const payer = `0x${'1'.repeat(40)}`;
const other = `0x${'2'.repeat(40)}`;
const id = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const paymentReference = `0x${'a'.repeat(64)}`;
const otherReference = `0x${'b'.repeat(64)}`;
const start = Date.parse('2026-09-10T00:00:00.000Z');
const attempt: RegistrationAttempt = {
  wallet: payer,
  domain: 'declined.test',
  clientId: `${start}-${id}`,
};
const key = submissionReservationKey(payer, attempt.domain);
const attemptKey = `${ATTEMPT_PREFIX}${attempt.clientId}`;
const initialReservation = {
  ...attempt,
  version: 1,
  phase: 'possibly_paid',
  createdAt: start,
  submittedAt: start,
  paymentReference,
  reviewAfter: start + SUBMISSION_REVIEW_AFTER_MS,
};
const record = (extra: Partial<RegistrationProgress> = {}): RegistrationProgress => {
  const item: RegistrationProgress = {
    registrationId: id,
    statusUrl: `/api/v1/registrations/${id}`,
    domain: attempt.domain,
    status: 'failed',
    paymentStatus: 'not_charged',
    paymentReference,
    messageCode: 'PAYMENT_NOT_SUBMITTED',
    stage: 'payment',
    agentId: null,
    startedAt: new Date(start).toISOString(),
    updatedAt: new Date(start).toISOString(),
    completedAt: null,
    completionEventId: null,
    revision: 1,
    estimatedDurationSeconds: null,
    pollAfterSeconds: 5,
    ...extra,
  };
  if (
    item.status !== 'failed' ||
    item.paymentStatus !== 'not_charged' ||
    item.messageCode !== 'PAYMENT_NOT_SUBMITTED'
  )
    delete item.paymentReference;
  return item;
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
    throw new Error('Global clear is forbidden');
  }
}
class MemoryLocks {
  held = new Set<string>();
  calls: string[] = [];
  before?: () => Promise<void>;
  lock: SubmissionLock = async (key, operation) => {
    this.calls.push(key);
    if (this.held.has(key)) throw new Error('CHECKOUT_BUSY');
    this.held.add(key);
    try {
      await this.before?.();
      return await operation();
    } finally {
      this.held.delete(key);
    }
  };
}
function fixture(seed = true, locksAvailable = true) {
  const storage = new MemoryStorage();
  const locks = new MemoryLocks();
  if (seed) {
    storage.setItem(attemptKey, JSON.stringify(attempt));
    storage.setItem(key, JSON.stringify(initialReservation));
  }
  const state = {
    now: start + 10000,
    wallet: payer,
    session: payer,
    replyWallet: payer as string | null,
    status: 200,
    records: [record()],
    calls: [] as { path: string; method: string }[],
    paidCalls: 0,
    partial: false,
  };
  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(String(input), 'https://fixture.test');
    state.calls.push({ path: url.pathname, method: options?.method ?? 'GET' });
    assert.equal(options?.credentials, 'include');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.redirect, 'error');
    if (url.pathname === '/api/v1/auth/session')
      return Response.json(
        { authenticated: true, address: state.session },
        { headers: { Date: new Date(state.now).toUTCString() } },
      );
    if (url.pathname === '/api/v1/agents/register') {
      if (new Headers(options?.headers).has('PAYMENT-SIGNATURE')) {
        state.paidCalls++;
        throw new Error('Synthetic decline response was lost');
      }
      return Response.json(
        { accepts: [{ amount: '1000000', extra: { requestBinding: paymentReference } }] },
        { status: 402 },
      );
    }
    const headers = state.replyWallet ? { 'X-Authenticated-Wallet': state.replyWallet } : {};
    assert.equal(url.searchParams.get('expectedPayer'), state.wallet);
    if (url.pathname.startsWith('/api/v1/registration-notices'))
      return Response.json({ items: [], nextCursor: null }, { headers });
    if (state.status !== 200) return Response.json({}, { status: state.status });
    if (url.pathname === '/api/v1/registrations')
      return Response.json(
        {
          items: state.records,
          total: state.partial ? 100 : state.records.length,
          hasMore: state.partial,
        },
        { headers },
      );
    assert.ok(url.pathname.startsWith('/api/v1/registrations/'));
    return Response.json(
      state.records.find((item) => item.registrationId === url.pathname.split('/').pop()) ?? {},
      { headers },
    );
  };
  const tracker = new RegistrationTracker({
    storage,
    fetcher,
    now: () => state.now,
    random: () => 0,
    submissionLock: locksAvailable ? locks.lock : undefined,
  });
  const connect = async () => {
    tracker.setExpectedWallet(state.wallet);
    await tracker.refresh();
  };
  const poll = async () => {
    state.now += Math.max(10000, tracker.getNextPollDelay());
    return tracker.refresh();
  };
  return { storage, locks, state, fetcher, tracker, connect, poll };
}

test('lost decline response -> payer-authenticated not-charged status releases checkout reservation and exact attempt', async () => {
  const f = fixture(false);
  f.state.records = [];
  await f.connect();
  const result = await runRegistrationSubmission(
    { wallet: payer, domain: attempt.domain, body: { preferredName: 'declined', tld: 'test' } },
    {
      storage: f.storage,
      lock: f.locks.lock,
      fetcher: f.fetcher,
      now: () => f.state.now,
      randomId: () => id,
      currentWallet: () => f.state.wallet,
      refreshTracking: f.tracker.refresh,
      isTrackingReadyForPayer: f.tracker.isReadyForPayer,
      hasPurchase: (wallet, domain) => f.tracker.hasPurchase(wallet, domain),
      createPaymentHeaders: async () => ({ 'PAYMENT-SIGNATURE': 'synthetic-only' }),
      isSignatureCancellation: () => false,
      remember: (pending) => f.tracker.remember(pending),
      accept: (pending, receipt) => f.tracker.accept(pending, receipt),
    },
  );
  assert.equal(result.kind, 'tracking');
  if (result.kind !== 'tracking') assert.fail();
  assert.equal(result.accepted, null);
  assert.equal(readSubmissionReservation(f.storage, payer, attempt.domain)?.phase, 'possibly_paid');
  await f.tracker.refresh();
  f.state.records = [
    record({
      startedAt: new Date(f.state.now).toISOString(),
      updatedAt: new Date(f.state.now).toISOString(),
    }),
  ];
  await f.poll();
  assert.equal(f.storage.getItem(key), null);
  assert.equal(f.storage.getItem(`${ATTEMPT_PREFIX}${result.attempt.clientId}`), null);
  assert.equal(f.tracker.hasPurchase(payer, attempt.domain), false);
  assert.equal(f.state.paidCalls, 1, 'reconciliation never resends payment');
  assert.ok(f.locks.calls.length >= 2);
  assert.ok(f.locks.calls.every((value) => value === key));
  assert.equal(f.tracker.getSnapshot().items[0].paymentStatus, 'not_charged');
});

test('an orphan reservation left by an older tracker is released only by its unique fresh rejection match', async () => {
  const f = fixture();
  f.storage.removeItem(attemptKey);
  await f.connect();
  assert.equal(f.storage.getItem(key), null);
  assert.equal(f.locks.calls[0], key);
  assert.equal(
    f.state.calls.some((call) => call.method !== 'GET'),
    false,
  );
});

test('unknown failure, contradictory evidence, and age alone never release a purchase guard', async () => {
  for (const extra of [
    { paymentStatus: 'unknown' },
    { messageCode: 'REGISTRATION_FAILED' },
    { status: 'processing' },
    { agentId: 'agent' },
    { completedAt: new Date(start).toISOString() },
    { completionEventId: 'completion' },
    { domain: 'unrelated.test' },
  ] as Partial<RegistrationProgress>[]) {
    const f = fixture();
    f.state.now += 365 * 86400000;
    f.state.records = [record(extra)];
    await f.connect();
    await f.poll();
    assert.equal(f.storage.getItem(key), JSON.stringify(initialReservation), JSON.stringify(extra));
    assert.equal(f.storage.getItem(attemptKey), JSON.stringify(attempt));
  }
});

test('two possible registration matches never release one local reservation by domain alone', async () => {
  const f = fixture();
  f.state.records.push(
    record({ registrationId: secondId, statusUrl: `/api/v1/registrations/${secondId}` }),
  );
  await f.connect();
  assert.equal(f.storage.getItem(key), JSON.stringify(initialReservation));
  assert.equal(f.locks.calls.length, 0);
});

test('accepted settlement or previously observed settlement cannot regress to not charged', async () => {
  for (const source of ['acceptance', 'progress']) {
    const f = fixture();
    f.state.records = [
      record({
        status: source === 'progress' ? 'processing' : 'action_required',
        paymentStatus: source === 'progress' ? 'settled' : 'unknown',
        messageCode: 'PAYMENT_CONFIRMATION_REQUIRED',
      }),
    ];
    await f.connect();
    if (source === 'acceptance') {
      f.tracker.accept(attempt, {
        registrationId: id,
        statusUrl: `/api/v1/registrations/${id}`,
        domain: attempt.domain,
        status: 'processing',
        paymentStatus: 'settled',
        pollAfterSeconds: 5,
      });
      await f.tracker.refresh();
    }
    f.state.records = [record({ revision: 2, updatedAt: new Date(f.state.now).toISOString() })];
    await f.poll();
    assert.notEqual(f.tracker.getSnapshot().items[0].paymentStatus, 'not_charged');
    assert.equal(f.storage.getItem(key), JSON.stringify(initialReservation));
    assert.equal(f.storage.getItem(attemptKey), JSON.stringify(attempt));
    assert.equal(f.locks.calls.length, 0);
  }
});

test('busy and unavailable checkout locks preserve both guards and retry only on a later read', async () => {
  const busy = fixture();
  busy.locks.held.add(key);
  await busy.connect();
  assert.equal(busy.storage.getItem(key), JSON.stringify(initialReservation));
  assert.equal(busy.storage.getItem(attemptKey), JSON.stringify(attempt));
  busy.locks.held.delete(key);
  await busy.poll();
  assert.equal(busy.storage.getItem(key), null);
  const missing = fixture(true, false);
  await missing.connect();
  assert.equal(missing.storage.getItem(key), JSON.stringify(initialReservation));
  assert.equal(missing.storage.getItem(attemptKey), JSON.stringify(attempt));
});

test('same checkout Web Lock uses exclusive ifAvailable semantics, never an unlocked fallback', async () => {
  const calls: unknown[] = [];
  const native = {
    request: async (
      name: string,
      options: object,
      callback: (lock: object | null) => Promise<unknown>,
    ) => {
      calls.push({ name, options });
      return callback(null);
    },
  } as unknown as Pick<LockManager, 'request'>;
  const f = fixture();
  assert.equal(
    await releaseUnchargedSubmissionReservation(attempt, record(), {
      storage: f.storage,
      lock: browserSubmissionLock(native),
      currentWallet: () => payer,
      isCurrent: () => true,
    }),
    false,
  );
  assert.deepEqual(calls, [{ name: key, options: { mode: 'exclusive', ifAvailable: true } }]);
  assert.equal(f.storage.getItem(key), JSON.stringify(initialReservation));
});

test('wallet/epoch changes while acquiring the lock retain the original wallet reservation', async () => {
  const f = fixture();
  f.locks.before = async () => {
    f.state.wallet = other;
    f.state.session = other;
    f.state.replyWallet = other;
    f.state.records = [];
    f.tracker.setExpectedWallet(other);
  };
  await f.connect();
  await f.tracker.refresh();
  assert.equal(f.storage.getItem(key), JSON.stringify(initialReservation));
  assert.equal(f.storage.getItem(attemptKey), JSON.stringify(attempt));
  assert.equal(f.tracker.getSnapshot().wallet, other);
});

test('replacement reservations and rewritten same-ID attempts survive async lock acquisition', async () => {
  for (const replacement of [
    { ...initialReservation, clientId: `${start}-${secondId}` },
    {
      ...initialReservation,
      submittedAt: start + 1,
      reviewAfter: start + 1 + SUBMISSION_REVIEW_AFTER_MS,
    },
    { ...initialReservation, phase: 'reserved', submittedAt: undefined },
    { ...initialReservation, wallet: other },
    { ...initialReservation, domain: 'successor.test' },
  ]) {
    const f = fixture();
    f.locks.before = async () => {
      f.storage.setItem(key, JSON.stringify(replacement));
    };
    await f.connect();
    assert.equal(f.storage.getItem(key), JSON.stringify(replacement));
    assert.equal(f.storage.getItem(attemptKey), JSON.stringify(attempt));
  }
  const f = fixture();
  const successor = { ...attempt, wallet: other };
  f.locks.before = async () => {
    f.storage.setItem(attemptKey, JSON.stringify(successor));
  };
  await f.connect();
  assert.equal(f.storage.getItem(attemptKey), JSON.stringify(successor));
  assert.equal(f.storage.getItem(key), JSON.stringify(initialReservation));
});

test('a pre-existing successor reservation is never treated as an orphan of a different saved attempt', async () => {
  const f = fixture();
  const successor = { ...initialReservation, clientId: `${start}-${secondId}` };
  f.storage.setItem(key, JSON.stringify(successor));
  await f.connect();
  assert.equal(f.storage.getItem(key), JSON.stringify(successor));
  assert.equal(f.storage.getItem(attemptKey), JSON.stringify(attempt));
  assert.equal(f.locks.calls.length, 0);
});

test('storage read/remove failures retain guards instead of reporting a release', async () => {
  for (const operation of ['read', 'remove']) {
    const f = fixture();
    if (operation === 'read') {
      const read = f.storage.getItem.bind(f.storage);
      f.storage.getItem = (name) => {
        if (name === key) throw new Error('blocked read');
        return read(name);
      };
    } else {
      const remove = f.storage.removeItem.bind(f.storage);
      f.storage.removeItem = (name) => {
        if (name === key) throw new Error('blocked remove');
        remove(name);
      };
    }
    await f.connect();
    assert.equal(f.storage.values.get(key), JSON.stringify(initialReservation));
    assert.equal(f.storage.values.get(attemptKey), JSON.stringify(attempt));
  }
});

test('an orphan keeps its fallback guard if deletion confirmation fails and the saved reference is lost', async () => {
  const f = fixture();
  f.storage.removeItem(attemptKey);
  f.storage.setItem('unrelated-financial-record', 'protected');
  const read = f.storage.getItem.bind(f.storage);
  f.storage.getItem = (name) => {
    if (name === key && !f.storage.values.has(key))
      throw new Error('Deletion confirmation unavailable');
    return read(name);
  };
  await f.connect();
  assert.equal(f.storage.values.get(attemptKey), JSON.stringify(attempt));
  assert.equal(f.tracker.hasPurchase(payer, attempt.domain), true);
  f.storage.getItem = read;
  await f.poll();
  assert.equal(f.storage.getItem(key), null);
  assert.equal(f.storage.getItem(attemptKey), JSON.stringify(attempt));
  assert.equal(f.tracker.getReleasedRejection(attempt), undefined);
  assert.equal(f.storage.getItem('unrelated-financial-record'), 'protected');
});

test('an acceptance arriving while the release lock is pending prevents cleanup', async () => {
  const f = fixture();
  f.locks.before = async () => {
    f.tracker.accept(attempt, {
      registrationId: id,
      statusUrl: `/api/v1/registrations/${id}`,
      domain: attempt.domain,
      status: 'processing',
      paymentStatus: 'settled',
      pollAfterSeconds: 5,
    });
  };
  await f.connect();
  assert.equal(f.storage.getItem(key), JSON.stringify(initialReservation));
  assert.equal(f.storage.getItem(attemptKey), JSON.stringify(attempt));
  assert.equal(f.tracker.getAcceptance(attempt)?.paymentStatus, 'settled');
  assert.equal(
    f.tracker.getSnapshot().items.some((item) => item.paymentStatus === 'not_charged'),
    false,
  );
});

test('unauthorized, cross-wallet, missing-attestation and stale cached status cannot release a reservation', async () => {
  for (const mode of ['unauthorized', 'cross-wallet', 'missing-header']) {
    const f = fixture();
    if (mode === 'unauthorized') f.state.status = 401;
    if (mode === 'cross-wallet') f.state.replyWallet = other;
    if (mode === 'missing-header') f.state.replyWallet = null;
    await f.connect();
    assert.equal(f.storage.getItem(key), JSON.stringify(initialReservation));
    assert.equal(f.locks.calls.length, 0);
  }
  const f = fixture();
  f.locks.held.add(key);
  await f.connect();
  f.locks.held.delete(key);
  f.state.status = 503;
  await f.poll();
  assert.equal(f.storage.getItem(key), JSON.stringify(initialReservation));
});

test('not-charged copy is explicit while unknown failure and settled acceptance remain conservative', () => {
  assert.equal(
    registrationCopy(record()),
    'Payment was not submitted. This checkout was not charged.',
  );
  assert.doesNotMatch(
    registrationCopy(record({ paymentStatus: 'unknown' })),
    /not charged|not submitted/,
  );
  assert.doesNotMatch(
    registrationCopy(record(), {
      registrationId: id,
      statusUrl: `/api/v1/registrations/${id}`,
      status: 'processing',
      domain: attempt.domain,
      paymentStatus: 'settled',
      pollAfterSeconds: 5,
    }),
    /not charged|not submitted/,
  );
});

test('partial discovery cannot use a later rejected payment to clear a different signed nonce', async () => {
  const f = fixture();
  f.state.partial = true;
  f.state.records = [
    record({
      registrationId: secondId,
      statusUrl: `/api/v1/registrations/${secondId}`,
      paymentReference: otherReference,
      startedAt: new Date(start + 1000).toISOString(),
      updatedAt: new Date(start + 1000).toISOString(),
    }),
  ];
  await f.connect();
  assert.equal(f.tracker.getSnapshot().discoveryComplete, false);
  assert.equal(f.storage.getItem(key), JSON.stringify(initialReservation));
  assert.equal(f.tracker.matches(attempt), undefined);
  assert.equal(f.tracker.getReleasedRejection(attempt), undefined);
  f.state.records.push(record());
  await f.poll();
  assert.equal(f.tracker.getSnapshot().discoveryComplete, false);
  assert.equal(f.storage.getItem(key), null);
  assert.equal(f.tracker.getReleasedRejection(attempt)?.paymentReference, paymentReference);
});

test('missing legacy references never release; a matching reference does not rely on the client clock', async () => {
  for (const side of ['reservation', 'status']) {
    const f = fixture();
    if (side === 'reservation')
      f.storage.setItem(
        key,
        JSON.stringify({ ...initialReservation, paymentReference: undefined }),
      );
    else f.state.records = [record({ paymentReference: undefined })];
    await f.connect();
    await f.poll();
    assert.ok(f.storage.getItem(key));
    assert.ok(f.storage.getItem(attemptKey));
    assert.equal(f.tracker.getReleasedRejection(attempt), undefined);
  }
  const f = fixture();
  f.state.records = [record({ startedAt: new Date(start - 60000).toISOString() })];
  await f.connect();
  assert.equal(f.storage.getItem(key), null);
});

test('nonce swaps inside the Web Lock retain the successor even when every other field is identical', async () => {
  const f = fixture();
  const replacement = { ...initialReservation, paymentReference: otherReference };
  f.locks.before = async () => {
    f.storage.setItem(key, JSON.stringify(replacement));
  };
  await f.connect();
  assert.equal(f.storage.getItem(key), JSON.stringify(replacement));
  assert.equal(f.storage.getItem(attemptKey), JSON.stringify(attempt));
  assert.equal(f.tracker.getReleasedRejection(attempt), undefined);
});

test('the optional progress reference is bytes32 and restricted to conclusive rejection projection', () => {
  for (const invalid of ['', '0x1234', 123, null])
    assert.equal(
      registrationProgressSchema.safeParse({ ...record(), paymentReference: invalid }).success,
      false,
    );
  assert.equal(
    registrationProgressSchema.safeParse({
      ...record(),
      status: 'processing',
      paymentStatus: 'settled',
    }).success,
    false,
  );
  assert.equal(registrationProgressSchema.parse(record()).paymentReference, paymentReference);
});

test('a same-revision newly projected reference can confirm release without inventing workflow advancement', async () => {
  const f = fixture();
  f.state.records = [record({ paymentReference: undefined })];
  await f.connect();
  assert.ok(f.storage.getItem(key));
  f.state.records = [record()];
  await f.poll();
  assert.equal(f.tracker.getReleasedRejection(attempt)?.registrationId, id);
  assert.equal(f.storage.getItem(key), null);
});

test('invalid unsigned 200/202 responses fail preparation without ever marking possibly paid', async () => {
  for (const [status, value] of [
    [200, {}],
    [202, {}],
    [
      202,
      {
        registrationId: id,
        status: 'processing',
        statusUrl: `/api/v1/registrations/${id}`,
        domain: 'wrong.test',
        paymentStatus: 'settled',
        pollAfterSeconds: 5,
      },
    ],
  ] as const) {
    const f = fixture(false);
    f.state.records = [];
    await f.connect();
    let signs = 0;
    let published = 0;
    const writes: string[] = [];
    const save = f.storage.setItem.bind(f.storage);
    f.storage.setItem = (name, raw) => {
      writes.push(raw);
      save(name, raw);
    };
    await assert.rejects(
      runRegistrationSubmission(
        { wallet: payer, domain: attempt.domain, body: { preferredName: 'declined', tld: 'test' } },
        {
          storage: f.storage,
          lock: f.locks.lock,
          fetcher: async (url, options) =>
            String(url).includes('/agents/register')
              ? Response.json(value, { status })
              : f.fetcher(url, options),
          now: () => f.state.now,
          randomId: () => id,
          currentWallet: () => payer,
          refreshTracking: async () => true,
          hasPurchase: () => false,
          createPaymentHeaders: async () => {
            signs++;
            return {};
          },
          isSignatureCancellation: () => false,
          remember: () => {
            published++;
          },
          accept: () => {
            published++;
          },
        },
      ),
      /PREPARATION_FAILED/,
    );
    assert.equal(signs, 0);
    assert.equal(published, 0);
    assert.equal(f.storage.getItem(key), null);
    assert.equal(
      writes.some((raw) => raw.includes('possibly_paid')),
      false,
    );
  }
});

test('challenge reference is stored only after SDK signing, from the authoritative header; signatures are never persisted', async () => {
  for (const rejectedBySdk of [false, true]) {
    const f = fixture(false);
    f.state.records = [];
    await f.connect();
    let signatures = 0;
    const request = runRegistrationSubmission(
      { wallet: payer, domain: attempt.domain, body: { preferredName: 'declined', tld: 'test' } },
      {
        storage: f.storage,
        lock: f.locks.lock,
        fetcher: async (url, options) => {
          if (!String(url).includes('/agents/register')) return f.fetcher(url, options);
          if (new Headers(options?.headers).has('PAYMENT-SIGNATURE')) {
            assert.equal(
              readSubmissionReservation(f.storage, payer, attempt.domain)?.paymentReference,
              paymentReference,
            );
            throw new Error('Synthetic lost response');
          }
          return Response.json(
            { accepts: [{ amount: '1', extra: { requestBinding: otherReference } }] },
            {
              status: 402,
              headers: {
                'PAYMENT-REQUIRED': btoa(
                  JSON.stringify({
                    accepts: [{ amount: '1000000', extra: { requestBinding: paymentReference } }],
                  }),
                ),
              },
            },
          );
        },
        now: () => f.state.now,
        randomId: () => id,
        currentWallet: () => payer,
        refreshTracking: async () => true,
        hasPurchase: () => false,
        isSignatureCancellation: () => false,
        createPaymentHeaders: async () => {
          signatures++;
          const saved = readSubmissionReservation(f.storage, payer, attempt.domain);
          assert.equal(saved?.phase, 'reserved');
          assert.equal(saved?.paymentReference, undefined);
          if (rejectedBySdk) throw new Error('SDK challenge validation rejected');
          return { 'PAYMENT-SIGNATURE': 'signature-must-not-be-saved' };
        },
        remember: (pending) => f.tracker.remember(pending),
        accept: (pending, receipt) => f.tracker.accept(pending, receipt),
      },
    );
    if (rejectedBySdk) {
      await assert.rejects(request, /SIGNATURE_FAILED/);
      assert.equal(f.storage.getItem(key), null);
    } else {
      await request;
      await f.tracker.refresh();
      assert.equal(
        readSubmissionReservation(f.storage, payer, attempt.domain)?.paymentReference,
        paymentReference,
      );
    }
    assert.equal(signatures, 1);
    assert.doesNotMatch([...f.storage.values.values()].join(''), /signature-must-not-be-saved/);
  }
});
