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
  ({ payer, attempt }) => {
    if (!localStorage.getItem('synthetic-fixture-seeded')) {
      localStorage.setItem(
        `agentdomain:registration-attempt:${attempt.clientId}`,
        JSON.stringify(attempt),
      );
      localStorage.setItem('synthetic-fixture-seeded', 'true');
    }
    let account = payer;
    const handlers = new Map();
    window.syntheticWallet = {
      signatureRequests: 0,
      switchAccount(next) {
        account = next;
        for (const callback of handlers.get('accountsChanged') ?? []) callback([next]);
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
        if (['eth_accounts', 'eth_requestAccounts'].includes(method)) return [account];
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
  { payer, attempt },
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
    /Elapsed.*no estimate available/s,
  );
  assert.doesNotMatch(
    await page.locator('body').innerText(),
    /Registration failed|PRIVATE_PROVIDER_ERROR|No agents yet/,
  );
  await page.screenshot({ path: '.qa/registration-desktop.png', fullPage: true });

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
  record.revision = 2;
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
  record.revision = 3;
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
  await page.reload();
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  await page.waitForTimeout(1500);
  assert.equal(
    await page.getByText(`${attempt.domain} registration complete`, { exact: true }).count(),
    0,
  );
  assert.equal(await page.evaluate(() => window.syntheticWallet.signatureRequests), 0);
  assert.equal(paidPosts.length, 0);
  assert.deepEqual(errors, []);
  console.log(
    'Browser checks passed: desktop/mobile, navigation/reload, unavailable reads, payer switch, 30-second review polling, one completion notification and dashboard refresh.',
  );
} catch (error) {
  await page.screenshot({ path: '.qa/registration-browser-failure.png', fullPage: true });
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
