import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RegistrationTracker } from '../src/lib/registration-tracker';
import {
  NOTICE_CHANNELS,
  RegistrationNoticesClient,
  noticeClientIdSchema,
  type RegistrationNotice,
  type NoticeChannel,
} from '../src/lib/registration-notices';
import {
  ATTEMPT_PREFIX,
  REGISTRATION_NOTICE_PREFIX,
  RegistrationReadError,
  type RegistrationProgress,
  type RegistrationAttempt,
} from '../src/lib/registration-progress';
import { REGISTRATION_SUBMISSION_PREFIX } from '../src/lib/registration-submission';

const wallet = `0x${'1'.repeat(40)}`;
const other = `0x${'2'.repeat(40)}`;
const start = Date.parse('2026-09-09T00:00:00.000Z');
const uuid = (n = 1) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const attempt = (n = 1): RegistrationAttempt => ({
  wallet,
  domain: `purchase-${n}.test`,
  clientId: `${start}-${uuid(n)}`,
});
const progress = (n = 1, extra: Partial<RegistrationProgress> = {}): RegistrationProgress => ({
  registrationId: uuid(n),
  domain: attempt(n).domain,
  statusUrl: `/api/v1/registrations/${uuid(n)}`,
  status: 'processing',
  agentId: null,
  paymentStatus: 'settled',
  stage: 'dns',
  messageCode: 'DNS_PROPAGATION_PENDING',
  startedAt: new Date(start).toISOString(),
  updatedAt: new Date(start).toISOString(),
  completedAt: null,
  revision: 1,
  estimatedDurationSeconds: null,
  pollAfterSeconds: 5,
  completionEventId: null,
  ...extra,
});
const notice = (
  n = 1,
  channel: NoticeChannel = 'popup',
  extra: Partial<RegistrationNotice> = {},
): RegistrationNotice => ({
  noticeId: `registration:${uuid(n)}`,
  source: 'registration',
  registrationId: uuid(n),
  domain: attempt(n).domain,
  channel,
  createdAt: new Date(start).toISOString(),
  expiresAt: new Date(start + (channel === 'popup' ? 5 : 10) * 86400000).toISOString(),
  status: 'registration',
  statusUrl: `/api/v1/registrations/${uuid(n)}?expectedPayer=${wallet}`,
  ...extra,
});
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
    throw new Error('Must not clear operational storage');
  }
}
const json = (body: unknown, status = 200, payer = wallet, headers = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Authenticated-Wallet': payer, ...headers },
  });
