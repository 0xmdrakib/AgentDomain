import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as submissionModule from '../src/lib/registration-submission';
import { ATTEMPT_PREFIX, type RegistrationAttempt } from '../src/lib/registration-progress';
import {
  browserSubmissionLock,
  readSubmissionReservation,
  RegistrationSubmissionError,
  runRegistrationSubmission,
  submissionReservationKey,
  submissionReviewRequired,
  SUBMISSION_REQUEST_TIMEOUT_MS,
  SUBMISSION_REVIEW_AFTER_MS,
  type RegistrationSubmissionDependencies,
  type SubmissionLock,
} from '../src/lib/registration-submission';

const payer = `0x${'1'.repeat(40)}`;
const other = `0x${'2'.repeat(40)}`;
const domain = 'agent.example';
const input = {
  wallet: payer,
  domain,
  body: { preferredName: 'agent', tld: 'example', turnstileToken: 'fixture-turnstile' },
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
    this.values.clear();
  }
}

class MemoryLocks {
  active = new Set<string>();
  lock: SubmissionLock = async (key, operation) => {
    if (this.active.has(key)) throw new RegistrationSubmissionError('CHECKOUT_BUSY');
    this.active.add(key);
    try {
      return await operation();
    } finally {
      this.active.delete(key);
    }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(storage = new MemoryStorage(), locks = new MemoryLocks()) {
  const state = {
    wallet: payer,
    session: payer,
    now: 1_000_000,
    existing: false,
    quoteRequests: 0,
    paidRequests: 0,
    signatures: 0,
    refreshes: 0,
    ids: 0,
    accepted: null as unknown,
    phases: [] as string[],
    attempts: [] as RegistrationAttempt[],
  };
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(options?.credentials, 'include');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.redirect, 'error');
    if (String(url) === '/api/v1/auth/session')
      return Response.json(
        { authenticated: true, address: state.session },
        { headers: { date: new Date(state.now).toUTCString() } },
      );
    assert.equal(url, '/api/v1/agents/register');
    assert.equal(options?.method, 'POST');
    const headers = new Headers(options?.headers);
    const body = JSON.parse(options?.body as string);
    const reservation = readSubmissionReservation(storage, payer, domain);
    if (headers.has('PAYMENT-SIGNATURE')) {
      state.paidRequests++;
      assert.equal(reservation?.phase, 'possibly_paid');
      assert.equal(headers.get('X-Turnstile-Pass'), 'fixture-pass');
      assert.equal(body.turnstileToken, undefined);
      assert.equal(body.wallet, payer);
      return Response.json(
        {
          registrationId: 'registration',
          statusUrl: '/api/v1/registrations/registration',
          status: 'processing',
          domain,
          paymentStatus: 'settled',
          pollAfterSeconds: 5,
        },
        { status: 202 },
      );
    }
    state.quoteRequests++;
    assert.equal(reservation?.phase, 'reserved');
    assert.ok(options?.signal);
    return Response.json(
      { accepts: [{ amount: '1000000' }] },
      { status: 402, headers: { 'X-Turnstile-Pass': 'fixture-pass' } },
    );
  };
  const dependencies: RegistrationSubmissionDependencies = {
    storage,
    lock: locks.lock,
    fetcher,
    now: () => state.now,
    randomId: () => `fixture-${++state.ids}`,
    currentWallet: () => state.wallet,
    refreshTracking: async () => {
      state.refreshes++;
      return true;
    },
    hasPurchase: () => state.existing,
    createPaymentHeaders: async () => {
      state.signatures++;
      assert.equal(readSubmissionReservation(storage, payer, domain)?.phase, 'reserved');
      return { 'PAYMENT-SIGNATURE': 'SYNTHETIC_AUTHORIZATION_NEVER_STORE' };
    },
    isSignatureCancellation: (error) => (error as { code?: number }).code === 4001,
    remember: (attempt) => {
      state.attempts.push(attempt);
      storage.setItem(`${ATTEMPT_PREFIX}${attempt.clientId}`, JSON.stringify(attempt));
    },
    accept: (_attempt, accepted) => {
      state.accepted = accepted;
    },
    onPhase: (phase) => {
      state.phases.push(phase);
    },
  };
  return { state, dependencies, storage, locks };
}

