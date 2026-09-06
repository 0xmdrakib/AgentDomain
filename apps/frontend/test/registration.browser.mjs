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

await mkdir('.qa', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const sessionPayer = payer;
let unavailable = false;
let throttled = false;
let agentReads = 0;
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
      payer,
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
          ? { items: [record], total: 1, hasMore: false }
          : record,
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
    await page.locator('[data-registration-banner]').innerText(),
    /Payment confirmed.*Current step: DNS setup/s,
  );
  assert.match(
    await page.locator('[data-registration-banner]').innerText(),
    /Elapsed.*no estimate available/s,
  );
  assert.doesNotMatch(
    await page.locator('body').innerText(),
    /Registration failed|PRIVATE_PROVIDER_ERROR|No agents yet/,
  );
  await page.screenshot({ path: '.qa/registration-desktop.png', fullPage: true });

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
    await page.locator('[data-registration-banner]').getByText(`Current step: ${label}`).waitFor();
    assert.match(
      await page.locator('[data-registration-banner]').innerText(),
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
    .locator('[data-registration-banner]')
    .filter({ hasText: 'Waiting for DNS propagation' })
    .waitFor();
  await page.reload();
  await page
    .locator('[data-registration-banner]')
    .filter({ hasText: 'Waiting for DNS propagation' })
    .waitFor();
  unavailable = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText(/Updates temporarily unavailable/).waitFor();
  assert.match(
    await page.locator('[data-registration-banner]').innerText(),
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
  await page.screenshot({ path: '.qa/registration-mobile.png', fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.evaluate(() => window.scrollTo(0, 300));
  const banner = await page.locator('[data-registration-banner]').boundingBox();
  const nav = await page.locator('.agentdomain-sticky-header').boundingBox();
  assert.ok(
    nav.y >= banner.y + banner.height - 1,
    'sticky navigation overlaps registration banner',
  );

  const priorReads = statusReads.length;
  await page.evaluate((address) => window.syntheticWallet.switchAccount(address), other);
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[data-registration-banner]')
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
    path: '.qa/registration-return-completed.png',
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
  assert.equal(await page.evaluate(() => window.syntheticWallet.signatureRequests), 0);
  assert.equal(paidPosts.length, 0);
  assert.deepEqual(errors, []);
  console.log(
    'Browser checks passed: desktop/mobile, selected stages, indicative timing, navigation/reload, unavailable reads, payer switch/disconnect after visible toast, review polling, one hidden-completion resolution/data refresh and one visible-return toast.',
  );
} catch (error) {
  await page.screenshot({ path: '.qa/registration-browser-failure.png', fullPage: true });
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