function fixture(storage = new MemoryStorage()) {
  const state = {
    now: start + 180000,
    wallet,
    records: [progress()],
    notices: NOTICE_CHANNELS.map((channel) => notice(1, channel)),
    requests: [] as { path: string; method: string; body: any }[],
    completed: [] as string[],
    resolved: [] as string[],
    deleteStatus: 204,
    mutationStatus: 200,
    listStatus: 200,
    replyWallet: null as string | null,
    visible: true,
    online: true,
    cursor: null as string | null,
    delayList: undefined as undefined | (() => Promise<void>),
    delayDelete: undefined as undefined | (() => Promise<void>),
  };
  const deleted = new Set<string>();
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'https://fixture.test');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    state.requests.push({ path: url.pathname + url.search, method, body });
    assert.equal(init?.credentials, 'include');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    if (url.pathname === '/api/v1/auth/session')
      return json({ authenticated: true, address: state.wallet });
    assert.equal(url.searchParams.get('expectedPayer'), state.wallet);
    if (url.pathname === '/api/v1/registrations')
      return json(
        { items: state.records, hasMore: false, total: state.records.length },
        200,
        state.wallet,
      );
    if (url.pathname.startsWith('/api/v1/registrations/'))
      return json(
        state.records.find((item) => item.registrationId === url.pathname.split('/').pop()),
        200,
        state.wallet,
      );
    assert.ok(
      url.pathname.startsWith('/api/v1/registration-notices'),
      'no payment/provider endpoint',
    );
    const payer = state.replyWallet ?? state.wallet;
    if (method === 'GET') {
      assert.equal(url.searchParams.get('limit'), '20');
      const channel = url.searchParams.get('channel');
      const items = state.notices
        .filter((item) => item.channel === channel && Date.parse(item.expiresAt) > state.now)
        .map((item) => ({ ...item }));
      await state.delayList?.();
      return json({ items, nextCursor: state.cursor }, state.listStatus, payer);
    }
    if (method === 'DELETE') {
      await state.delayDelete?.();
      if (state.deleteStatus !== 204)
        return json({}, state.deleteStatus, payer, { 'Retry-After': '3600' });
      const id = decodeURIComponent(url.pathname.split('/').pop()!);
      const channel = url.searchParams.get('channel')!;
      deleted.add(`${channel}:${id}`);
      state.notices = state.notices.filter(
        (item) => item.noticeId !== id || item.channel !== channel,
      );
      return json(null, 204, payer);
    }
    if (state.mutationStatus !== 200)
      return json({}, state.mutationStatus, payer, { 'Retry-After': '3600' });
    const n = Number((body.registrationId ?? body.clientId).slice(-12));
    const items = NOTICE_CHANNELS.map((channel) =>
      method === 'PUT'
        ? notice(n, channel, {
            noticeId: `client:${body.clientId}`,
            source: 'client',
            registrationId: null,
            domain: body.domain,
            status: 'submission_unknown',
            statusUrl: null,
          })
        : notice(n, channel),
    );
    for (const item of items) {
      const clientReceipt = `${item.channel}:client:${body.clientId}`;
      if (deleted.has(`${item.channel}:${item.noticeId}`) || deleted.has(clientReceipt)) continue;
      if (
        !state.notices.some(
          (saved) => saved.channel === item.channel && saved.noticeId === item.noticeId,
        )
      )
        state.notices.push(item);
    }
    return json(
      {
        items: state.notices.filter((item) =>
          items.some((saved) => saved.noticeId === item.noticeId),
        ),
      },
      200,
      payer,
    );
  };
  const create = () =>
    new RegistrationTracker({
      storage,
      fetcher,
      now: () => state.now,
      random: () => 0,
      online: () => state.online,
      canNotify: () => state.visible,
      onCompleted: (item) => state.completed.push(item.registrationId),
      onResolved: (items) => state.resolved.push(...items.map((item) => item.registrationId)),
    });
  const tracker = create();
  const connect = async (instance = tracker) => {
    instance.setExpectedWallet(state.wallet);
    await instance.refresh();
  };
  const poll = async (instance = tracker) => {
    state.now += Math.max(10000, instance.getNextPollDelay());
    await instance.refresh();
  };
  const remember = (n = 1) => {
    tracker.remember(attempt(n));
    return storage.getItem(`${ATTEMPT_PREFIX}${attempt(n).clientId}`);
  };
  return { state, tracker, storage, fetcher, create, connect, poll, remember };
}

test('DB list is the sole display source; only active settled recovery can create a canonical notice', async () => {
  const f = fixture();
  f.state.notices = [];
  f.state.records.push(progress(2, { status: 'completed', stage: 'complete', agentId: 'agent-2' }));
  await f.connect();
  assert.deepEqual(f.tracker.getSnapshot().notices, { popup: [], dashboard: [] });
  assert.equal(f.storage.length, 0);
  assert.deepEqual(
    f.state.requests.filter((r) => r.method === 'POST').map((r) => r.body),
    [{ registrationId: uuid(1) }],
  );
  await f.poll();
  assert.equal(f.tracker.getSnapshot().notices.popup.length, 1);
});

test('temporary canonical materialization failure never fails financial tracking and is retried', async () => {
  const f = fixture();
  f.state.notices = [];
  f.state.mutationStatus = 503;
  await f.connect();
  assert.equal(f.tracker.getSnapshot().connection, 'ready');
  assert.equal(f.tracker.getSnapshot().items[0].paymentStatus, 'settled');
  f.state.mutationStatus = 200;
  f.state.now += 3600001;
  await f.poll();
  await f.poll();
  assert.equal(f.tracker.getSnapshot().notices.popup.length, 1);
  assert.equal(f.storage.length, 0);
});

test('remote deletion and DB expiry remove display without removing operational tracking', async () => {
  const f = fixture();
  const saved = f.remember();
  await f.connect();
  f.state.notices = f.state.notices.filter((item) => item.channel === 'dashboard');
  await f.poll();
  assert.equal(f.tracker.getSnapshot().notices.popup.length, 0);
  assert.equal(f.tracker.getSnapshot().notices.dashboard.length, 1);
  f.state.now = start + 11 * 86400000;
  f.tracker.expireNotices();
  assert.deepEqual(f.tracker.getSnapshot().notices, { popup: [], dashboard: [] });
  assert.equal(f.storage.getItem(`${ATTEMPT_PREFIX}${attempt().clientId}`), saved);
  await f.poll();
  assert.equal(f.tracker.getSnapshot().items.length, 1);
});