test('hook execution helper reserves before signing, rechecks after signing, and sends one guarded paid POST', async () => {
  const { state, dependencies, storage } = fixture();
  const result = await runRegistrationSubmission(input, dependencies);
  assert.equal(result.kind, 'tracking');
  assert.equal(result.accepted?.registrationId, 'registration');
  assert.equal(state.quoteRequests, 1);
  assert.equal(state.paidRequests, 1);
  assert.equal(state.refreshes, 2);
  assert.deepEqual(state.phases, ['preparing', 'awaiting-signature', 'processing']);
  assert.equal(readSubmissionReservation(storage, payer, domain)?.phase, 'possibly_paid');
  for (const value of storage.values.values())
    assert.doesNotMatch(
      value,
      /SYNTHETIC_AUTHORIZATION|PAYMENT-SIGNATURE|fixture-turnstile|fixture-pass/,
    );
  assert.deepEqual(Object.keys(state.attempts[0]!).sort(), ['clientId', 'domain', 'wallet']);
});

test('simultaneous tabs cannot sign or submit twice; a later reload never automatically pays again', async () => {
  const storage = new MemoryStorage();
  const locks = new MemoryLocks();
  const first = fixture(storage, locks);
  const second = fixture(storage, locks);
  const signing = deferred<void>();
  const release = deferred<Record<string, string>>();
  first.dependencies.createPaymentHeaders = async () => {
    signing.resolve();
    return release.promise;
  };
  const submission = runRegistrationSubmission(input, first.dependencies);
  await signing.promise;
  await assert.rejects(
    runRegistrationSubmission(input, second.dependencies),
    (error) => error instanceof RegistrationSubmissionError && error.code === 'CHECKOUT_BUSY',
  );
  assert.equal(second.state.quoteRequests, 0);
  assert.equal(second.state.signatures, 0);
  release.resolve({ 'PAYMENT-SIGNATURE': 'fixture' });
  await submission;
  const reloaded = fixture(storage, locks);
  await assert.rejects(
    runRegistrationSubmission(input, reloaded.dependencies),
    (error) => error instanceof RegistrationSubmissionError && error.code === 'EXISTING_SUBMISSION',
  );
  assert.equal(first.state.paidRequests, 1);
  assert.equal(second.state.paidRequests + reloaded.state.paidRequests, 0);
});

test('unsupported Web Locks and a busy native lock fail closed without storage or network work', async () => {
  const { state, dependencies, storage } = fixture();
  dependencies.lock = browserSubmissionLock(undefined);
  await assert.rejects(runRegistrationSubmission(input, dependencies), /LOCKS_UNAVAILABLE/);
  assert.equal(storage.length, 0);
  assert.equal(state.quoteRequests, 0);
  const native = {
    request: async (_key: string, options: unknown, callback: (value: null) => unknown) => {
      assert.deepEqual(options, { mode: 'exclusive', ifAvailable: true });
      return callback(null);
    },
  } as unknown as LockManager;
  dependencies.lock = browserSubmissionLock(native);
  await assert.rejects(runRegistrationSubmission(input, dependencies), /CHECKOUT_BUSY/);
});

test('explicit signature cancellation clears only this unsubmitted reservation', async () => {
  const { state, dependencies, storage } = fixture();
  storage.setItem('unrelated-key', 'preserve');
  dependencies.createPaymentHeaders = async () => {
    throw { code: 4001 };
  };
  await assert.rejects(runRegistrationSubmission(input, dependencies), /SIGNATURE_CANCELLED/);
  assert.equal(readSubmissionReservation(storage, payer, domain), null);
  assert.equal(state.paidRequests, 0);
  assert.equal(state.attempts.length, 0);
  assert.equal(storage.getItem('unrelated-key'), 'preserve');
});

