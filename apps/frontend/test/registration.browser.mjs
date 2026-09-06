import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const { chromium } = createRequire(import.meta.url)('playwright');
const origin = process.env.FRONTEND_TEST_ORIGIN ?? 'http://127.0.0.1:3016';
const payer = `0x${'1'.repeat(40)}`;
const other = `0x${'2'.repeat(40)}`;
const startedAt = new Date(Date.now() - 125_000).toISOString();
const attempt = {
  wallet: payer,
  domain: 'synthetic-registration.test',
  clientId: `${Date.parse(startedAt)}-browser-fixture`,
};
const record = {
  registrationId: 'synthetic-registration',
  statusUrl: '/api/v1/registrations/synthetic-registration',
  status: 'processing',
  domain: attempt.domain,
  agentId: null,
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
};

await mkdir('.qa/registration-notification', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
let sessionPayer = payer;
let unavailable = false;
let throttled = false;
let agentReads = 0;
let extraRecords = [];
const statusReads = [];
const paidPosts = [];
await context.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== origin) {
    if (url.hostname === 'mainnet.base.org') {
      const input = request.postDataJSON();
      const result = (item) => ({ jsonrpc: '2.0', id: item.id, result: '0x0' });
      return route.fulfill({ json: Array.isArray(input) ? input.map(result) : result(input) });
    }
    return route.abort();
  }
  if (!url.pathname.startsWith('/api/v1/')) return route.continue();
  if (url.pathname === '/api/v1/auth/session')
    return route.fulfill({ json: { authenticated: true, address: sessionPayer, chainId: 8453 } });
  if (url.pathname === '/api/v1/agents/register') {
    paidPosts.push(request.postData());
    return route.fulfill({ status: 500, json: {} });
  }
  if (url.pathname.startsWith('/api/v1/registrations')) {
    assert.equal(
      url.searchParams.get('expectedPayer'),
      sessionPayer,
      'every status read needs its epoch payer condition',
    );
    statusReads.push(Date.now());
    if (throttled)
      return route.fulfill({ status: 429, headers: { 'Retry-After': '10' }, json: {} });
    if (unavailable)
      return route.fulfill({ status: 503, json: { message: 'PRIVATE_PROVIDER_ERROR' } });
    return route.fulfill({
      headers: { 'X-Authenticated-Wallet': sessionPayer },
      json:
        url.pathname === '/api/v1/registrations'
          ? { items: [record, ...extraRecords], total: 1 + extraRecords.length, hasMore: false }
          : [record, ...extraRecords].find((item) => item.statusUrl === url.pathname),
    });
  }
  if (url.pathname.startsWith('/api/v1/agents/by-wallet/')) {
    agentReads++;
    return route.fulfill({ json: [] });
  }
  return route.fulfill({ status: 404, json: {} });
});
await context.addInitScript(
  ({ payer, attempt, origin }) => {
    if (window.location.origin !== origin) return;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => window.syntheticVisibility ?? 'visible',
    });
    if (!localStorage.getItem('synthetic-fixture-seeded')) {
      localStorage.setItem(
        `agentdomain:registration-attempt:${attempt.clientId}`,
        JSON.stringify(attempt),
      );
      localStorage.setItem('synthetic-fixture-seeded', 'true');
    }
    let account = payer;
    const handlers = new Map();
    window.syntheticResolutionEvents = 0;
    window.addEventListener(
      'agentdomain:registration-completed',
      () => window.syntheticResolutionEvents++,
    );
    window.syntheticWallet = {
      signatureRequests: 0,
      switchAccount(next) {
        account = next;
        for (const callback of handlers.get('accountsChanged') ?? []) callback(next ? [next] : []);
      },
    };
    window.ethereum = {
      isMetaMask: true,
      on(event, callback) {
        handlers.set(event, [...(handlers.get(event) ?? []), callback]);
      },
      removeListener(event, callback) {
        handlers.set(
          event,
          (handlers.get(event) ?? []).filter((item) => item !== callback),
        );
      },
      async request({ method }) {
        if (['eth_accounts', 'eth_requestAccounts'].includes(method))
          return account ? [account] : [];
        if (method === 'eth_chainId') return '0x2105';
        if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions')
          return [{ parentCapability: 'eth_accounts' }];
        if (method === 'wallet_switchEthereumChain') return null;
        if (method.includes('sign') || method.includes('sendTransaction')) {
          window.syntheticWallet.signatureRequests++;
          throw new Error('Unexpected payment/signature request');
        }
        return null;
      },
    };
  },
  { payer, attempt, origin },
);

