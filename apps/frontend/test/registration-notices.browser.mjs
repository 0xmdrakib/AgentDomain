import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] ?? 'playwright');
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const loadConfig = require('tailwindcss/loadConfig');
const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://127.0.0.1:3034';
const screenshots = `${root}/.qa/registration-notices`;
await mkdir(screenshots, { recursive: true });
const wallet = `0x${'1'.repeat(40)}`;
const other = `0x${'2'.repeat(40)}`;
const start = Date.now() - 180000;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const domain = (n) =>
  n === 2 ? `${'long-registration-name-'.repeat(2)}fixture.test` : `purchase-${n}.test`;
const record = (n) => ({
  registrationId: uuid(n),
  statusUrl: `/api/v1/registrations/${uuid(n)}`,
  domain: domain(n),
  status: 'processing',
  paymentStatus: 'settled',
  stage: 'dns',
  messageCode: 'DNS_PROPAGATION_PENDING',
  agentId: null,
  startedAt: new Date(start).toISOString(),
  updatedAt: new Date(start).toISOString(),
  completedAt: null,
  revision: 1,
  estimatedDurationSeconds: null,
  pollAfterSeconds: 5,
  completionEventId: null,
});
const notice = (n, channel) => ({
  noticeId: `registration:${uuid(n)}`,
  source: 'registration',
  registrationId: uuid(n),
  domain: domain(n),
  channel,
  createdAt: new Date(start).toISOString(),
  expiresAt: new Date(start + (channel === 'popup' ? 5 : 10) * 86400000).toISOString(),
  status: 'registration',
  statusUrl: `/api/v1/registrations/${uuid(n)}?expectedPayer=${wallet}`,
});
const initialNotices = () =>
  [1, 2].flatMap((n) => ['popup', 'dashboard'].map((channel) => notice(n, channel)));