test('cancel cleanup never deletes a possibly-paid reservation even if another writer changed it', async () => {
  const { dependencies, storage } = fixture();
  dependencies.createPaymentHeaders = async () => {
    const claim = readSubmissionReservation(storage, payer, domain)!;
    storage.setItem(
      submissionReservationKey(payer, domain),
      JSON.stringify({ ...claim, phase: 'possibly_paid', submittedAt: claim.createdAt }),
    );
    throw { code: 4001 };
  };
  await assert.rejects(runRegistrationSubmission(input, dependencies), /SIGNATURE_CANCELLED/);
  assert.equal(readSubmissionReservation(storage, payer, domain)?.phase, 'possibly_paid');
});

test('payer switch or a new existing purchase after wallet signing prevents payment transmission', async () => {
  for (const change of ['wallet', 'session', 'purchase'] as const) {
    const { state, dependencies, storage } = fixture();
    dependencies.createPaymentHeaders = async () => {
      if (change === 'wallet') state.wallet = other;
      if (change === 'session') state.session = other;
      if (change === 'purchase') state.existing = true;
      return { 'PAYMENT-SIGNATURE': 'fixture' };
    };
    await assert.rejects(runRegistrationSubmission(input, dependencies));
    assert.equal(state.paidRequests, 0, change);
    assert.equal(readSubmissionReservation(storage, payer, domain), null, change);
  }
});

test('post-sign durable placeholder check catches a legacy tab even when tracker memory is stale', async () => {
  const { state, dependencies, storage } = fixture();
  dependencies.createPaymentHeaders = async () => {
    storage.setItem(
      `${ATTEMPT_PREFIX}legacy`,
      JSON.stringify({ wallet: payer, domain, clientId: '1000000-legacy' }),
    );
    return { 'PAYMENT-SIGNATURE': 'fixture' };
  };
  await assert.rejects(runRegistrationSubmission(input, dependencies), /EXISTING_SUBMISSION/);
  assert.equal(state.paidRequests, 0);
  assert.ok(storage.getItem(`${ATTEMPT_PREFIX}legacy`));
});

test('a lost paid response stays sticky across arbitrary elapsed time and exposes bounded review', async () => {
  const { state, dependencies, storage } = fixture();
  const fetcher = dependencies.fetcher!;
  dependencies.fetcher = async (url, options) => {
    if (new Headers(options?.headers).has('PAYMENT-SIGNATURE')) {
      state.paidRequests++;
      throw new Error('Network lost');
    }
    return fetcher(url, options);
  };
  const result = await runRegistrationSubmission(input, dependencies);
  assert.equal(result.accepted, null);
  assert.equal(submissionReviewRequired(result.attempt, storage, result.reviewAfter - 1), false);
  assert.equal(submissionReviewRequired(result.attempt, storage, result.reviewAfter), true);
  state.now += 365 * 24 * 60 * 60 * 1000;
  await assert.rejects(runRegistrationSubmission(input, dependencies), /EXISTING_SUBMISSION/);
  assert.equal(state.paidRequests, 1);
});

test('unconfirmed deadline begins at transmission, never while a wallet signature is pending', async () => {
  const { state, dependencies, storage } = fixture();
  dependencies.createPaymentHeaders = async () => {
    state.now += 10 * SUBMISSION_REVIEW_AFTER_MS;
    const claim = readSubmissionReservation(storage, payer, domain)!;
    assert.equal(submissionReviewRequired(claim, storage, state.now), false);
    return { 'PAYMENT-SIGNATURE': 'fixture' };
  };
  const result = await runRegistrationSubmission(input, dependencies);
  const claim = readSubmissionReservation(storage, payer, domain)!;
  assert.equal(claim.submittedAt, state.now);
  assert.equal(result.reviewAfter, state.now + SUBMISSION_REVIEW_AFTER_MS);
  assert.equal(submissionReviewRequired(result.attempt, storage, state.now), false);
});

