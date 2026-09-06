import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ATTEMPT_PREFIX,
  COMPLETION_PREFIX,
  REGISTRATION_NOTICE_PREFIX,
  REGISTRATION_POLL_MS,
  REGISTRATION_PAGE_SIZE,
  REGISTRATION_LIST_PAGES_PER_POLL,
  REGISTRATION_DETAILS_PER_POLL,
  REGISTRATION_MAX_DISCOVERY_OFFSET,
  REGISTRATION_MAX_POLL_MS,
  REGISTRATION_BACKOFF_PREFIX,
  RegistrationReadError,
  registrationRead,
  registrationRetryAfterMs,
  canAdvanceRegistration,
  registrationProgressSchema,
  registrationAcceptedSchema,
  registrationCopy,
  registrationEstimateCopy,
  registrationPaymentStatus,
  registrationNoticeEligible,
  registrationStageLabel,
  matchAttempt,
  durationLabel,
  submitPaidRegistration,
  type RegistrationAttempt,
  type RegistrationProgress,
} from '../src/lib/registration-progress';
import { RegistrationTracker } from '../src/lib/registration-tracker';
import {
  REGISTRATION_SUBMISSION_PREFIX,
  SUBMISSION_REVIEW_AFTER_MS,
} from '../src/lib/registration-submission';

const payer = `0x${'1'.repeat(40)}`;
const recipient = `0x${'2'.repeat(40)}`;
const startedAt = '2026-09-06T10:00:00.000Z';
const attempt: RegistrationAttempt = {
  wallet: payer,
  domain: 'example.test',
  clientId: `${Date.parse(startedAt)}-synthetic`,
};
const progress = (overrides: Partial<RegistrationProgress> = {}): RegistrationProgress => ({
  registrationId: 'registration-1',
  statusUrl: '/api/v1/registrations/registration-1',
  domain: attempt.domain,
  agentId: null,
  status: 'processing',
  paymentStatus: 'settled',
  stage: 'dns',
  messageCode: 'DNS_PROPAGATION_PENDING',
  startedAt,
  updatedAt: startedAt,
  completedAt: null,
  revision: 1,
  estimatedDurationSeconds: null,
  pollAfterSeconds: 5,
  completionEventId: null,
  ...(overrides.status === 'completed' ? { agentId: 'agent-1', stage: 'complete' as const } : {}),
  ...(overrides.status === 'refunded' ? { paymentStatus: 'refunded' as const } : {}),
  ...overrides,
});
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'X-Authenticated-Wallet': payer, ...headers },
  });

const clocks = new WeakMap<RegistrationTracker, { now: number }>();
function createTracker(options: ConstructorParameters<typeof RegistrationTracker>[0]) {
  const clock = { now: Date.parse(startedAt) };
  const tracker = new RegistrationTracker({ now: () => clock.now, random: () => 0, ...options });
  clocks.set(tracker, clock);
  return tracker;
}
async function poll(tracker: RegistrationTracker) {
  clocks.get(tracker)!.now += tracker.getNextPollDelay();
  return tracker.refresh();
}
const payerQuery = `expectedPayer=${payer}`;

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
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
}

function fixture(
  storage = new MemoryStorage(),
  options: Pick<
    ConstructorParameters<typeof RegistrationTracker>[0],
    'canNotify' | 'lock' | 'onResolved'
  > = {},
) {
  const backend = {
    session: payer,
    items: [progress()],
    status: 200,
    calls: [] as string[],
    online: true,
  };
  const completed: string[] = [];
  const resolved: string[][] = [];
  const fetcher: typeof fetch = async (url, options) => {
    const path = String(url);
    backend.calls.push(path);
    assert.equal(options?.credentials, 'include');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.method, undefined);
    assert.deepEqual(options?.headers, { Accept: 'application/json' });
    if (path === '/api/v1/auth/session')
      return json({ authenticated: true, address: backend.session });
    if (backend.status !== 200) return json({ message: 'PRIVATE_PROVIDER_ERROR' }, backend.status);
    if (new URL(path, 'https://example.test').pathname === '/api/v1/registrations')
      return json({ items: backend.items, hasMore: false, total: backend.items.length });
    return json(
      backend.items.find(
        (item) => item.statusUrl === new URL(path, 'https://example.test').pathname,
      ),
    );
  };
  const tracker = createTracker({
    storage,
    fetcher,
    online: () => backend.online,
    onCompleted: (item) => completed.push(item.registrationId),
    onResolved: (items) => resolved.push(items.map((item) => item.registrationId)),
    ...options,
  });
  return { storage, backend, completed, resolved, tracker };
}

async function connect(tracker: RegistrationTracker, wallet = payer) {
  tracker.setExpectedWallet(wallet);
  await tracker.refresh();
}

test('progress DTO projects public fields, supports operator polling, and rejects unsafe status URLs', () => {
  const item = registrationProgressSchema.parse({
    ...progress({ pollAfterSeconds: 30, status: 'action_required' }),
    providerError: 'PRIVATE_PROVIDER_ERROR',
    metadata: { secret: 'secret' },
  });
  assert.equal(item.pollAfterSeconds, 30);
  assert.doesNotMatch(JSON.stringify(item), /PRIVATE_PROVIDER_ERROR|secret/);
  for (const statusUrl of [
    'https://other.test/api/v1/registrations/registration-1',
    '//other.test',
    '/api/v1/registrations/other',
    '/api/v1/registrations/../admin',
  ]) {
    assert.equal(registrationProgressSchema.safeParse({ ...progress(), statusUrl }).success, false);
  }
  assert.equal(REGISTRATION_POLL_MS, 5000);
  assert.equal(REGISTRATION_PAGE_SIZE, 20);
  assert.equal(REGISTRATION_LIST_PAGES_PER_POLL, 2);
  assert.equal(REGISTRATION_DETAILS_PER_POLL, 2);
  assert.equal(REGISTRATION_MAX_DISCOVERY_OFFSET, 10_000);
});

test('only reviewed message codes reach copy; no code can fabricate completion', () => {
  assert.equal(registrationCopy(progress()), 'Waiting for DNS propagation');
  for (const messageCode of [
    'PRIVATE_PROVIDER_ERROR',
    '__proto__',
    'REGISTRATION_COMPLETED',
    'REGISTRATION_REFUNDED',
  ]) {
    assert.equal(
      registrationCopy(progress({ messageCode })),
      'Registration is processing. Checking for an update.',
    );
  }
  assert.equal(registrationCopy(progress({ status: 'completed' })), 'Registration complete');
  assert.equal(durationLabel(125), '2m 5s');
  assert.equal(progress().estimatedDurationSeconds, null);
});

test('lost-response matching requires domain and attempt time, and refuses ambiguous purchases', () => {
  const old = progress({ startedAt: '2026-09-05T10:00:00.000Z' });
  assert.equal(matchAttempt(attempt, [old]), undefined);
  assert.equal(matchAttempt(attempt, [progress({ domain: 'another.test' })]), undefined);
  assert.equal(matchAttempt(attempt, [old, progress()])?.registrationId, 'registration-1');
  assert.equal(
    matchAttempt(attempt, [progress(), progress({ registrationId: 'registration-2' })]),
    undefined,
  );
});