test('each close dismisses one purchase in one channel; reload cannot resurrect it', async () => {
  const f = fixture();
  f.state.records.push(progress(2));
  f.state.notices.push(...NOTICE_CHANNELS.map((channel) => notice(2, channel)));
  const saved = f.remember();
  f.storage.setItem('unrelated', 'untouched');
  await f.connect();
  assert.equal(await f.tracker.dismissNotice(notice().noticeId, 'popup'), true);
  assert.equal(f.tracker.getSnapshot().notices.popup.length, 1);
  assert.equal(f.tracker.getSnapshot().notices.dashboard.length, 2);
  assert.equal(await f.tracker.dismissNotice(notice(2).noticeId, 'dashboard'), true);
  await f.poll();
  const reload = f.create();
  await f.connect(reload);
  assert.deepEqual(
    reload.getSnapshot().notices.popup.map((item) => item.registrationId),
    [uuid(2)],
  );
  assert.deepEqual(
    reload.getSnapshot().notices.dashboard.map((item) => item.registrationId),
    [uuid(1)],
  );
  assert.equal(f.storage.getItem(`${ATTEMPT_PREFIX}${attempt().clientId}`), saved);
  assert.equal(f.storage.getItem('unrelated'), 'untouched');
});

test('unconfirmed DELETE is not a successful close and retry remains explicit', async () => {
  const f = fixture();
  await f.connect();
  f.state.deleteStatus = 503;
  assert.equal(await f.tracker.dismissNotice(notice().noticeId, 'popup'), false);
  assert.equal(f.tracker.getSnapshot().notices.popup.length, 1);
  assert.match(f.tracker.getSnapshot().noticeErrors.popup!, /not confirmed/);
  f.state.deleteStatus = 204;
  f.state.now += 3600001;
  assert.equal(await f.tracker.dismissNotice(notice().noticeId, 'popup'), true);
});

test('notice mutation Retry-After never pauses financial progress reads', async () => {
  const f = fixture();
  await f.connect();
  f.state.deleteStatus = 429;
  await f.tracker.dismissNotice(notice().noticeId, 'popup');
  const before = f.state.requests.length;
  await f.poll();
  assert.ok(
    f.state.requests.slice(before).some((r) => r.path.startsWith('/api/v1/registrations?')),
  );
  const deletes = f.state.requests.filter((r) => r.method === 'DELETE').length;
  await f.tracker.dismissNotice(notice().noticeId, 'popup');
  assert.equal(f.state.requests.filter((r) => r.method === 'DELETE').length, deletes);
});

test('settled completed notices persist across reload without local attempts or repeated toasts', async () => {
  const f = fixture();
  f.state.records = [progress(1, { status: 'completed', stage: 'complete', agentId: 'agent-1' })];
  await f.connect();
  assert.deepEqual(f.state.completed, [uuid()]);
  const reload = f.create();
  await f.connect(reload);
  assert.equal(reload.getSnapshot().notices.dashboard.length, 1);
  assert.equal(reload.getSnapshot().notices.popup.length, 1);
  assert.deepEqual(f.state.completed, [uuid()]);
  assert.equal(
    f.state.requests.some((r) => r.method === 'POST'),
    false,
  );
});

test('dismissed and expired popup eligibility suppresses completion toast but not resolution', async () => {
  const f = fixture();
  f.remember();
  await f.connect();
  await f.tracker.dismissNotice(notice().noticeId, 'popup');
  f.state.records = [
    progress(1, { status: 'completed', stage: 'complete', agentId: 'agent', revision: 2 }),
  ];
  await f.poll();
  assert.deepEqual(f.state.completed, []);
  assert.deepEqual(f.state.resolved, [uuid()]);
  assert.equal(f.tracker.getSnapshot().notices.dashboard.length, 1);
});

