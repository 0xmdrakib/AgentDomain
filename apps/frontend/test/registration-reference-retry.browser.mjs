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
const screenshots = `${root}/.qa/registration-reference-retry`;
await mkdir(screenshots, { recursive: true });
const boundaries = {
  wagmi: `export const useAccount = () => ({ address: window.fixture.wallet, isConnected: true });
    export const useConfig = () => ({});
    export const useWalletClient = () => ({ data: { account: { address: window.fixture.wallet } } });`,
  'wagmi/actions': `export const getAccount = () => ({ address: window.fixture.wallet });
    export const getWalletClient = async () => ({ account: { address: window.fixture.wallet } });`,
  '@agentdomain/sdk': `export const createX402PaymentHeaders = async () => {
    window.fixture.signatures++;
    return { 'PAYMENT-SIGNATURE': 'synthetic-never-persist' };
  };`,
  '@/hooks/use-base-chain': `export const useBaseChainGuard = () => ({ effectiveChainId: 8453, isBaseChain: true, isSwitchingBase: false, ensureBaseChain: async () => true });`,
  '@/lib/base-chain': `export const BASE_MAINNET_CHAIN_ID = 8453;
    export class BaseChainRequiredError extends Error {}
    export const isBaseChainRequiredError = () => false;
    export const isBaseChainMismatchError = () => false;
    export const getBaseChainSwitchCopy = () => ({});`,
  '@/lib/transaction-errors': `export const getTransactionErrorCopy = () => ({ kind: 'error' });`,
  '@/hooks/use-siwe': `export const useSiwe = () => ({ session: { authenticated: true, address: window.fixture.wallet }, signIn: async () => true, loading: false });`,
  '@/hooks/use-usdc-balance': `export const useUsdcBalance = () => ({ balanceAtomic: 1000000000000n, balanceNumber: 1000000, balanceFormatted: '1000000', isLoading: false });`,
  '@/components/register/registration-tracker-provider': `import { useSyncExternalStore } from 'react';
    export const useRegistrationSnapshot = () => useSyncExternalStore(window.fixture.tracker.subscribe, window.fixture.tracker.getSnapshot);
    export const useRegistrationTracker = () => window.fixture.tracker;`,
  '@/components/wallet/connect-wallet-button': `export const ConnectWalletButton = () => null;`,
  'next/link': `import React from 'react'; export default function Link({ children, ...props }) { return <a {...props}>{children}</a>; }`,
  sonner: `export const toast = { error() {}, info() {} };`,
};
const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { RegisterFlow } from './src/components/register/register-flow';
  import { RegistrationTracker } from './src/lib/registration-tracker';
  const f = window.fixture = { wallet: '0x' + '1'.repeat(40), reference: '0x' + 'a'.repeat(64), records: [], signatures: 0, paidPosts: 0 };
  f.reservationKey = 'agentdomain:registration-submission:' + f.wallet + ':reference.xyz';
  window.fetch = async (input, options) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname === '/api/v1/auth/session') return Response.json({ authenticated: true, address: f.wallet }, { headers: { Date: new Date().toUTCString() } });
    if (url.pathname === '/api/v1/domains/availability') return Response.json({ domain: 'reference.xyz', available: true, basenameAvailable: true, ensAvailable: true });
    if (url.pathname === '/api/v1/agents/quote') return Response.json({ domainCostUsdc: '1', basenameCostUsdc: '0', ensCostUsdc: '0', serviceFeeUsdc: '1', premiumPlan: 'included', premiumPlanLabel: 'Included', premiumPlanFeeUsdc: '0', emailFeeUsdc: '0', sslCertificationFeeUsdc: '0', totalUsdc: '2' });
    if (url.pathname === '/api/v1/agents/register') {
      if (new Headers(options?.headers).has('PAYMENT-SIGNATURE')) {
        f.paidPosts++;
        throw new Error('Synthetic lost decline response');
      }
      return Response.json({ accepts: [{ amount: '1234567', extra: { requestBinding: f.reference } }] }, { status: 402 });
    }
    if (url.searchParams.get('expectedPayer') !== f.wallet) throw new Error('Missing payer binding');
    const headers = { 'X-Authenticated-Wallet': f.wallet };
    if (url.pathname.startsWith('/api/v1/registration-notices')) return Response.json({ items: [], nextCursor: null }, { headers });
    if (url.pathname === '/api/v1/registrations') return Response.json({ items: f.records, hasMore: false, total: f.records.length }, { headers });
    if (url.pathname.startsWith('/api/v1/registrations/')) return Response.json(f.records.find(r => r.registrationId === url.pathname.split('/').pop()) ?? {}, { headers });
    throw new Error('Forbidden synthetic request: ' + url);
  };
  f.tracker = new RegistrationTracker({ storage: localStorage, random: () => 0 });
  f.tracker.setExpectedWallet(f.wallet);
  f.poll = () => f.tracker.refresh();
  f.rejection = (reference) => {
    const saved = JSON.parse(localStorage.getItem(f.reservationKey));
    f.records = [{ registrationId: '00000000-0000-4000-8000-000000000001', statusUrl: '/api/v1/registrations/00000000-0000-4000-8000-000000000001',
      domain: saved.domain, status: 'failed', paymentStatus: 'not_charged', paymentReference: reference,
      messageCode: 'PAYMENT_NOT_SUBMITTED', stage: 'payment', agentId: null,
      startedAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      revision: 1, completedAt: null, completionEventId: null, estimatedDurationSeconds: null, pollAfterSeconds: 5 }];
  };
  f.hold = () => new Promise(resolve => {
    f.holding = navigator.locks.request(f.reservationKey, { mode: 'exclusive' }, async () => {
      resolve(); await new Promise(release => { f.release = release; });
    });
  });
  createRoot(document.getElementById('root')).render(<RegisterFlow />);