test('every reported stage has a public label independent of retry or unknown messages', () => {
  const labels = {
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
  for (const [stage, label] of Object.entries(labels)) {
    const item = progress({ stage: stage as RegistrationProgress['stage'] });
    assert.equal(registrationStageLabel(item.stage), label);
    assert.doesNotMatch(
      registrationCopy({ ...item, messageCode: 'PRIVATE_PROVIDER_ERROR' }),
      /PRIVATE_PROVIDER_ERROR|Registration complete/,
    );
  }
});

test('timing stays indicative and never fabricates an estimate without server data', () => {
  for (const estimate of [undefined, null])
    assert.equal(registrationEstimateCopy(estimate, 600), 'Timing varies; no estimate available.');
  assert.equal(registrationEstimateCopy(125, 60), 'Estimated setup: about 2m 5s. Timing varies.');
  assert.equal(
    registrationEstimateCopy(125, 126),
    'Estimated setup: about 2m 5s. Timing varies. Taking longer than estimated.',
  );
});

test('unknown historical status stays neutral without suppressing old settled work or assuming payment', () => {
  const unknown = progress({
    startedAt: '2026-05-23T10:00:00.000Z',
    paymentStatus: 'unknown',
    status: 'action_required',
    stage: 'payment',
    messageCode: 'PAYMENT_CONFIRMATION_REQUIRED',
  });
  assert.equal(registrationNoticeEligible(unknown), false);
  assert.equal(registrationPaymentStatus(unknown), 'unknown');
  assert.equal(
    registrationCopy(unknown),
    'Registration status needs verification. Do not pay again.',
  );
  assert.equal(registrationNoticeEligible({ ...unknown, paymentStatus: 'settled' }), true);
  assert.equal(registrationNoticeEligible({ ...unknown, paymentStatus: 'pending' }), true);
  assert.equal(
    registrationNoticeEligible(),
    true,
    'a locally saved lost response remains discoverable',
  );
  const accepted = registrationAcceptedSchema.parse({
    registrationId: unknown.registrationId,
    statusUrl: unknown.statusUrl,
    domain: unknown.domain,
    status: 'processing',
    paymentStatus: 'settled',
    pollAfterSeconds: 5,
  });
  assert.equal(registrationNoticeEligible(unknown, accepted), true);
  assert.equal(registrationPaymentStatus(unknown, accepted), 'settled');
});

test('dismissal survives polling/remount and remains payer-scoped without touching replay protection', async () => {
  const { tracker, storage } = fixture();
  tracker.remember(attempt);
  await connect(tracker);
  const reservationKey = `${REGISTRATION_SUBMISSION_PREFIX}${payer}:${attempt.domain}`;
  const reservation = JSON.stringify({ phase: 'possibly_paid', clientId: attempt.clientId });
  storage.setItem(reservationKey, reservation);
  const attemptKey = `${ATTEMPT_PREFIX}${attempt.clientId}`;
  const originalAttempt = storage.getItem(attemptKey);
  const originalItems = tracker.getSnapshot().items;
  tracker.dismissNotices([attempt]);
  assert.equal(tracker.isNoticeDismissed(attempt), true);
  assert.equal(tracker.hasPurchase(payer, attempt.domain), true);
  assert.deepEqual(tracker.getSnapshot().items, originalItems);
  await poll(tracker);
  assert.equal(tracker.isNoticeDismissed(attempt), true);
  const restored = fixture(storage);
  await connect(restored.tracker);
  assert.equal(restored.tracker.isNoticeDismissed(attempt), true);
  assert.equal(restored.tracker.hasPurchase(payer, attempt.domain), true);
  assert.equal(storage.getItem(attemptKey), originalAttempt);
  assert.equal(storage.getItem(reservationKey), reservation);
  const otherAttempt = {
    ...attempt,
    wallet: recipient,
    clientId: `${Date.parse(startedAt)}-other`,
  };
  restored.tracker.dismissNotices([otherAttempt]);
  assert.equal(restored.tracker.isNoticeDismissed(otherAttempt), false);
  await connect(restored.tracker, recipient);
  restored.tracker.remember(otherAttempt);
  assert.equal(restored.tracker.isNoticeDismissed(otherAttempt), false);
  restored.tracker.dismissNotices([otherAttempt]);
  assert.equal(restored.tracker.isNoticeDismissed(otherAttempt), true);
  await connect(restored.tracker, payer);
  assert.equal(restored.tracker.isNoticeDismissed(attempt), true);
  const newAttempt = { ...attempt, clientId: `${Date.parse(startedAt)}-new` };
  restored.tracker.remember(newAttempt);
  assert.equal(restored.tracker.isNoticeDismissed(newAttempt), false);
});

test('dismissal does not acknowledge completion; terminal reconciliation prunes only its presentation marker', async () => {
  const { tracker, backend, storage, completed } = fixture();
  tracker.remember(attempt);
  await connect(tracker);
  tracker.dismissNotices([attempt]);
  const noticeKey = `${REGISTRATION_NOTICE_PREFIX}${payer}:${attempt.clientId}`;
  assert.equal(storage.getItem(noticeKey), 'dismissed');
  assert.equal(storage.getItem(`${COMPLETION_PREFIX}${payer}:registration-1`), null);
  backend.items = [progress({ status: 'completed', revision: 2 })];
  await poll(tracker);
  assert.deepEqual(completed, ['registration-1']);
  assert.equal(storage.getItem(noticeKey), null);
  assert.equal(tracker.getSnapshot().attempts.length, 0);
});

test('settled legacy completion with no workflow timestamp or event creates no false pending attempt', async () => {
  const { tracker, backend, completed } = fixture();
  backend.items = [
    progress({
      status: 'completed',
      startedAt: '2026-05-23T10:00:00.000Z',
      updatedAt: '2026-05-23T10:00:00.000Z',
      revision: 0,
      completedAt: null,
      completionEventId: null,
    }),
  ];
  await connect(tracker);
  await poll(tracker);
  assert.equal(tracker.getSnapshot().items[0].status, 'completed');
  assert.equal(tracker.getSnapshot().attempts.length, 0);
  assert.deepEqual(completed, []);
});

test('authoritative legacy completion can replace unknown review at the same revision and timestamps only with coherent evidence', async () => {
  const { tracker, backend, completed, resolved } = fixture();
  const legacy = progress({
    status: 'action_required',
    paymentStatus: 'unknown',
    stage: 'payment',
    agentId: 'legacy-agent',
    messageCode: 'PAYMENT_CONFIRMATION_REQUIRED',
    startedAt: '2026-05-23T10:00:00.000Z',
    updatedAt: '2026-05-23T10:00:00.000Z',
    revision: 0,
  });
  const recovered = {
    ...legacy,
    status: 'completed' as const,
    paymentStatus: 'settled' as const,
    stage: 'complete' as const,
    messageCode: 'REGISTRATION_COMPLETED',
    completionEventId: 'registration-1:completed',
  };
  assert.equal(registrationProgressSchema.safeParse(recovered).success, true);
  assert.equal(canAdvanceRegistration(legacy, recovered), true);
  for (const patch of [
    { paymentStatus: 'unknown' as const },
    { stage: 'payment' as const },
    { agentId: null },
    { agentId: 'unrelated-agent' },
    { domain: 'unrelated.test' },
    { registrationId: 'unrelated' },
    { startedAt },
    { updatedAt: '2026-05-22T10:00:00.000Z' },
  ])
    assert.equal(canAdvanceRegistration(legacy, { ...recovered, ...patch }), false);
  assert.equal(canAdvanceRegistration({ ...legacy, paymentStatus: 'refunded' }, recovered), false);
  assert.equal(
    canAdvanceRegistration(progress(), {
      ...progress(),
      status: 'completed',
      agentId: 'agent-1',
      stage: 'complete',
    }),
    false,
  );
  backend.items = [legacy];
  await connect(tracker);
  assert.equal(tracker.getSnapshot().attempts.length, 1);
  backend.items = [recovered];
  await poll(tracker);
  await poll(tracker);
  assert.equal(tracker.getSnapshot().attempts.length, 0);
  assert.deepEqual(completed, ['registration-1']);
  assert.deepEqual(resolved, [['registration-1']]);
  backend.items = [legacy];
  await poll(tracker);
  assert.equal(tracker.getSnapshot().items[0].status, 'completed');
  assert.equal(tracker.getSnapshot().attempts.length, 0);
});

test('settled legacy finalizing projection promotes at identical revision/time without admitting other prior states or rollback', async () => {
  const { tracker, backend, completed, resolved } = fixture();
  const legacy = progress({
    status: 'processing',
    paymentStatus: 'settled',
    stage: 'finalizing',
    messageCode: 'REGISTRATION_PROCESSING',
    agentId: 'legacy-finalizing-agent',
    startedAt: '2026-08-18T10:00:00.000Z',
    updatedAt: '2026-08-18T10:01:00.000Z',
    revision: 0,
    completedAt: null,
    completionEventId: null,
  });
  const recovered = {
    ...legacy,
    status: 'completed' as const,
    stage: 'complete' as const,
    messageCode: 'REGISTRATION_COMPLETED',
    completionEventId: 'registration-1:completed',
  };
  for (const completedAt of [null, legacy.updatedAt]) {
    const next = { ...recovered, completedAt };
    assert.equal(registrationProgressSchema.safeParse(next).success, true);
    assert.equal(canAdvanceRegistration(legacy, next), true);
  }
  for (const stage of [
    'payment',
    'domain',
    'dns',
    'ssl',
    'email',
    'basename',
    'ens',
    'mint',
    'complete',
  ] as const)
    assert.equal(canAdvanceRegistration({ ...legacy, stage }, recovered), false);
  for (const paymentStatus of ['unknown', 'pending', 'not_charged', 'refunded'] as const)
    assert.equal(canAdvanceRegistration({ ...legacy, paymentStatus }, recovered), false);
  for (const status of ['action_required', 'failed', 'refunded', 'awaiting_payment'] as const)
    assert.equal(canAdvanceRegistration({ ...legacy, status }, recovered), false);
  for (const patch of [
    { agentId: null },
    { messageCode: 'REGISTRATION_RETRY_SCHEDULED' },
    { completedAt: legacy.updatedAt },
    { completionEventId: 'registration-1:completed' },
  ])
    assert.equal(canAdvanceRegistration({ ...legacy, ...patch }, recovered), false);
  assert.equal(
    canAdvanceRegistration({ ...legacy, revision: 1 }, { ...recovered, revision: 1 }),
    false,
  );
  for (const patch of [
    { agentId: null },
    { agentId: 'different-agent' },
    { registrationId: 'different-registration' },
    { domain: 'different.test' },
    { startedAt },
    { revision: -1 },
    { updatedAt: legacy.startedAt },
    { status: 'processing' as const },
    { status: 'refunded' as const, paymentStatus: 'refunded' as const },
    { stage: 'finalizing' as const },
    { paymentStatus: 'unknown' as const },
    { paymentStatus: 'pending' as const },
    { paymentStatus: 'not_charged' as const },
    { paymentStatus: 'refunded' as const },
  ])
    assert.equal(canAdvanceRegistration(legacy, { ...recovered, ...patch }), false);
  assert.equal(canAdvanceRegistration(recovered, legacy), false);
  assert.equal(
    canAdvanceRegistration(recovered, {
      ...legacy,
      revision: 1,
      updatedAt: '2026-08-18T10:02:00.000Z',
    }),
    false,
  );
  assert.equal(
    canAdvanceRegistration(recovered, { ...recovered, completionEventId: 'different-completion' }),
    false,
  );
  backend.items = [legacy];
  await connect(tracker);
  assert.equal(tracker.getSnapshot().attempts.length, 1);
  backend.items = [recovered];
  await poll(tracker);
  await poll(tracker);
  assert.equal(tracker.getSnapshot().attempts.length, 0);
  assert.deepEqual(completed, ['registration-1']);
  assert.deepEqual(resolved, [['registration-1']]);
  backend.items = [legacy];
  await poll(tracker);
  assert.equal(tracker.getSnapshot().items[0].status, 'completed');
  assert.equal(tracker.getSnapshot().attempts.length, 0);
});

test('presentation storage failure dismisses in memory without weakening the saved purchase guard', async () => {
  const { tracker, storage } = fixture();
  tracker.remember(attempt);
  await connect(tracker);
  const original = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key.startsWith(REGISTRATION_NOTICE_PREFIX)) throw new Error('Storage denied');
    original(key, value);
  };
  tracker.dismissNotices([attempt]);
  await poll(tracker);
  assert.equal(tracker.isNoticeDismissed(attempt), true);
  assert.equal(tracker.hasPurchase(payer, attempt.domain), true);
  assert.ok(storage.getItem(`${ATTEMPT_PREFIX}${attempt.clientId}`));
});