const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.setDefaultTimeout(30_000);

try {
  await page.goto(`${origin}/dashboard`, { timeout: 120_000 });
  await page
    .locator('[data-registration-pending]')
    .filter({ hasText: 'Waiting for DNS propagation' })
    .waitFor();
  assert.equal(await page.locator('[data-registration-pending]').count(), 1);
  assert.match(
    await page.locator('[data-registration-notification]').innerText(),
    /Payment confirmed.*Current step: DNS setup/s,
  );
  assert.match(
    await page.locator('[data-registration-notification]').innerText(),
    /Elapsed.*no estimate available/s,
  );
  assert.doesNotMatch(
    await page.locator('body').innerText(),
    /Registration failed|PRIVATE_PROVIDER_ERROR|No agents yet/,
  );
  const desktopNotice = await page.locator('[data-registration-notification]').boundingBox();
  assert.ok(desktopNotice.width >= 288 && desktopNotice.width <= 384);
  assert.ok(desktopNotice.x > 1000 && desktopNotice.x + desktopNotice.width <= 1440);
  assert.equal(await page.locator('[data-registration-banner]').count(), 0);
  await page.screenshot({ path: '.qa/registration-notification/desktop.png', fullPage: true });

  for (const [stage, label] of [
    ['domain', 'Domain registration'],
    ['ssl', 'HTTPS setup'],
    ['email', 'Email setup'],
    ['basename', 'Basename registration'],
    ['ens', 'ENS registration'],
  ]) {
    record.stage = stage;
    record.messageCode = 'REGISTRATION_RETRY_SCHEDULED';
    record.revision++;
    record.updatedAt = new Date().toISOString();
    record.estimatedDurationSeconds = 125;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page
      .locator('[data-registration-notification]')
      .getByText(`Current step: ${label}`)
      .waitFor();
    assert.match(
      await page.locator('[data-registration-notification]').innerText(),
      /Estimated setup: about 2m 5s\. Timing varies/,
    );
  }
  record.stage = 'dns';
  record.messageCode = 'DNS_PROPAGATION_PENDING';
  record.estimatedDurationSeconds = null;
  record.revision++;
  record.updatedAt = new Date().toISOString();

  await page.goto(`${origin}/privacy`);
  await page
    .locator('[data-registration-notification]')
    .filter({ hasText: 'Waiting for DNS propagation' })
    .waitFor();
  await page.reload();
  await page
    .locator('[data-registration-notification]')
    .filter({ hasText: 'Waiting for DNS propagation' })
    .waitFor();
  unavailable = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText(/Updates temporarily unavailable/).waitFor();
  assert.match(
    await page.locator('[data-registration-notification]').innerText(),
    /Waiting for DNS propagation/,
  );
  await page.reload();
  await page.getByText(/Confirming payment and registration status/).waitFor();
  await page.locator('[data-registration-unconfirmed]').waitFor();
  assert.equal(
    await page.locator('[data-registration-unconfirmed] a').getAttribute('href'),
    'mailto:contact@agentdomain.app',
  );
  assert.doesNotMatch(
    await page.locator('body').innerText(),
    /Registration failed|PRIVATE_PROVIDER_ERROR/,
  );
  unavailable = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByText('Waiting for DNS propagation', { exact: false }).waitFor();

  const secondTab = await context.newPage();
  await secondTab.goto(`${origin}/dashboard`);
  await secondTab.locator('[data-registration-pending]').waitFor();
  throttled = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await secondTab.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText(/Updates temporarily unavailable/).waitFor();
  const throttledReads = statusReads.length;
  await page.waitForTimeout(3000);
  assert.equal(statusReads.length, throttledReads, 'same-payer tabs must share429 cooldown');
  throttled = false;
  await secondTab.close();
  await page.waitForTimeout(8500);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByText('Waiting for DNS propagation', { exact: false }).waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/dashboard`);
  await page.locator('[data-registration-pending]').waitFor();
  await page.screenshot({ path: '.qa/registration-notification/mobile.png', fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.evaluate(() => window.scrollTo(0, 300));
  const notice = await page.locator('[data-registration-notification]').boundingBox();
  const nav = await page.locator('.agentdomain-sticky-header').boundingBox();
  assert.ok(
    notice.y >= nav.y + nav.height && nav.y === 0,
    'side notification must not move or overlap sticky navigation',
  );
  assert.ok(notice.width <= 384 && notice.x >= 12 && notice.x + notice.width <= 378);

  const priorReads = statusReads.length;
  await page.evaluate((address) => window.syntheticWallet.switchAccount(address), other);
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[data-registration-notification]')
        ?.textContent.includes('synthetic-registration.test'),
  );
  await page.waitForTimeout(5500);
  assert.equal(statusReads.length, priorReads, 'payer mismatch must pause status reads');
  await page.evaluate((address) => window.syntheticWallet.switchAccount(address), payer);
  await page.locator('[data-registration-pending]').waitFor();
  record.status = 'action_required';
  record.updatedAt = new Date().toISOString();
  record.messageCode = 'REGISTRATION_REVIEW_REQUIRED';
  record.pollAfterSeconds = 30;
  record.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page
    .getByText('Registration needs review. Do not pay again.', { exact: true })
    .last()
    .waitFor();
  const reviewReads = statusReads.length;
  await page.waitForTimeout(6000);
  assert.equal(statusReads.length, reviewReads, 'action-required polling must respect 30 seconds');
  const priorAgentReads = agentReads;
  record.status = 'completed';
  record.agentId = 'synthetic-agent';
  record.stage = 'complete';
  record.messageCode = 'REGISTRATION_COMPLETED';
  record.revision++;
  record.completedAt = new Date().toISOString();
  record.updatedAt = record.completedAt;
  record.completionEventId = 'synthetic-complete';
  const refreshedAgents = page.waitForResponse((response) =>
    response.url().includes('/api/v1/agents/by-wallet/'),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText(`${attempt.domain} registration complete`, { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-registration-pending]').length === 0,
  );
  await refreshedAgents;
  assert.equal(
    agentReads,
    priorAgentReads + 1,
    'completion must refresh normal dashboard data exactly once',
  );
  const firstToast = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: `${attempt.domain} registration complete` });
  await firstToast.hover();
  await page.evaluate((address) => window.syntheticWallet.switchAccount(address), other);
  await firstToast.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'View identity', exact: true }).count(), 0);
  await page.evaluate((address) => window.syntheticWallet.switchAccount(address), payer);
  await page.reload();
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  await page.waitForTimeout(1500);
  assert.equal(
    await page.getByText(`${attempt.domain} registration complete`, { exact: true }).count(),
    0,
  );

  const awayStartedAt = new Date().toISOString();
  const awayAttempt = {
    wallet: payer,
    domain: 'completed-while-away.test',
    clientId: `${Date.parse(awayStartedAt)}-away-fixture`,
  };
  Object.assign(record, {
    registrationId: 'synthetic-away',
    statusUrl: '/api/v1/registrations/synthetic-away',
    domain: awayAttempt.domain,
    agentId: null,
    status: 'processing',
    stage: 'email',
    messageCode: 'REGISTRATION_RETRY_SCHEDULED',
    startedAt: awayStartedAt,
    updatedAt: awayStartedAt,
    completedAt: null,
    completionEventId: null,
    revision: 1,
    pollAfterSeconds: 5,
  });
  await page.evaluate((saved) => {
    localStorage.setItem(
      `agentdomain:registration-attempt:${saved.clientId}`,
      JSON.stringify(saved),
    );
    window.dispatchEvent(new Event('focus'));
  }, awayAttempt);
  await page
    .locator('[data-registration-pending]')
    .filter({ hasText: awayAttempt.domain })
    .waitFor();
  const awayResolutionBaseline = await page.evaluate(() => window.syntheticResolutionEvents);
  const awayAgentReadBaseline = agentReads;
  await page.evaluate(() => {
    window.syntheticVisibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
  });
  Object.assign(record, {
    agentId: 'synthetic-away-agent',
    status: 'completed',
    stage: 'complete',
    messageCode: 'REGISTRATION_COMPLETED',
    completedAt: new Date().toISOString(),
    completionEventId: 'synthetic-away-complete',
    revision: 2,
  });
  record.updatedAt = record.completedAt;
  await page.waitForFunction(
    () => document.querySelectorAll('[data-registration-pending]').length === 0,
  );
  assert.equal(
    await page.getByText(`${awayAttempt.domain} registration complete`, { exact: true }).count(),
    0,
  );
  assert.deepEqual(
    await page.evaluate(
      ({ payer, clientId }) => ({
        acknowledged: localStorage.getItem(
          `agentdomain:registration-completed:${payer}:synthetic-away`,
        ),
        saved: localStorage.getItem(`agentdomain:registration-attempt:${clientId}`) !== null,
      }),
      { payer, clientId: awayAttempt.clientId },
    ),
    { acknowledged: null, saved: true },
  );
  await page.waitForFunction(
    (baseline) => window.syntheticResolutionEvents === baseline + 1,
    awayResolutionBaseline,
  );
  await page.waitForTimeout(6500);
  assert.equal(
    await page.evaluate(() => window.syntheticResolutionEvents),
    awayResolutionBaseline + 1,
  );
  await page.evaluate(() => {
    window.syntheticVisibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByText(`${awayAttempt.domain} registration complete`, { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.syntheticResolutionEvents),
    awayResolutionBaseline + 1,
  );
  assert.equal(
    agentReads,
    awayAgentReadBaseline + 1,
    'hidden completion and visible return refresh dashboard data only once',
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('[data-sonner-toast][data-mounted="true"]').waitFor();
  await page.screenshot({
    path: '.qa/registration-notification/return-completed.png',
    fullPage: true,
    animations: 'disabled',
  });
  const awayToast = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: `${awayAttempt.domain} registration complete` });
  await awayToast.hover();
  await page.evaluate(() => window.syntheticWallet.switchAccount(null));
  await awayToast.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'View identity', exact: true }).count(), 0);
  await page.evaluate((address) => window.syntheticWallet.switchAccount(address), payer);
  await page.reload();
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  await page.waitForTimeout(1500);
  assert.equal(
    await page.getByText(`${awayAttempt.domain} registration complete`, { exact: true }).count(),
    0,
  );

  const noticeStartedAt = new Date(Date.now() - 125_000).toISOString();
  const noticeAttempt = {
    wallet: payer,
    domain: `${'long-registration-name-'.repeat(2)}fixture.test`,
    clientId: `${Date.parse(noticeStartedAt)}-notice-fixture`,
  };
  Object.assign(record, {
    registrationId: 'notification-fixture',
    statusUrl: '/api/v1/registrations/notification-fixture',
    domain: noticeAttempt.domain,
    agentId: null,
    status: 'processing',
    paymentStatus: 'settled',
    stage: 'email',
    messageCode: 'EMAIL_VERIFICATION_PENDING',
    startedAt: noticeStartedAt,
    updatedAt: noticeStartedAt,
    completedAt: null,
    completionEventId: null,
    revision: 1,
    estimatedDurationSeconds: null,
    pollAfterSeconds: 5,
  });
  const noticeRecord = { ...record };
  const protectedState = await page.evaluate((saved) => {
    const attemptKey = `agentdomain:registration-attempt:${saved.clientId}`;
    const reservationKey = `agentdomain:registration-submission:${saved.wallet}:${saved.domain}`;
    const reservation = JSON.stringify({
      version: 1,
      ...saved,
      phase: 'possibly_paid',
      createdAt: Number(saved.clientId.split('-')[0]),
      submittedAt: Number(saved.clientId.split('-')[0]),
      reviewAfter: Number(saved.clientId.split('-')[0]) + 120_000,
    });
    localStorage.setItem(attemptKey, JSON.stringify(saved));
    localStorage.setItem(reservationKey, reservation);
    window.dispatchEvent(new Event('focus'));
    return { attemptKey, reservationKey, attempt: JSON.stringify(saved), reservation };
  }, noticeAttempt);
  await page
    .locator('[data-registration-notification]')
    .filter({ hasText: noticeAttempt.domain })
    .waitFor();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const narrowNotice = await page.locator('[data-registration-notification]').boundingBox();
  assert.ok(narrowNotice.x >= 12 && narrowNotice.x + narrowNotice.width <= 308);
  assert.ok(narrowNotice.y >= 64 && narrowNotice.y + narrowNotice.height <= 568);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const close = page.getByRole('button', {
    name: 'Dismiss registration notification',
    exact: true,
  });
  await close.focus();
  assert.equal(await close.evaluate((element) => element === document.activeElement), true);
  await page.screenshot({
    path: '.qa/registration-notification/narrow-mobile.png',
    fullPage: true,
  });
  const headingBeforeDismiss = await page
    .getByRole('heading', { name: 'Dashboard', exact: true })
    .boundingBox();
  await close.press('Enter');
  await page.locator('[data-registration-notification]').waitFor({ state: 'hidden' });
  const headingAfterDismiss = await page
    .getByRole('heading', { name: 'Dashboard', exact: true })
    .boundingBox();
  assert.equal(
    headingAfterDismiss.y,
    headingBeforeDismiss.y,
    'dismissal must not move page content',
  );
  await page
    .locator('[data-registration-pending]')
    .filter({ hasText: noticeAttempt.domain })
    .waitFor();
  await page.waitForTimeout(12_500);
  assert.equal(
    await page.locator('[data-registration-notification]').count(),
    0,
    'polls must not reopen dismissed presentation',
  );
  assert.deepEqual(
    await page.evaluate(
      ({ attemptKey, reservationKey }) => ({
        attempt: localStorage.getItem(attemptKey),
        reservation: localStorage.getItem(reservationKey),
      }),
      protectedState,
    ),
    { attempt: protectedState.attempt, reservation: protectedState.reservation },
  );
  await page.reload();
  await page
    .locator('[data-registration-pending]')
    .filter({ hasText: noticeAttempt.domain })
    .waitFor();
  assert.equal(
    await page.locator('[data-registration-notification]').count(),
    0,
    'remount must preserve dismissal',
  );

  sessionPayer = other;
  Object.assign(record, {
    registrationId: 'other-notification',
    statusUrl: '/api/v1/registrations/other-notification',
  });
  await page.evaluate((address) => window.syntheticWallet.switchAccount(address), other);
  await page
    .locator('[data-registration-notification]')
    .filter({ hasText: noticeAttempt.domain })
    .waitFor();
  assert.equal(
    await page.locator('[data-registration-pending]').count(),
    1,
    'other payer sees only its own row',
  );
  await page
    .getByRole('button', { name: 'Dismiss registration notification', exact: true })
    .click();
  sessionPayer = payer;
  Object.assign(record, noticeRecord);
  await page.evaluate((address) => window.syntheticWallet.switchAccount(address), payer);
  await page
    .locator('[data-registration-pending]')
    .filter({ hasText: noticeAttempt.domain })
    .waitFor();
  assert.equal(
    await page.locator('[data-registration-notification]').count(),
    0,
    'returning payer keeps its own dismissal',
  );
  await page.evaluate(() => window.syntheticWallet.switchAccount(null));
  await page.getByRole('heading', { name: 'Connect your wallet', exact: true }).waitFor();
  assert.equal(await page.locator('[data-registration-notification]').count(), 0);
  assert.equal(await page.locator('[data-registration-pending]').count(), 0);
  await page.evaluate((address) => window.syntheticWallet.switchAccount(address), payer);
  await page.locator('[data-registration-pending]').waitFor();
  Object.assign(record, {
    status: 'completed',
    stage: 'complete',
    agentId: 'notice-completed-agent',
    revision: 2,
    updatedAt: new Date().toISOString(),
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText(`${noticeAttempt.domain} registration complete`, { exact: true }).waitFor();
  assert.equal(await page.locator('[data-registration-pending]').count(), 0);
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), protectedState.reservationKey),
    protectedState.reservation,
  );

  Object.assign(record, {
    registrationId: 'legacy-completed',
    statusUrl: '/api/v1/registrations/legacy-completed',
    domain: 'settled-legacy.test',
    agentId: 'legacy-agent',
    status: 'completed',
    paymentStatus: 'settled',
    stage: 'complete',
    messageCode: 'REGISTRATION_COMPLETED',
    startedAt: '2026-05-23T10:00:00.000Z',
    updatedAt: '2026-05-23T10:00:00.000Z',
    completedAt: null,
    completionEventId: null,
    revision: 0,
  });
  const completedHistoryRead = page.waitForResponse((response) =>
    response.url().includes('/api/v1/registrations?'),
  );
  await page.reload();
  await completedHistoryRead;
  assert.equal(await page.locator('[data-registration-notification]').count(), 0);
  assert.equal(await page.locator('[data-registration-pending]').count(), 0);
  Object.assign(record, {
    registrationId: 'legacy-unknown',
    statusUrl: '/api/v1/registrations/legacy-unknown',
    domain: 'unknown-legacy.test',
    status: 'action_required',
    paymentStatus: 'unknown',
    stage: 'payment',
    messageCode: 'PAYMENT_CONFIRMATION_REQUIRED',
  });
  await page.reload();
  await page
    .locator('[data-registration-pending]')
    .filter({ hasText: 'unknown-legacy.test' })
    .waitFor();
  assert.equal(await page.locator('[data-registration-notification]').count(), 0);
  const unknownText = await page.locator('[data-registration-pending]').innerText();
  assert.match(unknownText, /Payment status unavailable/);
  assert.doesNotMatch(
    unknownText,
    /Elapsed|Payment confirmed|Payment pending|Payment confirmation pending|Current step/,
  );
  await page.screenshot({
    path: '.qa/registration-notification/unknown-legacy.png',
    fullPage: true,
  });
  Object.assign(record, {
    status: 'completed',
    paymentStatus: 'settled',
    stage: 'complete',
    messageCode: 'REGISTRATION_COMPLETED',
    completionEventId: 'legacy-unknown:completed',
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText('unknown-legacy.test registration complete', { exact: true }).waitFor();
  await page.locator('[data-registration-pending]').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-registration-notification]').count(), 0);
  Object.assign(record, {
    registrationId: 'legacy-finalizing',
    statusUrl: '/api/v1/registrations/legacy-finalizing',
    domain: 'finalizing-legacy.test',
    agentId: 'legacy-finalizing-agent',
    status: 'processing',
    paymentStatus: 'settled',
    stage: 'finalizing',
    messageCode: 'REGISTRATION_PROCESSING',
    completionEventId: null,
  });
  await page.reload();
  await page
    .locator('[data-registration-pending]')
    .filter({ hasText: 'finalizing-legacy.test' })
    .waitFor();
  assert.match(
    await page.locator('[data-registration-pending]').innerText(),
    /Payment confirmed.*Current step: Final checks/s,
  );
  const legacyResolutionBaseline = await page.evaluate(() => window.syntheticResolutionEvents);
  Object.assign(record, {
    status: 'completed',
    stage: 'complete',
    messageCode: 'REGISTRATION_COMPLETED',
    completionEventId: 'legacy-finalizing:completed',
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText('finalizing-legacy.test registration complete', { exact: true }).waitFor();
  await page.locator('[data-registration-pending]').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-registration-notification]').count(), 0);
  assert.equal(
    await page.evaluate(() => window.syntheticResolutionEvents),
    legacyResolutionBaseline + 1,
  );
  Object.assign(record, {
    ...noticeRecord,
    registrationId: 'pair-one',
    statusUrl: '/api/v1/registrations/pair-one',
    domain: 'first-registration.test',
  });
  extraRecords = [
    {
      ...record,
      registrationId: 'pair-two',
      statusUrl: '/api/v1/registrations/pair-two',
      domain: 'second-registration.test',
      stage: 'dns',
      messageCode: 'DNS_PROPAGATION_PENDING',
    },
  ];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page
    .locator('[data-registration-notification]')
    .getByText('+1 more', { exact: true })
    .waitFor();
  assert.equal(await page.locator('[data-registration-pending]').count(), 2);
  assert.equal(
    await page.locator('[data-registration-notification]').count(),
    1,
    'multiple registrations share one compact notice',
  );
  await page.screenshot({ path: '.qa/registration-notification/two-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.qa/registration-notification/two-mobile.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const pairNotice = await page.locator('[data-registration-notification]').boundingBox();
  assert.ok(pairNotice.x >= 12 && pairNotice.x + pairNotice.width <= 378);
  await page
    .getByRole('button', { name: 'Dismiss registration notification', exact: true })
    .click();
  await page.locator('[data-registration-notification]').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-registration-pending]').count(), 2);
  await page.reload();
  await page
    .locator('[data-registration-pending]')
    .filter({ hasText: 'second-registration.test' })
    .waitFor();
  assert.equal(
    await page.locator('[data-registration-notification]').count(),
    0,
    'closing the aggregate dismisses both presentations across remount',
  );
  await page.screenshot({ path: '.qa/registration-notification/two-dismissed-mobile.png' });
  assert.equal(await page.evaluate(() => window.syntheticWallet.signatureRequests), 0);
  assert.equal(paidPosts.length, 0);
  assert.deepEqual(errors, []);
  console.log(
    'Browser checks passed: desktop/390px/320px, fixed notice without layout shift, keyboard dismissal across polls/remount/wallet switches, unchanged replay protection, settled/unknown legacy fixtures, selected stages, timing, navigation, unavailable reads, payer isolation, one hidden-completion resolution and one visible-return toast. Zero signatures, paid POSTs or page errors.',
  );
} catch (error) {
  await page.screenshot({ path: '.qa/registration-notification/failure.png', fullPage: true });
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