test('hung preparation fetch and hung preparation response bodies obey the same deadline', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  for (const hang of ['fetch', 'body'] as const) {
    const { state, dependencies, storage } = fixture();
    const fetcher = dependencies.fetcher!;
    const started = deferred<void>();
    let signal: AbortSignal | null | undefined;
    dependencies.fetcher = async (url, options) => {
      if (String(url).includes('/auth/')) return fetcher(url, options);
      signal = options?.signal;
      started.resolve();
      if (hang === 'fetch') return new Promise<Response>(() => {});
      return new Response(new ReadableStream(), { status: 402 });
    };
    const submission = runRegistrationSubmission(input, dependencies);
    await started.promise;
    context.mock.timers.tick(SUBMISSION_REQUEST_TIMEOUT_MS);
    await assert.rejects(submission, /PREPARATION_TIMEOUT/);
    assert.equal(signal?.aborted, true);
    assert.equal(state.signatures, 0);
    assert.equal(state.paidRequests, 0);
    assert.equal(readSubmissionReservation(storage, payer, domain), null);
  }
});

test('failed storage or corrupt reservation never permits a new payment', async () => {
  const first = fixture();
  first.storage.setItem = () => {
    throw new Error('Quota');
  };
  await assert.rejects(runRegistrationSubmission(input, first.dependencies), /STORAGE_UNAVAILABLE/);
  assert.equal(first.state.quoteRequests, 0);
  const second = fixture();
  second.storage.setItem(submissionReservationKey(payer, domain), '{');
  await assert.rejects(
    runRegistrationSubmission(input, second.dependencies),
    /STORAGE_UNAVAILABLE/,
  );
  assert.equal(second.state.signatures, 0);
});

test('failed remember or UI notification after possibly-paid transition cannot report an unpaid outcome', async () => {
  const { dependencies, storage, state } = fixture();
  dependencies.remember = () => {
    throw new Error('Storage unavailable');
  };
  dependencies.onAttempt = () => {
    throw new Error('Unmounted view');
  };
  const result = await runRegistrationSubmission(input, dependencies);
  assert.equal(result.kind, 'tracking');
  assert.equal(result.accepted, null);
  assert.equal(readSubmissionReservation(storage, payer, domain)?.phase, 'possibly_paid');
  assert.equal(state.paidRequests, 0);
});

test('reserved-only abandoned claim may be reclaimed only by a new explicit call holding the lock', async () => {
  const { dependencies, storage, state } = fixture();
  storage.setItem(
    submissionReservationKey(payer, domain),
    JSON.stringify({
      version: 1,
      wallet: payer,
      domain,
      clientId: '1000-abandoned',
      phase: 'reserved',
      createdAt: 1000,
      reviewAfter: 1000 + SUBMISSION_REVIEW_AFTER_MS,
    }),
  );
  assert.equal(state.paidRequests, 0);
  await runRegistrationSubmission(input, dependencies);
  assert.equal(state.paidRequests, 1);
  assert.notEqual(readSubmissionReservation(storage, payer, domain)?.clientId, '1000-abandoned');
});

test('fresh payer-attested cached read can satisfy spaced refresh but never substitutes for SIWE checks', async () => {
  const { state, dependencies } = fixture();
  dependencies.refreshTracking = async () => false;
  dependencies.isTrackingReadyForPayer = () => true;
  await runRegistrationSubmission(input, dependencies);
  assert.equal(state.paidRequests, 1);
  const otherFixture = fixture();
  otherFixture.dependencies.refreshTracking = async () => false;
  otherFixture.dependencies.isTrackingReadyForPayer = () => true;
  otherFixture.state.session = other;
  await assert.rejects(
    runRegistrationSubmission(input, otherFixture.dependencies),
    /PAYER_CHANGED/,
  );
  assert.equal(otherFixture.state.paidRequests, 0);
});

test('reservation keys isolate payers and domains, and legacy unknown attempts escalate without being deleted', () => {
  assert.notEqual(submissionReservationKey(payer, domain), submissionReservationKey(other, domain));
  assert.notEqual(
    submissionReservationKey(payer, domain),
    submissionReservationKey(payer, 'second.example'),
  );
  assert.equal(
    submissionReviewRequired(
      { wallet: payer, domain, clientId: '1000-legacy' },
      new MemoryStorage(),
      121000,
    ),
    true,
  );
});