test('confirmed acceptance notifies view subscribers immediately without inventing progress', async () => {
  const { tracker, backend, storage } = fixture();
  backend.items = [];
  await connect(tracker);
  tracker.remember(attempt);
  const accepted = registrationAcceptedSchema.parse({
    registrationId: 'registration-1',
    status: 'processing',
    statusUrl: progress().statusUrl,
    domain: attempt.domain,
    paymentStatus: 'settled',
    pollAfterSeconds: 5,
  });
  const before = tracker.getSnapshot();
  let updates = 0;
  tracker.subscribe(() => updates++);
  tracker.accept(attempt, accepted);
  assert.ok(updates > 0);
  assert.notEqual(tracker.getSnapshot(), before);
  assert.deepEqual(tracker.getAcceptance(attempt), accepted);
  assert.equal(tracker.matches(attempt), undefined);
  assert.equal(
    registrationCopy(tracker.matches(attempt), tracker.getAcceptance(attempt)),
    'Payment confirmed. Registration is processing.',
  );
  assert.equal(tracker.isSubmissionUnconfirmed(attempt, Date.parse(startedAt) + 600_000), false);
  assert.deepEqual(JSON.parse(storage.getItem(`${ATTEMPT_PREFIX}${attempt.clientId}`)!), attempt);
  await tracker.refresh();
  backend.status = 503;
  await poll(tracker);
  assert.deepEqual(tracker.getAcceptance(attempt), accepted);
  assert.equal(tracker.matches(attempt), undefined);
  assert.equal(tracker.getSnapshot().connection, 'unavailable');
  await connect(tracker, recipient);
  assert.equal(tracker.getAcceptance(attempt), undefined);
});