`;
const bundle = await build({
  stdin: { contents: entry, loader: 'tsx', resolveDir: root },
  absWorkingDir: root,
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  define: {
    'process.env.NODE_ENV': '"development"',
    'process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY': '""',
  },
  plugins: [
    {
      name: 'synthetic-reference-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          const name =
            args.path === './registration-tracker-provider'
              ? '@/components/register/registration-tracker-provider'
              : args.path;
          if (name in boundaries) return { path: name, namespace: 'reference-fixture' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'reference-fixture' }, (args) => ({
          contents: boundaries[args.path],
          loader: 'tsx',
          resolveDir: root,
        }));
      },
    },
  ],
});
const config = loadConfig(`${root}/tailwind.config.ts`);
config.content = [
  `${root}/src/components/register/register-flow.tsx`,
  `${root}/src/components/ui/*.tsx`,
];
const css = (
  await postcss([tailwind(config)]).process(readFileSync(`${root}/src/app/globals.css`, 'utf8'), {
    from: `${root}/src/app/globals.css`,
  })
).css;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const external = [];
  const errors = [];
  await context.route('**/*', (route) => {
    if (route.request().url() === 'https://synthetic-reference.test/')
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:Arial,sans-serif"><main style="max-width:800px;margin:auto;padding:16px"><div id="root"></div></main></body></html>',
      });
    external.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('https://synthetic-reference.test/');
  await page.clock.install();
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByPlaceholder('myagent', { exact: true }).first().fill('reference');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Register agent identity', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Submission outcome is unconfirmed' }).waitFor();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem(window.fixture.reservationKey)).paymentReference,
    ),
    `0x${'a'.repeat(64)}`,
  );
  await page.clock.fastForward(125001);
  await page.getByRole('button', { name: 'Purchase needs review', exact: true }).waitFor();
  await page.evaluate(() => window.fixture.rejection('0x' + 'b'.repeat(64)));
  await page.evaluate(() => window.fixture.poll());
  assert.equal(
    await page.getByRole('button', { name: 'Purchase needs review', exact: true }).isDisabled(),
    true,
  );
  assert.ok(await page.evaluate(() => localStorage.getItem(window.fixture.reservationKey)));
  await page.evaluate(() => {
    window.fixture.rejection(window.fixture.reference);
    window.fixture.records[0].revision = 2;
  });
  await page.evaluate(() => window.fixture.hold());
  await page.clock.fastForward(10001);
  await page.evaluate(() => window.fixture.poll());
  assert.equal(
    await page.getByRole('button', { name: 'Purchase needs review', exact: true }).isDisabled(),
    true,
  );
  await page.evaluate(async () => {
    window.fixture.release();
    await window.fixture.holding;
  });
  await page.clock.fastForward(10001);
  await page.evaluate(() => window.fixture.poll());
  const released = page.getByText(
    'Payment was not submitted. This checkout was not charged. Check the price before trying again.',
    { exact: true },
  );
  await released.waitFor();
  assert.equal(await page.getByText(/Submission outcome is unconfirmed/).count(), 0);
  assert.equal(
    await page.evaluate(() => localStorage.getItem(window.fixture.reservationKey)),
    null,
  );
  assert.equal(await page.getByRole('button', { name: 'Search', exact: true }).isDisabled(), false);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Register agent identity', exact: true });
  await retry.waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (button) => button.textContent.includes('Register agent identity') && !button.disabled,
    ),
  );
  assert.equal(await retry.isEnabled(), true);
  await page.evaluate(async () => {
    window.fixture.tracker.invalidate();
    await window.fixture.tracker.refresh();
  });
  await released.waitFor();
  await page.clock.fastForward(10001);
  await page.evaluate(() => window.fixture.poll());
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (button) => button.textContent.includes('Register agent identity') && !button.disabled,
    ),
  );
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await released.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${screenshots}/confirmed-retry-${width}.png`, fullPage: true });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  }
  assert.deepEqual(
    await page.evaluate(() => [window.fixture.signatures, window.fixture.paidPosts]),
    [1, 1],
  );
  assert.doesNotMatch(
    await page.evaluate(() => Object.values(localStorage).join('')),
    /synthetic-never-persist/,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await context.close();
  console.log(
    'PASS: real RegisterFlow/hook/tracker + native Web Locks; wrong nonce and busy lock stay guarded, exact confirmed release enables retry and clears uncertainty. Desktop/390/320 screenshots. No live wallet/provider calls or automatic repayments.',
  );
} finally {
  await browser.close();
}