const entry = `
  import React, { useEffect } from 'react';
  import { createRoot } from 'react-dom/client';
  import { RegistrationTrackerProvider, useRegistrationTracker } from './src/components/register/registration-tracker-provider';
  import { DashboardRegistrationUpdates } from './src/components/register/registration-updates';
  const f = window.fixture = { wallet: '${wallet}', now: ${start + 180000}, requests: [], resolved: 0 };
  Date.now = () => f.now;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (url, options) => {
    f.requests.push({ url: String(url), method: options?.method ?? 'GET', credentials: options?.credentials, cache: options?.cache, redirect: options?.redirect });
    if (String(url).includes('/agents/register')) throw new Error('Payment requests forbidden');
    return originalFetch(url, options);
  };
  window.addEventListener('agentdomain:registration-completed', () => f.resolved++);
  function Capture() {
    const tracker = useRegistrationTracker();
    useEffect(() => {
      f.tracker = tracker;
      f.poll = async () => {
        // Finish any older observation before advancing to the next policy-allowed read.
        await tracker.refresh();
        f.now += tracker.getNextPollDelay(12000);
        await tracker.refresh();
      };
      f.switchWallet = (wallet) => { f.wallet = wallet; tracker.setExpectedWallet(wallet); return tracker.refresh(); };
      tracker.setExpectedWallet(f.wallet);
    }, [tracker]);
    return null;
  }
  createRoot(document.getElementById('root')).render(<RegistrationTrackerProvider>
    <Capture /><header style={{ height: 64, padding: '20px 24px', borderBottom: '1px solid hsl(var(--border))', fontWeight: 600 }}>AgentDomain</header>
    <main style={{ maxWidth: 920, margin: '32px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Dashboard</h1>
      <DashboardRegistrationUpdates />
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: '24px 0 12px' }}>Agents</h2>
      <p style={{ fontSize: 14 }}>No agents to display.</p>
    </main>
  </RegistrationTrackerProvider>);
`;
const boundaries = {
  'next/navigation': `export const useRouter = () => ({ push: path => { window.fixture.destination = path; } });`,
  'next/link': `import React from 'react'; export default function Link({children, ...props}) { return <a {...props}>{children}</a>; }`,
};
const bundle = await build({
  stdin: { contents: entry, loader: 'tsx', resolveDir: root },
  absWorkingDir: root,
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [
    {
      name: 'synthetic-notice-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /^(next\/navigation|next\/link)$/ }, (args) => ({
          path: args.path,
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: boundaries[args.path],
          loader: 'tsx',
          resolveDir: root,
        }));
      },
    },
  ],
});
const config = loadConfig(`${root}/tailwind.config.ts`);
config.content = [`${root}/src/components/register/registration-updates.tsx`];
const css = (
  await postcss([tailwind(config)]).process(readFileSync(`${root}/src/app/globals.css`, 'utf8'), {
    from: `${root}/src/app/globals.css`,
  })
).css;
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}body{font-family:system-ui,sans-serif}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
let notices = initialNotices();
let records = [record(1), record(2)];
let payer = wallet;
let authenticatedWallet = null;
let deleteFails = false;
let noticeReads = 0;
let releaseLink;
let linkStarted;
const mutations = [];
const external = [];
const registrationRecords = new Map();
const authenticatedStatusReplies = [];
await context.route('**/*', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (url.origin !== origin) {
    external.push(req.url());
    return route.abort();
  }
  if (url.pathname === '/fixture.js')
    return route.fulfill({
      contentType: 'application/javascript',
      body: bundle.outputFiles[0].text,
    });
  if (url.pathname === '/dashboard') return route.fulfill({ contentType: 'text/html', body: html });
  if (url.pathname === '/api/v1/auth/session')
    return route.fulfill({ json: { authenticated: true, address: payer } });
  if (!url.pathname.startsWith('/api/v1/')) return route.fulfill({ status: 404, body: '' });
  assert.equal(url.searchParams.get('expectedPayer'), payer);
  const headers = {
    'X-Authenticated-Wallet': authenticatedWallet ?? payer,
    'Cache-Control': 'no-store',
  };
  if (
    url.pathname === '/api/v1/registrations' ||
    url.pathname.startsWith('/api/v1/registrations/')
  ) {
    // Changing the list/notice scenario does not delete financial records already being tracked.
    for (const item of records)
      registrationRecords.set(`${payer}:${item.registrationId}`, { ...item });
    authenticatedStatusReplies.push({
      path: url.pathname,
      expectedPayer: url.searchParams.get('expectedPayer'),
      authenticatedWallet: headers['X-Authenticated-Wallet'],
    });
    if (url.pathname === '/api/v1/registrations')
      return route.fulfill({
        headers,
        json: { items: records, total: records.length, hasMore: false },
      });
    const item = registrationRecords.get(`${payer}:${url.pathname.split('/').pop()}`);
    return route.fulfill({
      status: item ? 200 : 404,
      headers,
      json: item ?? {},
    });
  }
  assert.ok(url.pathname.startsWith('/api/v1/registration-notices'), 'no financial write endpoint');
  if (req.method() === 'GET') {
    noticeReads++;
    return route.fulfill({
      headers,
      json: {
        items: notices.filter((item) => item.channel === url.searchParams.get('channel')),
        nextCursor: null,
      },
    });
  }
  mutations.push({ path: url.pathname, method: req.method(), body: req.postDataJSON() });
  if (req.method() === 'DELETE') {
    if (deleteFails) return route.fulfill({ status: 503, headers, json: {} });
    const id = decodeURIComponent(url.pathname.split('/').pop());
    notices = notices.filter(
      (item) => item.noticeId !== id || item.channel !== url.searchParams.get('channel'),
    );
    return route.fulfill({ status: 204, headers, body: '' });
  }
  if (req.method() === 'POST' && linkStarted) {
    linkStarted();
    await new Promise((resolve) => {
      releaseLink = resolve;
    });
    notices = notices.filter((item) => item.source !== 'client');
  }
  return route.fulfill({ headers, json: { items: [] } });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.setDefaultTimeout(15000);
const popup = page.locator('[data-registration-notification]');
const dashboard = page.getByRole('region', { name: 'Registration updates', exact: true });
const toggle = () => dashboard.getByRole('button', { name: /^Registration updates/ });
const poll = () => page.evaluate(() => window.fixture.poll());
async function screenshot(name) {
  await page.screenshot({
    path: `${screenshots}/${name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}
async function fits() {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const box = await popup.boundingBox();
  const size = page.viewportSize();
  assert.ok(box.x >= 11 && box.x + box.width <= size.width - 11, JSON.stringify({ box, size }));
  assert.ok(box.y >= 64 && box.y + box.height <= size.height);
  assert.equal(await popup.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.ok(await popup.evaluate((el) => parseFloat(getComputedStyle(el).borderRadius) <= 8));
}
try {
  await page.goto(`${origin}/dashboard`);
  await popup.waitFor();
  await toggle().waitFor();
  assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
  assert.match(await toggle().innerText(), /2/);
  assert.equal(await page.locator('[data-registration-pending]').count(), 0);
  await popup.getByRole('combobox').selectOption(`registration:${uuid(2)}`);
  assert.match(await popup.innerText(), /Payment confirmed/);
  await fits();
  await screenshot('multiple-desktop');
  // Canonical DB materialization is visible while POST client-link acknowledgement is still pending.
  notices.unshift(
    ...['popup', 'dashboard'].map((channel) => ({
      ...notice(1, channel),
      noticeId: `client:${start}-${uuid(1)}`,
      source: 'client',
      registrationId: null,
      status: 'submission_unknown',
      statusUrl: null,
    })),
  );
  await page.evaluate((attempt) => window.fixture.tracker.remember(attempt), {
    wallet,
    domain: domain(1),
    clientId: `${start}-${uuid(1)}`,
  });
  const linkingStarted = new Promise((resolve) => {
    linkStarted = resolve;
  });
  const linking = poll();
  await linkingStarted;
  assert.equal(await popup.locator('option').count(), 2);
  await screenshot('canonical-before-client-link');
  releaseLink();
  await linking;
  linkStarted = null;
  for (const [width, height] of [
    [390, 844],
    [320, 568],
  ]) {
    await page.setViewportSize({ width, height });
    await fits();
    await screenshot(`multiple-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await popup
    .getByRole('button', { name: 'Dismiss registration notification', exact: true })
    .click();
  await page.waitForFunction(() => window.fixture.tracker.getSnapshot().notices.popup.length === 1);
  assert.equal(await popup.getByRole('combobox').count(), 0);
  assert.equal(
    await toggle()
      .innerText()
      .then((s) => /2/.test(s)),
    true,
  );
  await toggle().click();
  assert.equal(await page.locator('[data-registration-pending]').count(), 2);
  await dashboard
    .getByRole('button', { name: 'Dismiss update for purchase-1.test', exact: true })
    .click();
  await page.waitForFunction(
    () => window.fixture.tracker.getSnapshot().notices.dashboard.length === 1,
  );
  assert.match(await popup.innerText(), /purchase-1.test/);
  await popup
    .getByRole('button', { name: 'Dismiss registration notification', exact: true })
    .click();
  await popup.waitFor({ state: 'hidden' });
  await screenshot('dashboard-group-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot('dashboard-group-mobile');
  await page.reload();
  await toggle().waitFor();
  assert.equal(await popup.count(), 0);
  await toggle().click();
  assert.equal(await page.locator('[data-registration-pending]').count(), 1);

  notices = initialNotices();
  records = [record(1), record(2)];
  await poll();
  await popup.waitFor();
  deleteFails = true;
  await popup
    .getByRole('button', { name: 'Dismiss registration notification', exact: true })
    .click();
  await popup.getByRole('alert').waitFor();
  assert.match(await popup.getByRole('alert').innerText(), /not confirmed/);
  await screenshot('dismiss-failure-mobile');
  deleteFails = false;
  await poll();
  await popup
    .getByRole('button', { name: 'Dismiss registration notification', exact: true })
    .click();
  await page.waitForFunction(() => window.fixture.tracker.getSnapshot().notices.popup.length === 1);

  // Remote dismissal/expiry on another device must replace the page, never merge stale rows.
  notices = [];
  await poll();
  await popup.waitFor({ state: 'hidden' });
  await dashboard.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.fixture.tracker.getSnapshot().items.length), 2);
  notices = ['popup', 'dashboard'].map((channel) => notice(4, channel));
  records = [
    { ...record(4), status: 'completed', stage: 'complete', agentId: 'agent-4', revision: 2 },
  ];
  await poll();
  await popup.getByText('Registration complete', { exact: true }).waitFor();
  await page.getByText('purchase-4.test registration complete', { exact: true }).waitFor();
  await page.reload();
  await popup.getByText('Registration complete', { exact: true }).waitFor();
  assert.equal(
    await page.getByText('purchase-4.test registration complete', { exact: true }).count(),
    0,
  );
  await toggle().click();
  await screenshot('completed-reload-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await screenshot('completed-reload-desktop');

  notices = ['popup', 'dashboard'].map((channel) => notice(5, channel));
  records = [
    {
      ...record(5),
      status: 'awaiting_payment',
      paymentStatus: 'unknown',
      stage: 'payment',
      messageCode: 'PAYMENT_AUTHORIZATION_CHECK_PENDING',
    },
  ];
  await poll();
  await popup.getByText('Authorization check pending', { exact: true }).waitFor();
  assert.doesNotMatch(
    await popup.innerText(),
    /Payment confirmed|Not charged|Payment status unavailable/,
  );
  await page.setViewportSize({ width: 320, height: 568 });
  await fits();
  await screenshot('authorization-check-320');
  records = [
    {
      ...records[0],
      status: 'action_required',
      messageCode: 'PAYMENT_AUTHORIZATION_REVIEW_REQUIRED',
      revision: 2,
    },
  ];
  await poll();
  await popup.getByText('Authorization needs review', { exact: true }).waitFor();
  assert.equal(
    await popup.getByRole('link', { name: 'Contact support', exact: true }).getAttribute('href'),
    'mailto:contact@agentdomain.app',
  );
  await fits();
  await screenshot('authorization-review-320');

  notices = ['popup', 'dashboard'].map((channel) => ({
    ...notice(3, channel),
    noticeId: `client:${start}-${uuid(3)}`,
    source: 'client',
    registrationId: null,
    status: 'submission_unknown',
    statusUrl: null,
  }));
  records = [];
  await poll();
  await popup.getByText(/Submission outcome is unconfirmed/).waitFor();
  assert.doesNotMatch(
    await popup.innerText(),
    /Payment confirmed|Payment pending|Elapsed|Confirming payment/,
  );
  await page.setViewportSize({ width: 320, height: 568 });
  await fits();
  await screenshot('unknown-320');
  const current = await page.evaluate(() => window.fixture.now);
  notices = notices.map((item) => ({
    ...item,
    expiresAt: new Date(current + 20000).toISOString(),
  }));
  await poll();
  await popup.waitFor();
  const readsBeforeExpiry = noticeReads;
  await page.evaluate(() => {
    window.fixture.now += 9000;
  });
  await popup.waitFor({ state: 'hidden' });
  assert.equal(
    noticeReads,
    readsBeforeExpiry,
    'DB timestamp expires the popup without a network read',
  );

  notices = initialNotices();
  records = [record(1), record(2)];
  await poll();
  await popup.waitFor();
  const beforeUnauthorized = await page.evaluate(() => ({
    requests: window.fixture.requests.length,
    connection: window.fixture.tracker.getSnapshot().connection,
    nextPollDelay: window.fixture.tracker.getNextPollDelay(12000),
  }));
  const beforeStatusReplies = authenticatedStatusReplies.length;
  assert.equal(
    beforeUnauthorized.connection,
    'ready',
    'Retained financial records must remain readable after notice expiry',
  );
  authenticatedWallet = other;
  await poll();
  const unauthorizedReads = await page.evaluate(
    (offset) => window.fixture.requests.slice(offset),
    beforeUnauthorized.requests,
  );
  assert.ok(
    unauthorizedReads.some((request) => request.url.startsWith('/api/v1/registrations')),
    `Cross-wallet check needs a fresh authenticated status read: ${JSON.stringify(beforeUnauthorized)}`,
  );
  assert.ok(
    authenticatedStatusReplies
      .slice(beforeStatusReplies)
      .some((reply) => reply.expectedPayer === wallet && reply.authenticatedWallet === other),
    'The negative auth case must actually receive a cross-wallet response',
  );
  await popup.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(() => window.fixture.tracker.getSnapshot().connection),
    'unauthorized',
  );
  assert.equal(await dashboard.count(), 0);
  authenticatedWallet = null;
  payer = other;
  notices = [];
  records = [];
  await page.evaluate((wallet) => window.fixture.switchWallet(wallet), other);
  assert.equal(await popup.count(), 0);
  assert.equal(await dashboard.count(), 0);
  await page.evaluate(() => window.fixture.switchWallet(null));
  assert.equal(await popup.count(), 0);
  const requests = await page.evaluate(() => window.fixture.requests);
  for (const request of requests)
    assert.deepEqual(
      [request.credentials, request.cache, request.redirect],
      ['include', 'no-store', 'error'],
    );
  assert.ok(noticeReads > 2);
  assert.ok(mutations.every((r) => ['DELETE', 'POST'].includes(r.method)));
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    `PASS: real tracker/provider/components; synthetic DB independent dismiss, multiple purchases, failure retry, remote removal, completed reload/toast gating, unknown copy, TTL, cross-wallet hiding; desktop/390/320 screenshots in ${screenshots}. No payments, signatures, provider calls, page errors.`,
  );
} catch (error) {
  await screenshot('failure');
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await context.close();
  await browser.close();
}