// Execute the real hook with a small hook dispatcher and mocked wallet/provider boundaries.
// The submission engine, lock adapter, storage transitions and fetch sequence remain real.
function hookHarness(current: ReturnType<typeof fixture>) {
  const require = createRequire(import.meta.url);
  const { transformSync } = createRequire(require.resolve('tsx/package.json'))('esbuild') as {
    transformSync(source: string, options: object): { code: string };
  };
  const source = readFileSync(
    new URL('../src/hooks/use-register-agent.ts', import.meta.url),
    'utf8',
  );
  const compiled = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' });
  let cursor = 0;
  const slots: unknown[] = [];
  const effects = new Set<{ cleanup?: void | (() => void) }>();
  const client = () => ({ account: { address: current.state.wallet } });
  const modules: Record<string, unknown> = {
    react: {
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [
          slots[index],
          (value: unknown) => {
            slots[index] =
              typeof value === 'function'
                ? (value as (previous: unknown) => unknown)(slots[index])
                : value;
          },
        ];
      },
      useRef(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useEffect(callback: () => void | (() => void), deps: unknown[]) {
        const index = cursor++;
        const previous = slots[index] as
          { deps: unknown[]; cleanup?: void | (() => void) } | undefined;
        if (
          previous &&
          previous.deps.length === deps.length &&
          deps.every((value, position) => Object.is(value, previous.deps[position]))
        )
          return;
        previous?.cleanup?.();
        if (previous) effects.delete(previous);
        const effect = { deps, cleanup: callback() };
        slots[index] = effect;
        effects.add(effect);
      },
    },
    wagmi: {
      useAccount: () => ({ address: current.state.wallet }),
      useConfig: () => ({}),
      useWalletClient: () => ({ data: client(), isLoading: false, isFetching: false }),
    },
    'wagmi/actions': {
      getAccount: () => ({ address: current.state.wallet }),
      getWalletClient: async () => client(),
    },
    '@agentdomain/shared': { USDC_DECIMALS: 6 },
    '@agentdomain/sdk': {
      createX402PaymentHeaders: (response: Response) =>
        current.dependencies.createPaymentHeaders(response),
    },
    '@/lib/base-chain': {
      BASE_MAINNET_CHAIN_ID: 8453,
      BaseChainRequiredError: class extends Error {},
      isBaseChainMismatchError: () => false,
      isBaseChainRequiredError: () => false,
    },
    '@/hooks/use-base-chain': { useBaseChainGuard: () => ({ ensureBaseChain: async () => true }) },
    '@/lib/transaction-errors': {
      getTransactionErrorCopy: (error: unknown) => ({
        kind: current.dependencies.isSignatureCancellation(error) ? 'cancelled' : 'error',
      }),
    },
    '@/components/register/registration-tracker-provider': {
      useRegistrationSnapshot: () => ({}),
      useRegistrationTracker: () => ({
        refresh: current.dependencies.refreshTracking,
        isReadyForPayer: current.dependencies.isTrackingReadyForPayer ?? (() => false),
        hasPurchase: current.dependencies.hasPurchase,
        remember: current.dependencies.remember,
        accept: current.dependencies.accept,
        matches: () => undefined,
        getAcceptance: () => current.state.accepted ?? undefined,
      }),
    },
    '@/lib/registration-submission': submissionModule,
  };
  const compiledModule = {
    exports: {} as {
      useRegisterAgent: typeof import('../src/hooks/use-register-agent').useRegisterAgent;
    },
  };
  runInNewContext(compiled.code, {
    module: compiledModule,
    exports: compiledModule.exports,
    Date,
    require(name: string) {
      assert.ok(name in modules, `Unexpected hook dependency: ${name}`);
      return modules[name];
    },
    window: {
      localStorage: current.storage,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    },
    navigator: {
      locks: {
        request: (key: string, _options: object, operation: (lock: object) => Promise<unknown>) =>
          current.locks.lock(key, () => operation({ name: key })),
      },
    },
  });
  return {
    render: () => {
      cursor = 0;
      return compiledModule.exports.useRegisterAgent();
    },
    dispose: () => {
      for (const effect of effects) effect.cleanup?.();
    },
  };
}