test('hidden completion resolves once; visible return can notify only while DB popup remains', async () => {
  const f = fixture();
  f.remember();
  await f.connect();
  f.state.visible = false;
  f.state.records = [
    progress(1, { status: 'completed', stage: 'complete', agentId: 'agent', revision: 2 }),
  ];
  await f.poll();
  await f.poll();
  assert.deepEqual(f.state.resolved, [uuid()]);
  assert.deepEqual(f.state.completed, []);
  f.state.visible = true;
  await f.poll();
  assert.deepEqual(f.state.completed, [uuid()]);
  assert.deepEqual(f.state.resolved, [uuid()]);
});

test('unknown submissions require actual uncertain transmission evidence and use PUT collection', async () => {
  const f = fixture();
  f.state.records = [];
  f.state.notices = [];
  f.remember();
  await f.connect();
  assert.equal(
    f.state.requests.some((r) => r.method === 'PUT'),
    false,
  );
  f.tracker.accept(attempt(), null);
  await f.tracker.refresh();
  await f.poll();
  await f.poll();
  const puts = f.state.requests.filter((r) => r.method === 'PUT');
  assert.equal(puts.length, 1);
  assert.equal(puts[0].path.split('?')[0], '/api/v1/registration-notices');
  assert.equal(f.tracker.getSnapshot().notices.popup[0].status, 'submission_unknown');
  assert.equal(f.tracker.getSnapshot().items.length, 0);
});

test('legacy possibly-paid reservations migrate, while reserved-only and bare attempts do not', async () => {
  for (const phase of ['possibly_paid', 'reserved'] as const) {
    const f = fixture();
    f.state.records = [];
    f.state.notices = [];
    f.remember();
    const reservation = {
      ...attempt(),
      version: 1,
      phase,
      createdAt: start,
      ...(phase === 'possibly_paid' ? { submittedAt: start } : {}),
      reviewAfter: start + 120000,
    };
    const key = `${REGISTRATION_SUBMISSION_PREFIX}${wallet}:${attempt().domain}`;
    f.storage.setItem(key, JSON.stringify(reservation));
    await f.connect();
    await f.poll();
    assert.equal(
      f.state.requests.some((r) => r.method === 'PUT'),
      phase === 'possibly_paid',
    );
    assert.equal(f.storage.getItem(key), JSON.stringify(reservation));
  }
});

test('legacy alias dismissal migrates both IDs with no popup flash or create replay', async () => {
  const f = fixture();
  const a = attempt();
  const alias = a.clientId.replace('-', '.');
  f.storage.setItem(`${ATTEMPT_PREFIX}${alias}`, JSON.stringify({ ...a, clientId: alias }));
  f.storage.setItem(`${REGISTRATION_NOTICE_PREFIX}${wallet}:${alias}`, 'dismissed');
  let flashed = false;
  f.tracker.subscribe(() => {
    flashed ||= f.tracker.getSnapshot().notices.popup.length > 0;
  });
  await f.connect();
  await f.poll();
  await f.poll();
  assert.equal(flashed, false);
  assert.equal(
    f.state.requests.some((r) => ['PUT', 'POST'].includes(r.method)),
    false,
  );
  assert.equal(f.tracker.getSnapshot().notices.dashboard.length, 1);
  assert.ok(
    f.state.requests.some((r) => r.path.includes(encodeURIComponent(`client:${a.clientId}`))),
  );
  const reload = f.create();
  await f.connect(reload);
  assert.equal(reload.getSnapshot().notices.popup.length, 0);
});

test('client aliases normalize once and cannot duplicate a returned page', async () => {
  const canonical = attempt().clientId;
  const alias = canonical.replace('-', '.').toUpperCase();
  assert.equal(noticeClientIdSchema.parse(alias), canonical);
  const values = [canonical, alias].map((id) =>
    notice(1, 'popup', {
      noticeId: `client:${id}`,
      source: 'client',
      registrationId: null,
      status: 'submission_unknown',
      statusUrl: null,
    }),
  );
  const client = new RegistrationNoticesClient(async () =>
    json({ items: values, nextCursor: null }),
  );
  await assert.rejects(client.list(wallet, 'popup', null), RegistrationReadError);
});