test('an unknown submission is never presented as confirmed payment', async () => {
  const { tracker, backend } = fixture();
  backend.items = [];
  await connect(tracker);
  tracker.remember(attempt);
  tracker.accept(attempt, null);
  assert.equal(tracker.getAcceptance(attempt), undefined);
  assert.equal(
    registrationCopy(tracker.matches(attempt), tracker.getAcceptance(attempt)),
    'Confirming payment and registration status. Do not pay again.',
  );
});

test('a confirmed receipt supersedes pending observations without masking explicit payment resolution', () => {
  const accepted = registrationAcceptedSchema.parse({
    registrationId: 'registration-1',
    status: 'processing',
    statusUrl: progress().statusUrl,
    domain: attempt.domain,
    paymentStatus: 'settled',
    pollAfterSeconds: 5,
  });
  for (const paymentStatus of ['unknown', 'pending'] as const) {
    const item = progress({ paymentStatus, stage: 'payment', messageCode: 'PAYMENT_PENDING' });
    assert.equal(registrationPaymentStatus(item, accepted), 'settled');
    assert.equal(
      registrationCopy(item, accepted),
      'Payment confirmed. Registration is processing.',
    );
    assert.equal(registrationPaymentStatus(item), paymentStatus);
  }
  for (const paymentStatus of ['refunded', 'not_charged', 'settled'] as const)
    assert.equal(registrationPaymentStatus(progress({ paymentStatus }), accepted), paymentStatus);
});

test('persisted attempts contain wallet/domain/clientId only, and storage failure blocks remembering', () => {
  const { tracker, storage } = fixture();
  tracker.remember(attempt);
  assert.deepEqual(JSON.parse(storage.getItem(`${ATTEMPT_PREFIX}${attempt.clientId}`)!), attempt);
  assert.throws(() =>
    tracker.remember({ ...attempt, paymentHeaders: 'secret' } as RegistrationAttempt),
  );
  const unavailable = new MemoryStorage();
  unavailable.setItem = () => {
    throw new Error('Storage denied');
  };
  assert.throws(() => createTracker({ storage: unavailable }).remember(attempt));
});

test('paid POST opts into async exactly once; transport, HTTP, and decode errors stay unknown', async () => {
  const accepted = {
    registrationId: 'registration-1',
    status: 'processing',
    statusUrl: progress().statusUrl,
    domain: attempt.domain,
    paymentStatus: 'settled',
    pollAfterSeconds: 5,
  };
  assert.equal(registrationAcceptedSchema.safeParse(accepted).success, true);
  for (const response of [
    null,
    json({ message: 'PRIVATE_PROVIDER_ERROR' }, 500),
    json({}, 402),
    json({}, 401),
    new Response('{', { status: 202 }),
    json({ ...accepted, paymentStatus: 'unknown' }, 202),
    json(progress(), 200),
    json(accepted, 202),
  ]) {
    let calls = 0;
    const result = await submitPaidRegistration(
      { domain: attempt.domain },
      { 'PAYMENT-SIGNATURE': 'SYNTHETIC_AUTHORIZATION' },
      null,
      async (url, options) => {
        calls++;
        assert.equal(url, '/api/v1/agents/register');
        assert.equal(options?.method, 'POST');
        assert.equal((options?.headers as Record<string, string>).Prefer, 'respond-async');
        assert.ok(options?.signal);
        if (!response) throw new Error('Lost connection');
        return response;
      },
    );
    assert.equal(calls, 1);
    if (result) assert.deepEqual(result, accepted);
  }
});

test('processing survives a new tracker after refresh and reconciles using payer list plus direct GET', async () => {
  const first = fixture();
  first.tracker.remember(attempt);
  const restored = fixture(first.storage);
  await connect(restored.tracker);
  assert.equal(restored.tracker.matches(attempt)?.status, 'processing');
  assert.deepEqual(restored.backend.calls, [
    '/api/v1/auth/session',
    `/api/v1/registrations?limit=20&offset=0&${payerQuery}`,
    `${progress().statusUrl}?${payerQuery}`,
  ]);
  assert.equal(restored.tracker.hasPurchase(payer, attempt.domain), true);
  assert.deepEqual(restored.completed, []);
});

test('unknown outcomes stay persisted when the list is empty; no fresh POST is attempted', async () => {
  const { tracker, backend, storage } = fixture();
  backend.items = [];
  tracker.remember(attempt);
  await connect(tracker);
  assert.equal(tracker.matches(attempt), undefined);
  assert.equal(tracker.hasPurchase(payer, attempt.domain), true);
  assert.ok(storage.getItem(`${ATTEMPT_PREFIX}${attempt.clientId}`));
  assert.equal(
    backend.calls.some((path) => path.includes('/agents/register')),
    false,
  );
});

test('offline, HTTP failures, and auth expiry preserve last progress without failure or completion', async () => {
  const { tracker, backend, completed } = fixture();
  tracker.remember(attempt);
  await connect(tracker);
  for (const status of [401, 403, 404, 429, 500, 503]) {
    backend.status = status;
    await poll(tracker);
    assert.equal(tracker.matches(attempt)?.status, 'processing');
    assert.equal(tracker.getSnapshot().attempts.length, 1);
    assert.equal(
      tracker.getSnapshot().connection,
      status === 401 || status === 403 ? 'unauthorized' : 'unavailable',
    );
  }
  backend.online = false;
  const calls = backend.calls.length;
  await poll(tracker);
  assert.equal(backend.calls.length, calls);
  assert.equal(tracker.getSnapshot().connection, 'offline');
  assert.deepEqual(completed, []);
});

test('no status GET is allowed without a connected payer matching SIWE', async () => {
  const { tracker, backend } = fixture();
  await poll(tracker);
  assert.deepEqual(backend.calls, []);
  backend.session = recipient;
  await connect(tracker);
  assert.deepEqual(backend.calls, ['/api/v1/auth/session']);
  assert.equal(tracker.getSnapshot().connection, 'unauthorized');
});

test('wallet change clears view immediately and ignores a stale response from the previous payer', async () => {
  let session = payer;
  let resolveOld!: (response: Response) => void;
  let oldSignal: AbortSignal | null | undefined;
  let listStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    listStarted = resolve;
  });
  const tracker = createTracker({
    storage: new MemoryStorage(),
    fetcher: async (url, options) => {
      if (String(url).includes('/auth/')) return json({ authenticated: true, address: session });
      if (session === payer) {
        oldSignal = options?.signal;
        listStarted();
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return json({ items: [], total: 0, hasMore: false });
    },
  });
  tracker.remember(attempt);
  tracker.setExpectedWallet(payer);
  const old = tracker.refresh();
  await started;
  session = recipient;
  tracker.setExpectedWallet(recipient);
  assert.equal(tracker.getSnapshot().wallet, recipient);
  assert.deepEqual(tracker.getSnapshot().items, []);
  assert.deepEqual(tracker.getSnapshot().attempts, []);
  assert.equal(oldSignal?.aborted, true);
  await poll(tracker);
  resolveOld(json({ items: [progress({ status: 'completed' })], total: 1, hasMore: false }));
  await old;
  assert.equal(tracker.getSnapshot().wallet, recipient);
  assert.deepEqual(tracker.getSnapshot().items, []);
});