test('actual hook escalates a lost submission after 120s, isolates payer state and never repays after reset/reload', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const current = fixture();
  const fetcher = current.dependencies.fetcher!;
  context.mock.method(
    globalThis,
    'fetch',
    async (url: Parameters<typeof fetch>[0], options?: RequestInit) => {
      if (new Headers(options?.headers).has('PAYMENT-SIGNATURE')) {
        current.state.paidRequests++;
        throw new Error('Connection lost');
      }
      return fetcher(url, options);
    },
  );
  const hook = hookHarness(current);
  const params = input.body as Parameters<ReturnType<typeof hook.render>['register']>[0];
  try {
    await hook.render().register(params);
    assert.equal(hook.render().state.phase, 'processing');
    context.mock.timers.tick(SUBMISSION_REVIEW_AFTER_MS - 1);
    assert.equal(hook.render().state.phase, 'processing');
    context.mock.timers.tick(1);
    assert.equal(hook.render().state.phase, 'action-required');
    assert.equal(hook.render().state.messageCode, 'SUBMISSION_UNCONFIRMED');
    current.state.wallet = other;
    assert.equal(hook.render().state.phase, 'idle');
    assert.equal(hook.render().state.message, undefined);
    current.state.wallet = payer;
    hook.render().reset();
    assert.equal(hook.render().state.phase, 'idle');
    await hook.render().register(params);
    assert.equal(hook.render().state.phase, 'action-required');
    const reloaded = hookHarness(current);
    try {
      await reloaded.render().register(params);
      assert.equal(reloaded.render().state.phase, 'action-required');
    } finally {
      reloaded.dispose();
    }
    assert.equal(current.state.paidRequests, 1);
    assert.equal(current.state.signatures, 1);
    assert.equal(readSubmissionReservation(current.storage, payer, domain)?.phase, 'possibly_paid');
  } finally {
    hook.dispose();
  }
});

test('actual hook cancellation returns to idle and post-sign wallet changes cannot transmit payment', async (context) => {
  for (const change of ['cancel', 'wallet'] as const) {
    const current = fixture();
    context.mock.method(globalThis, 'fetch', current.dependencies.fetcher!);
    current.dependencies.createPaymentHeaders = async () => {
      if (change === 'cancel') throw { code: 4001 };
      current.state.wallet = other;
      return { 'PAYMENT-SIGNATURE': 'fixture' };
    };
    const hook = hookHarness(current);
    const params = input.body as Parameters<ReturnType<typeof hook.render>['register']>[0];
    try {
      const registration = hook.render().register(params);
      if (change === 'cancel') {
        await registration;
        assert.equal(hook.render().state.phase, 'idle');
        assert.match(hook.render().state.message ?? '', /cancelled/);
      } else {
        await assert.rejects(registration, /not submitted/);
        assert.equal(hook.render().state.phase, 'idle');
      }
      assert.equal(current.state.paidRequests, 0);
      assert.equal(readSubmissionReservation(current.storage, payer, domain), null);
    } finally {
      hook.dispose();
    }
  }
});

test('actual hook does not label confirmed acceptance as an unconfirmed submission while status is unavailable', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const current = fixture();
  context.mock.method(globalThis, 'fetch', current.dependencies.fetcher!);
  const hook = hookHarness(current);
  const params = input.body as Parameters<ReturnType<typeof hook.render>['register']>[0];
  try {
    await hook.render().register(params);
    assert.equal(hook.render().state.phase, 'processing');
    context.mock.timers.tick(SUBMISSION_REVIEW_AFTER_MS + 1);
    assert.equal(hook.render().state.phase, 'processing');
    assert.equal(hook.render().state.messageCode, undefined);
    assert.equal(current.state.paidRequests, 1);
    assert.equal(current.state.signatures, 1);
  } finally {
    hook.dispose();
  }
});