test('a confirmed unknown-client dismissal carries through later canonical linking in the same channel', async () => {
  const f = fixture();
  f.state.records = [];
  f.remember();
  f.state.notices = NOTICE_CHANNELS.map((channel) =>
    notice(1, channel, {
      noticeId: `client:${attempt().clientId}`,
      source: 'client',
      registrationId: null,
      status: 'submission_unknown',
      statusUrl: null,
    }),
  );
  await f.connect();
  await f.tracker.dismissNotice(`client:${attempt().clientId}`, 'popup');
  f.state.records = [progress()];
  f.state.notices = NOTICE_CHANNELS.map((channel) => notice(1, channel));
  await f.poll();
  assert.equal(f.tracker.getSnapshot().notices.popup.length, 0);
  assert.equal(f.tracker.getSnapshot().notices.dashboard.length, 1);
  f.state.records = [
    progress(1, { status: 'completed', stage: 'complete', agentId: 'agent', revision: 2 }),
  ];
  await f.poll();
  await f.poll();
  assert.equal(f.tracker.getSnapshot().notices.popup.length, 0);
  assert.deepEqual(f.state.completed, []);
});

test('terminal cleanup removes only exact canonical and legacy attempt aliases, never reservations', async () => {
  const f = fixture();
  const a = attempt();
  const alias = a.clientId.replace('-', '.');
  f.remember();
  f.storage.setItem(`${ATTEMPT_PREFIX}${alias}`, JSON.stringify({ ...a, clientId: alias }));
  f.storage.setItem(`${REGISTRATION_SUBMISSION_PREFIX}${wallet}:${a.domain}`, 'protected');
  f.state.records = [progress(1, { status: 'completed', stage: 'complete', agentId: 'agent' })];
  await f.connect();
  assert.equal(f.storage.getItem(`${ATTEMPT_PREFIX}${a.clientId}`), null);
  assert.equal(f.storage.getItem(`${ATTEMPT_PREFIX}${alias}`), null);
  assert.equal(
    f.storage.getItem(`${REGISTRATION_SUBMISSION_PREFIX}${wallet}:${a.domain}`),
    'protected',
  );
});

test('POST and PUT successes require the same authenticated wallet before decoding', async () => {
  for (const method of ['POST', 'PUT']) {
    const client = new RegistrationNoticesClient(async (_url, options) => {
      assert.equal(options?.method, method);
      return json({ items: [] }, 200, other);
    });
    await assert.rejects(
      method === 'POST'
        ? client.create(wallet, uuid(), attempt().clientId)
        : client.submission(wallet, attempt().clientId, attempt().domain),
      RegistrationReadError,
    );
  }
});

test('canonical DB materialization before client linking yields one selector row per purchase', async () => {
  const f = fixture();
  f.remember();
  const aliases = NOTICE_CHANNELS.map((channel) =>
    notice(1, channel, {
      noticeId: `client:${attempt().clientId}`,
      source: 'client',
      registrationId: null,
      status: 'submission_unknown',
      statusUrl: null,
    }),
  );
  f.state.notices.unshift(...aliases);
  const seen: number[] = [];
  f.tracker.subscribe(() => {
    if (f.tracker.getSnapshot().noticeConnection === 'ready')
      seen.push(f.tracker.getSnapshot().notices.popup.length);
  });
  await f.connect();
  await f.poll();
  assert.ok(seen.every((count) => count === 1));
  assert.equal(f.tracker.getSnapshot().notices.popup[0].source, 'registration');
  assert.equal(f.state.requests.filter((r) => r.method === 'POST').length, 1);
  await f.tracker.dismissNotice(notice().noticeId, 'popup');
  await f.poll();
  assert.equal(f.tracker.getSnapshot().notices.popup.length, 0);
  assert.equal(f.tracker.getSnapshot().notices.dashboard.length, 1);
});

test('auth failures and mismatched wallet responses hide all notices and invalidate readiness', async () => {
  for (const mode of ['read-wallet', 'delete-wallet', 'unauthorized']) {
    const f = fixture();
    await f.connect();
    if (mode === 'unauthorized') f.state.listStatus = 401;
    else f.state.replyWallet = other;
    if (mode === 'delete-wallet')
      assert.equal(await f.tracker.dismissNotice(notice().noticeId, 'popup'), false);
    else await f.poll();
    assert.equal(f.tracker.getSnapshot().noticeConnection, 'unauthorized');
    assert.equal(f.tracker.isReadyForPayer(wallet), false);
    assert.deepEqual(f.tracker.getSnapshot().notices, { popup: [], dashboard: [] });
  }
});