test('revisions cannot regress progress and only authoritative completed status notifies once', async () => {
  const { tracker, backend, storage, completed } = fixture();
  tracker.remember(attempt);
  await connect(tracker);
  backend.items = [
    progress({
      status: 'action_required',
      revision: 2,
      pollAfterSeconds: 30,
      messageCode: 'REGISTRATION_REVIEW_REQUIRED',
    }),
  ];
  await poll(tracker);
  assert.equal(tracker.matches(attempt)?.pollAfterSeconds, 30);
  backend.items = [progress({ revision: 1, status: 'completed' })];
  await poll(tracker);
  assert.equal(tracker.matches(attempt)?.status, 'action_required');
  assert.deepEqual(completed, []);
  backend.items = [
    progress({
      status: 'completed',
      revision: 3,
      completionEventId: 'completion-1',
      completedAt: startedAt,
    }),
  ];
  await poll(tracker);
  await poll(tracker);
  assert.deepEqual(completed, ['registration-1']);
  assert.equal(tracker.getSnapshot().attempts.length, 0);
  assert.equal(storage.getItem(`${COMPLETION_PREFIX}${payer}:registration-1`), 'completion-1');
  const remounted = fixture(storage);
  remounted.backend.items = backend.items;
  await connect(remounted.tracker);
  assert.deepEqual(remounted.completed, []);
});

test('two trackers share a persistent completion acknowledgment across remounts', async () => {
  const storage = new MemoryStorage();
  const first = fixture(storage);
  const second = fixture(storage);
  first.tracker.remember(attempt);
  const item = progress({ status: 'completed', revision: 2, completionEventId: 'completion-1' });
  first.backend.items = [item];
  second.backend.items = [item];
  await connect(first.tracker);
  await connect(second.tracker);
  assert.equal(first.completed.length + second.completed.length, 1);
});

test('a saved purchase completed while the browser was closed is acknowledged once on return', async () => {
  const first = fixture();
  first.tracker.remember(attempt);
  const returned = fixture(first.storage);
  returned.backend.items = [
    progress({ status: 'completed', completionEventId: 'completion-away', completedAt: startedAt }),
  ];
  await connect(returned.tracker);
  assert.deepEqual(returned.completed, ['registration-1']);
  assert.deepEqual(returned.resolved, [['registration-1']]);
  assert.equal(first.storage.getItem(`${ATTEMPT_PREFIX}${attempt.clientId}`), null);
  const refreshed = fixture(first.storage);
  refreshed.backend.items = returned.backend.items;
  await connect(refreshed.tracker);
  assert.deepEqual(refreshed.completed, []);
});

test('hidden completion keeps the attempt unacknowledged through polling and refresh', async () => {
  const hidden = fixture(new MemoryStorage(), { canNotify: () => false });
  hidden.tracker.remember(attempt);
  hidden.backend.items = [
    progress({ status: 'completed', completionEventId: 'completion-away', completedAt: startedAt }),
  ];
  await connect(hidden.tracker);
  await poll(hidden.tracker);
  assert.deepEqual(hidden.completed, []);
  assert.equal(hidden.storage.getItem(`${COMPLETION_PREFIX}${payer}:registration-1`), null);
  assert.ok(hidden.storage.getItem(`${ATTEMPT_PREFIX}${attempt.clientId}`));
  const returned = fixture(hidden.storage, { canNotify: () => true });
  returned.backend.items = hidden.backend.items;
  await connect(returned.tracker);
  assert.deepEqual(returned.completed, ['registration-1']);
  await poll(hidden.tracker);
  assert.deepEqual(hidden.completed, []);
  assert.equal(hidden.tracker.getSnapshot().attempts.length, 0);
  const refreshed = fixture(hidden.storage);
  refreshed.backend.items = hidden.backend.items;
  await connect(refreshed.tracker);
  assert.deepEqual(refreshed.completed, []);
});

test('returning to a visible tab acknowledges completion once without another submission', async () => {
  let visible = false;
  const { tracker, backend, completed, storage } = fixture(new MemoryStorage(), {
    canNotify: () => visible,
  });
  tracker.remember(attempt);
  backend.items = [progress({ status: 'completed', completedAt: startedAt })];
  await connect(tracker);
  assert.deepEqual(completed, []);
  visible = true;
  await poll(tracker);
  await poll(tracker);
  assert.deepEqual(completed, ['registration-1']);
  assert.equal(storage.getItem(`${COMPLETION_PREFIX}${payer}:registration-1`), 'completed');
  assert.equal(
    backend.calls.some((path) => path.includes('/agents/register')),
    false,
  );
});

test('processing to hidden completion to visible return delivers one resolution and one visible toast', async () => {
  let visible = false;
  const { tracker, backend, completed, resolved } = fixture(new MemoryStorage(), {
    canNotify: () => visible,
  });
  tracker.remember(attempt);
  await connect(tracker);
  assert.deepEqual(resolved, []);
  backend.items = [progress({ status: 'completed', revision: 2, completedAt: startedAt })];
  await poll(tracker);
  assert.deepEqual(resolved, [['registration-1']]);
  assert.deepEqual(completed, []);
  await poll(tracker);
  assert.deepEqual(resolved, [['registration-1']]);
  visible = true;
  await poll(tracker);
  await poll(tracker);
  assert.deepEqual(resolved, [['registration-1']]);
  assert.deepEqual(completed, ['registration-1']);
  assert.equal(tracker.getSnapshot().attempts.length, 0);
});

test('notification lock failure does not replay already delivered resolution on retry', async () => {
  let failLock = true;
  const { tracker, backend, completed, resolved } = fixture(new MemoryStorage(), {
    lock: async (_key, callback) => {
      if (failLock) throw new Error('Fixture lock failure');
      callback();
    },
  });
  tracker.remember(attempt);
  await connect(tracker);
  backend.items = [progress({ status: 'completed', revision: 2, completedAt: startedAt })];
  await poll(tracker);
  assert.deepEqual(resolved, [['registration-1']]);
  assert.deepEqual(completed, []);
  failLock = false;
  await poll(tracker);
  assert.deepEqual(resolved, [['registration-1']]);
  assert.deepEqual(completed, ['registration-1']);
});

test('a later refund resolves independently of a hidden completion without a success toast', async () => {
  const { tracker, backend, completed, resolved } = fixture(new MemoryStorage(), {
    canNotify: () => false,
  });
  tracker.remember(attempt);
  await connect(tracker);
  backend.items = [progress({ status: 'completed', revision: 2, completedAt: startedAt })];
  await poll(tracker);
  backend.items = [
    progress({ status: 'refunded', revision: 3, updatedAt: '2026-09-06T10:00:01.000Z' }),
  ];
  await poll(tracker);
  await poll(tracker);
  assert.deepEqual(resolved, [['registration-1'], ['registration-1']]);
  assert.deepEqual(completed, []);
  assert.equal(tracker.getSnapshot().attempts.length, 0);
});

test('notification visibility is checked inside the cross-tab completion lock', async () => {
  let visible = true;
  const { tracker, backend, completed, storage } = fixture(new MemoryStorage(), {
    canNotify: () => visible,
    lock: async (_key, callback) => {
      visible = false;
      callback();
    },
  });
  tracker.remember(attempt);
  backend.items = [progress({ status: 'completed', completedAt: startedAt })];
  await connect(tracker);
  assert.deepEqual(completed, []);
  assert.equal(storage.getItem(`${COMPLETION_PREFIX}${payer}:registration-1`), null);
  assert.ok(storage.getItem(`${ATTEMPT_PREFIX}${attempt.clientId}`));
});

test('resolution is delivered for its current payer before a later switch blocks the completion claim', async () => {
  const deliveryWallets: Array<string | null> = [];
  const current = fixture(new MemoryStorage(), {
    onResolved: () => deliveryWallets.push(current.tracker.getSnapshot().wallet),
    lock: async (_key, callback) => {
      current.tracker.setExpectedWallet(recipient);
      callback();
    },
  });
  current.tracker.remember(attempt);
  await connect(current.tracker);
  current.backend.items = [progress({ status: 'completed', completedAt: startedAt, revision: 2 })];
  await poll(current.tracker);
  assert.equal(current.tracker.getSnapshot().wallet, recipient);
  assert.deepEqual(current.completed, []);
  assert.deepEqual(current.resolved, []);
  assert.deepEqual(deliveryWallets, [payer]);
  assert.equal(current.storage.getItem(`${COMPLETION_PREFIX}${payer}:registration-1`), null);
  assert.ok(current.storage.getItem(`${ATTEMPT_PREFIX}${attempt.clientId}`));
});

test('refunded is terminal without a success notification; action-required continues reconciliation', async () => {
  const { tracker, backend, completed } = fixture();
  tracker.remember(attempt);
  backend.items = [progress({ status: 'action_required', pollAfterSeconds: 30 })];
  await connect(tracker);
  assert.equal(tracker.getSnapshot().attempts.length, 1);
  backend.items = [progress({ status: 'refunded', paymentStatus: 'refunded', revision: 2 })];
  await poll(tracker);
  assert.equal(tracker.getSnapshot().attempts.length, 0);
  assert.deepEqual(completed, []);
});

test('one in-flight refresh is shared by banner, dashboard, and repeated refresh requests', async () => {
  const { tracker, backend } = fixture();
  tracker.remember(attempt);
  tracker.setExpectedWallet(payer);
  const a = tracker.refresh();
  const b = tracker.refresh();
  assert.equal(a, b);
  await a;
  assert.equal(
    backend.calls.filter(
      (path) => new URL(path, 'https://example.test').pathname === '/api/v1/registrations',
    ).length,
    1,
  );
});

test('pagination finds an older pending purchase and never turns a broken page into an empty result', async () => {
  const calls: string[] = [];
  const tracker = createTracker({
    storage: new MemoryStorage(),
    fetcher: async (url) => {
      calls.push(String(url));
      if (String(url).includes('/auth/')) return json({ authenticated: true, address: payer });
      if (String(url).includes('offset=0'))
        return json({
          items: Array.from({ length: 20 }, (_, index) =>
            progress({
              registrationId: `old-${index}`,
              statusUrl: `/api/v1/registrations/old-${index}`,
              domain: `old-${index}.test`,
              status: 'completed',
            }),
          ),
          total: 21,
          hasMore: true,
        });
      if (String(url).includes('offset=20'))
        return json({ items: [progress()], total: 21, hasMore: false });
      return json(progress());
    },
  });
  tracker.remember(attempt);
  await connect(tracker);
  assert.equal(tracker.matches(attempt)?.status, 'processing');
  assert.ok(calls.includes(`/api/v1/registrations?limit=20&offset=20&${payerQuery}`));
});

test('same workflow revision still updates payment observations and a later refund', async () => {
  const { tracker, backend, resolved, completed } = fixture();
  tracker.remember(attempt);
  await connect(tracker);
  backend.items = [
    progress({
      paymentStatus: 'pending',
      messageCode: 'PAYMENT_PENDING',
      updatedAt: '2026-09-06T10:01:00.000Z',
    }),
  ];
  await poll(tracker);
  assert.equal(tracker.matches(attempt)?.paymentStatus, 'pending');
  backend.items = [
    progress({
      status: 'refunded',
      paymentStatus: 'refunded',
      messageCode: 'REGISTRATION_REFUNDED',
      updatedAt: '2026-09-06T10:02:00.000Z',
    }),
  ];
  await poll(tracker);
  assert.equal(tracker.getSnapshot().items[0].status, 'refunded');
  assert.equal(tracker.getSnapshot().attempts.length, 0);
  assert.deepEqual(completed, []);
  assert.deepEqual(resolved, [['registration-1']]);
});

test('401 preserves the original payer pending record; a wallet change clears the visible record', async () => {
  const { tracker, backend } = fixture();
  tracker.remember(attempt);
  await connect(tracker);
  const original = tracker.getSnapshot().items[0];
  backend.status = 401;
  await poll(tracker);
  assert.equal(tracker.getSnapshot().wallet, payer);
  assert.deepEqual(tracker.getSnapshot().items, [original]);
  assert.deepEqual(tracker.getSnapshot().attempts, [attempt]);
  tracker.setExpectedWallet(recipient);
  assert.equal(tracker.getSnapshot().wallet, recipient);
  assert.deepEqual(tracker.getSnapshot().items, []);
  assert.deepEqual(tracker.getSnapshot().attempts, []);
  await poll(tracker);
});

test('discovery reads first page plus one rotating continuation and stays unfinished without pending items', async () => {
  const calls: number[] = [];
  const tracker = createTracker({
    storage: new MemoryStorage(),
    fetcher: async (url) => {
      if (String(url).includes('/auth/')) return json({ authenticated: true, address: payer });
      const offset = Number(
        new URL(String(url), 'https://example.test').searchParams.get('offset'),
      );
      calls.push(offset);
      const items = Array.from({ length: Math.min(20, 61 - offset) }, (_, index) => {
        const n = offset + index;
        return progress({
          registrationId: `history-${n}`,
          statusUrl: `/api/v1/registrations/history-${n}`,
          domain: `history-${n}.test`,
          status: n === 60 ? 'processing' : 'completed',
        });
      });
      return json({ items, total: 61, hasMore: offset + items.length < 61 });
    },
  });
  await connect(tracker);
  assert.deepEqual(calls, [0, 20]);
  assert.equal(tracker.getSnapshot().discoveryComplete, false);
  assert.equal(tracker.getSnapshot().attempts.length, 0);
  await poll(tracker);
  assert.deepEqual(calls, [0, 20, 0, 40]);
  assert.equal(tracker.getSnapshot().discoveryComplete, false);
  await poll(tracker);
  assert.deepEqual(calls, [0, 20, 0, 40, 0, 60]);
  assert.equal(tracker.getSnapshot().discoveryComplete, true);
  assert.equal(tracker.getSnapshot().attempts.length, 1);
});

test('known pending detail reads have a two-request rotating fanout and survive partial discovery', async () => {
  const { tracker, backend } = fixture();
  backend.items = Array.from({ length: 9 }, (_, index) =>
    progress({
      registrationId: `pending-${index}`,
      statusUrl: `/api/v1/registrations/pending-${index}`,
      domain: `pending-${index}.test`,
    }),
  );
  for (const item of backend.items)
    tracker.remember({
      ...attempt,
      domain: item.domain,
      clientId: `${Date.parse(startedAt)}-${item.registrationId}`,
    });
  await connect(tracker);
  const detailReads = () => backend.calls.filter((url) => url.startsWith('/api/v1/registrations/'));
  assert.equal(detailReads().length, 2);
  await poll(tracker);
  assert.equal(detailReads().length, 4);
  await poll(tracker);
  assert.equal(detailReads().length, 6);
  await poll(tracker);
  await poll(tracker);
  assert.equal(new Set(detailReads()).size, 9);
  backend.items = [];
  await poll(tracker);
  assert.equal(tracker.getSnapshot().attempts.length, 9);
  assert.equal(
    tracker.getSnapshot().items.filter((item) => item.status === 'processing').length,
    9,
  );
});