test('late wallet-A list and dismissal replies never populate wallet B', async () => {
  for (const operation of ['list', 'delete']) {
    const f = fixture();
    await f.connect();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pause = async () => {
      started();
      await gate;
    };
    if (operation === 'list') f.state.delayList = pause;
    else f.state.delayDelete = pause;
    const pending =
      operation === 'list' ? f.poll() : f.tracker.dismissNotice(notice().noticeId, 'popup');
    await entered;
    f.state.delayList = undefined;
    f.state.delayDelete = undefined;
    f.state.wallet = other;
    f.state.records = [];
    f.state.notices = [];
    f.tracker.setExpectedWallet(other);
    await f.tracker.refresh();
    release();
    await pending;
    assert.equal(f.tracker.getSnapshot().wallet, other);
    assert.deepEqual(f.tracker.getSnapshot().notices, { popup: [], dashboard: [] });
  }
});

test('a stale list cannot overwrite a confirmed dismissal', async () => {
  const f = fixture();
  await f.connect();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.state.delayList = async () => {
    entered();
    await gate;
  };
  const pending = f.poll();
  await started;
  await f.tracker.dismissNotice(notice().noticeId, 'popup');
  release();
  await pending;
  assert.equal(f.tracker.getSnapshot().notices.popup.length, 0);
});

test('cursor remains opaque and scoped to its channel and wallet', async () => {
  const f = fixture();
  f.state.cursor = 'opaque_A-1';
  await f.connect();
  await f.tracker.pageNotices('dashboard');
  assert.equal(f.tracker.getSnapshot().noticeCursors.dashboard, 'opaque_A-1');
  assert.equal(f.tracker.getSnapshot().noticeCursors.popup, null);
  assert.ok(
    f.state.requests.some(
      (r) => r.path.includes('channel=dashboard') && r.path.includes('cursor=opaque_A-1'),
    ),
  );
  f.state.wallet = other;
  f.state.notices = [];
  f.state.records = [];
  f.tracker.setExpectedWallet(other);
  await f.tracker.refresh();
  assert.deepEqual(f.tracker.getSnapshot().noticeCursors, { popup: null, dashboard: null });
});

test('unsafe status URLs, wrong channels, missing wallet headers and spoofed payment fields are rejected/projected', async () => {
  for (const invalid of [
    notice(1, 'dashboard'),
    notice(1, 'popup', {
      statusUrl: `https://evil.test/api/v1/registrations/${uuid()}?expectedPayer=${wallet}`,
    }),
    notice(1, 'popup', { statusUrl: `/api/v1/registrations/${uuid()}?expectedPayer=${other}` }),
  ]) {
    await assert.rejects(
      new RegistrationNoticesClient(async () => json({ items: [invalid], nextCursor: null })).list(
        wallet,
        'popup',
        null,
      ),
    );
  }
  await assert.rejects(
    new RegistrationNoticesClient(async () => Response.json({ items: [], nextCursor: null })).list(
      wallet,
      'popup',
      null,
    ),
  );
  const page = await new RegistrationNoticesClient(async () =>
    json({
      items: [{ ...notice(), paymentStatus: 'settled', providerSecret: 'private' }],
      nextCursor: null,
    }),
  ).list(wallet, 'popup', null);
  assert.doesNotMatch(JSON.stringify(page), /paymentStatus|providerSecret|private/);
});

test('post-paid rejection removes only an exact local attempt; reservations and successor attempts survive', () => {
  const f = fixture();
  const a = attempt();
  f.remember();
  const reservationKey = `${REGISTRATION_SUBMISSION_PREFIX}${wallet}:${a.domain}`;
  f.storage.setItem(reservationKey, 'protected');
  const rejection = {
    status: 'rejected' as const,
    settlementAttempted: false as const,
    code: 'PAYMENT_QUOTE_EXPIRED',
    message: 'Quote expired',
  };
  assert.equal(f.tracker.reject(a, { ...rejection, settlementAttempted: true } as never), false);
  assert.equal(f.tracker.reject({ ...a, wallet: other }, rejection), false);
  assert.equal(f.tracker.reject(a, rejection), true);
  assert.equal(f.storage.getItem(`${ATTEMPT_PREFIX}${a.clientId}`), null);
  assert.equal(f.storage.getItem(reservationKey), 'protected');
  f.storage.setItem(
    `${ATTEMPT_PREFIX}${a.clientId}`,
    JSON.stringify({ ...a, domain: 'successor.test' }),
  );
  assert.equal(f.tracker.reject(a, rejection), false);
  assert.equal(f.state.requests.length, 0);
});