test('discovery never exceeds the API offset bound and reports the incomplete historical window', async () => {
  let maximumOffset = 0;
  const tracker = createTracker({
    storage: new MemoryStorage(),
    fetcher: async (url) => {
      if (String(url).includes('/auth/')) return json({ authenticated: true, address: payer });
      const offset = Number(
        new URL(String(url), 'https://example.test').searchParams.get('offset'),
      );
      maximumOffset = Math.max(offset, maximumOffset);
      return json({
        items: [
          progress({
            registrationId: `history-${offset}`,
            statusUrl: `/api/v1/registrations/history-${offset}`,
            status: 'completed',
          }),
        ],
        total: 20_000,
        hasMore: true,
      });
    },
  });
  await connect(tracker);
  for (let i = 0; i < REGISTRATION_MAX_DISCOVERY_OFFSET / REGISTRATION_PAGE_SIZE; i++)
    await poll(tracker);
  assert.equal(maximumOffset, 10_000);
  assert.equal(tracker.getSnapshot().discoveryComplete, true);
  assert.equal(tracker.getSnapshot().discoveryLimited, true);
});

test('completion refresh is one batch, independent of the once-only notification claim', async () => {
  const { tracker, backend, storage, completed, resolved } = fixture();
  tracker.remember(attempt);
  await connect(tracker);
  storage.setItem(`${COMPLETION_PREFIX}${payer}:registration-1`, 'claimed-by-another-tab');
  backend.items = [
    progress({
      status: 'completed',
      completionEventId: 'completion-1',
      updatedAt: '2026-09-06T10:00:01.000Z',
    }),
  ];
  await poll(tracker);
  await poll(tracker);
  assert.deepEqual(completed, []);
  assert.deepEqual(resolved, [['registration-1']]);
});

test('every status request is payer-bound and rejects missing or mismatched success headers before parsing', async () => {
  for (const path of ['/api/v1/registrations?limit=20&offset=0', progress().statusUrl]) {
    for (const header of [null, recipient, payer]) {
      let requested = '';
      let consumed = false;
      const response = json(progress());
      if (header === null) response.headers.delete('X-Authenticated-Wallet');
      else response.headers.set('X-Authenticated-Wallet', header);
      response.json = async () => {
        consumed = true;
        return progress();
      };
      const read = registrationRead(
        path,
        async (url) => {
          requested = String(url);
          return response;
        },
        undefined,
        payer,
      );
      if (header === payer) assert.equal(await read, response);
      else
        await assert.rejects(
          read,
          (error: unknown) =>
            error instanceof RegistrationReadError && error.kind === 'unauthorized',
        );
      assert.equal(
        new URL(requested, 'https://example.test').searchParams.get('expectedPayer'),
        payer,
      );
      assert.equal(consumed, false);
    }
  }
});

test('a shared-cookie payer flip never merges the other wallet list under the original payer', async () => {
  const secret = progress({
    registrationId: 'other-wallet-registration',
    statusUrl: '/api/v1/registrations/other-wallet-registration',
    domain: 'private-other.test',
  });
  const tracker = createTracker({
    storage: new MemoryStorage(),
    fetcher: async (url) => {
      if (String(url).includes('/auth/')) return json({ authenticated: true, address: payer });
      assert.equal(
        new URL(String(url), 'https://example.test').searchParams.get('expectedPayer'),
        payer,
      );
      return json({ items: [secret], total: 1, hasMore: false }, 200, {
        'X-Authenticated-Wallet': recipient,
      });
    },
  });
  tracker.remember(attempt);
  await connect(tracker);
  assert.equal(tracker.getSnapshot().connection, 'unauthorized');
  assert.equal(tracker.getSnapshot().wallet, payer);
  assert.deepEqual(tracker.getSnapshot().items, []);
  assert.deepEqual(tracker.getSnapshot().attempts, [attempt]);
  assert.doesNotMatch(
    JSON.stringify(tracker.getSnapshot()),
    /private-other|other-wallet-registration/,
  );
});

test('completed and refunded DTOs need coherent payment and service evidence; scheduler values are bounded', () => {
  for (const patch of [{ agentId: null }, { paymentStatus: 'pending' }, { stage: 'payment' }]) {
    assert.equal(
      registrationProgressSchema.safeParse({ ...progress({ status: 'completed' }), ...patch })
        .success,
      false,
    );
  }
  assert.equal(
    registrationProgressSchema.safeParse(progress({ status: 'completed', completedAt: null }))
      .success,
    true,
  );
  assert.equal(
    registrationProgressSchema.safeParse({
      ...progress({ status: 'refunded' }),
      paymentStatus: 'settled',
    }).success,
    false,
  );
  assert.equal(
    registrationProgressSchema.safeParse(progress({ updatedAt: '2026-09-05T10:00:00.000Z' }))
      .success,
    false,
  );
  for (const value of [0.001, 5, 30, Number.MAX_VALUE]) {
    const parsed = registrationProgressSchema.parse(progress({ pollAfterSeconds: value }));
    assert.ok(parsed.pollAfterSeconds >= 5 && parsed.pollAfterSeconds <= 300);
  }
  assert.equal(
    registrationProgressSchema.safeParse(progress({ pollAfterSeconds: Infinity })).success,
    false,
  );
});

test('older equal revisions cannot undo completion; only later explicit refund/review can change terminal status', () => {
  const completed = progress({
    status: 'completed',
    revision: 3,
    updatedAt: '2026-09-06T10:03:00.000Z',
    completionEventId: 'complete-1',
  });
  assert.equal(canAdvanceRegistration(completed, progress({ revision: 3 })), false);
  assert.equal(
    canAdvanceRegistration(
      completed,
      progress({ revision: 4, updatedAt: '2026-09-06T10:04:00.000Z' }),
    ),
    false,
  );
  assert.equal(
    canAdvanceRegistration(
      completed,
      progress({ status: 'refunded', revision: 3, updatedAt: completed.updatedAt }),
    ),
    false,
  );
  assert.equal(
    canAdvanceRegistration(
      completed,
      progress({ status: 'refunded', revision: 3, updatedAt: '2026-09-06T10:04:00.000Z' }),
    ),
    true,
  );
  assert.equal(
    canAdvanceRegistration(
      completed,
      progress({ status: 'action_required', revision: 3, updatedAt: '2026-09-06T10:04:00.000Z' }),
    ),
    true,
  );
  assert.equal(
    canAdvanceRegistration(completed, {
      ...completed,
      revision: 4,
      completionEventId: 'changed-event',
    }),
    false,
  );
  assert.equal(
    canAdvanceRegistration(completed, { ...completed, revision: 4, updatedAt: startedAt }),
    false,
  );
});

test('Retry-After supports seconds and HTTP dates with server clock skew, without accepting numeric garbage', () => {
  const now = Date.parse(startedAt);
  assert.equal(registrationRetryAfterMs('30', now), 30_000);
  assert.equal(
    registrationRetryAfterMs(
      'Sun, 06 Sep 2026 10:00:30 GMT',
      now + 600_000,
      'Sun, 06 Sep 2026 10:00:00 GMT',
    ),
    30_000,
  );
  assert.equal(registrationRetryAfterMs('Sun, 06 Sep 2026 09:00:00 GMT', now), 0);
  for (const value of [null, '', '-1', 'NaN', 'not a date'])
    assert.equal(registrationRetryAfterMs(value, now), undefined);
});

test('two busy tabs stay at or below96 status reads/minute despite repeated focus/storage-style refreshes', async () => {
  let now = Date.parse(startedAt);
  let reads = 0;
  const items = [
    progress(),
    progress({
      registrationId: 'registration-2',
      statusUrl: '/api/v1/registrations/registration-2',
      domain: 'two.test',
    }),
  ];
  const trackers = Array.from({ length: 2 }, () =>
    createTracker({
      storage: new MemoryStorage(),
      now: () => now,
      random: () => 0,
      fetcher: async (url) => {
        const parsed = new URL(String(url), 'https://example.test');
        if (parsed.pathname.includes('/auth/'))
          return json({ authenticated: true, address: payer });
        assert.equal(parsed.searchParams.get('expectedPayer'), payer);
        reads++;
        return parsed.pathname === '/api/v1/registrations'
          ? json({ items, total: 10000, hasMore: true })
          : json(items.find((item) => item.statusUrl === parsed.pathname));
      },
    }),
  );
  for (const tracker of trackers) tracker.setExpectedWallet(payer);
  for (let elapsed = 0; elapsed < 60_000; elapsed += 100) {
    now = Date.parse(startedAt) + elapsed;
    await Promise.all(trackers.map((tracker) => tracker.refresh()));
  }
  assert.ok(reads > 80 && reads <= 96, `unexpected busy-tab request count: ${reads}`);
  for (const tracker of trackers) assert.equal(tracker.getSnapshot().connection, 'ready');
});

test('429 stops fanout and shares only a payer-scoped cooldown; other wallets and persisted attempts remain isolated', async () => {
  const storage = new MemoryStorage();
  let now = Date.parse(startedAt);
  let firstReads = 0;
  const first = createTracker({
    storage,
    now: () => now,
    random: () => 0,
    fetcher: async (url) => {
      if (String(url).includes('/auth/')) return json({ authenticated: true, address: payer });
      firstReads++;
      return json({}, 429, { 'Retry-After': '60' });
    },
  });
  first.remember(attempt);
  await connect(first);
  assert.equal(firstReads, 1);
  assert.equal(first.getSnapshot().connection, 'unavailable');
  assert.ok(storage.getItem(`${ATTEMPT_PREFIX}${attempt.clientId}`));
  assert.equal(storage.getItem(`${REGISTRATION_BACKOFF_PREFIX}${payer}`), String(now + 60_000));
  let secondReads = 0;
  const second = createTracker({
    storage,
    now: () => now,
    fetcher: async () => {
      secondReads++;
      return json({});
    },
  });
  await connect(second);
  for (let i = 0; i < 5; i++) await second.refresh();
  assert.equal(secondReads, 0);
  assert.equal(second.getNextPollDelay(), 60_000);
  let otherReads = 0;
  const other = createTracker({
    storage,
    now: () => now,
    fetcher: async (url) => {
      otherReads++;
      return String(url).includes('/auth/')
        ? json({ authenticated: true, address: recipient })
        : json({ items: [], total: 0, hasMore: false }, 200, {
            'X-Authenticated-Wallet': recipient,
          });
    },
  });
  await connect(other, recipient);
  assert.equal(otherReads, 2);
  assert.deepEqual(other.getSnapshot().attempts, []);
  now += 60_000;
  assert.equal(second.getNextPollDelay(), REGISTRATION_POLL_MS);
  assert.doesNotMatch(
    storage.getItem(`${REGISTRATION_BACKOFF_PREFIX}${payer}`)!,
    /domain|payment|registration/,
  );
});

test('transient failures back off exponentially with jitter; later success resets pacing and ready state', async () => {
  let now = Date.parse(startedAt);
  let fail = true;
  let requests = 0;
  const tracker = createTracker({
    storage: new MemoryStorage(),
    now: () => now,
    random: () => 0.5,
    fetcher: async (url) => {
      requests++;
      if (String(url).includes('/auth/')) return json({ authenticated: true, address: payer });
      return fail ? json({}, 503) : json({ items: [], total: 0, hasMore: false });
    },
  });
  await connect(tracker);
  assert.equal(tracker.getNextPollDelay(), 5_500);
  const before = requests;
  await tracker.refresh();
  assert.equal(requests, before);
  now += 5_500;
  await tracker.refresh();
  assert.equal(tracker.getNextPollDelay(), 10_500);
  now += 10_500;
  fail = false;
  await tracker.refresh();
  assert.equal(tracker.isReadyForPayer(payer), true);
  assert.equal(tracker.isReadyForPayer(recipient), false);
  assert.equal(tracker.getNextPollDelay(), 5_500);
  tracker.invalidate();
  assert.equal(tracker.isReadyForPayer(payer), false);
});

test('long Retry-After never overflows the browser timer or permits an early read', async () => {
  const { tracker, storage, backend } = fixture();
  await connect(tracker);
  storage.setItem(`${REGISTRATION_BACKOFF_PREFIX}${payer}`, String(Number.MAX_SAFE_INTEGER));
  const before = backend.calls.length;
  assert.equal(tracker.getNextPollDelay(Number.MAX_VALUE), REGISTRATION_MAX_POLL_MS);
  await poll(tracker);
  assert.equal(backend.calls.length, before);
  assert.equal(tracker.isReadyForPayer(payer), false);
});

test('unreceived placeholders escalate120s after transmission, not while reserved, without deleting or repaying', async () => {
  const { tracker, storage, backend } = fixture();
  backend.items = [];
  tracker.remember(attempt);
  await connect(tracker);
  const createdAt = Date.parse(startedAt);
  const submittedAt = createdAt + 600_000;
  const key = `${REGISTRATION_SUBMISSION_PREFIX}${payer}:${attempt.domain}`;
  const reservation = {
    version: 1,
    wallet: payer,
    domain: attempt.domain,
    clientId: attempt.clientId,
    phase: 'reserved',
    createdAt,
    reviewAfter: createdAt + SUBMISSION_REVIEW_AFTER_MS,
  };
  storage.setItem(key, JSON.stringify(reservation));
  assert.equal(tracker.isSubmissionUnconfirmed(attempt, submittedAt), false);
  storage.setItem(
    key,
    JSON.stringify({
      ...reservation,
      phase: 'possibly_paid',
      submittedAt,
      reviewAfter: submittedAt + SUBMISSION_REVIEW_AFTER_MS,
    }),
  );
  assert.equal(
    tracker.isSubmissionUnconfirmed(attempt, submittedAt + SUBMISSION_REVIEW_AFTER_MS - 1),
    false,
  );
  assert.equal(
    tracker.isSubmissionUnconfirmed(attempt, submittedAt + SUBMISSION_REVIEW_AFTER_MS),
    true,
  );
  assert.equal(tracker.matches(attempt), undefined);
  assert.equal(tracker.hasPurchase(payer, attempt.domain), true);
  assert.ok(storage.getItem(`${ATTEMPT_PREFIX}${attempt.clientId}`));
  assert.equal(
    backend.calls.some((url) => url.includes('/agents/register')),
    false,
  );
});
