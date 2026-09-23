import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] ?? 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '../../output/playwright/email-address-lifecycle');
await mkdir(output, { recursive: true });
const build = await stat(resolve(root, '.next/BUILD_ID'));
for (const path of [
  'src/components/agents/email-management.tsx',
  'src/lib/email-address-lifecycle.ts',
  'src/lib/backend-contracts.ts',
])
  assert.ok(
    build.mtimeMs >= (await stat(resolve(root, path))).mtimeMs,
    'Optimized build must include the current email UI',
  );
const buildId = (await readFile(resolve(root, '.next/BUILD_ID'), 'utf8')).trim();
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|USERPROFILE|HOME|APPDATA|LOCALAPPDATA)$/i.test(
      key,
    ),
  ),
);
const server = spawn(
  process.execPath,
  [
    '--import',
    './test/fixtures/email-management-public.mjs',
    './node_modules/next/dist/bin/next',
    'start',
    '-H',
    '127.0.0.1',
    '-p',
    String(port),
  ],
  {
    cwd: root,
    env: { ...environment, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let serverLog = '';
for (const stream of [server.stdout, server.stderr])
  stream.on('data', (chunk) => {
    serverLog = (serverLog + chunk).slice(-8000);
  });
const id = '00000000-0000-4000-8000-000000000001';
const wallet = '0x' + '1'.repeat(40);
const domain = 'long-email-lifecycle-fixture.example.test';
const at = '2026-09-20T00:00:00.000Z';
const original = {
  id: 'primary',
  agentId: id,
  emailAddress: 'agent@' + domain,
  kind: 'primary',
  status: 'active',
  createdAt: at,
  updatedAt: at,
};
const alias = { ...original, id: 'alias', kind: 'alias', emailAddress: 'billing@' + domain };
const message = {
  id: 'message',
  direction: 'inbound',
  fromAddress: 'sender@example.test',
  toAddress: original.emailAddress,
  subject: 'Preserved inbox message',
  text: 'Synthetic message body.',
  verificationCodes: [],
  spamVerdict: null,
  virusVerdict: null,
  receivedAt: at,
  read: true,
  status: 'accepted',
  lastError: null,
};
let browser;
const evidence = [];
try {
  let serverReady = false;
  for (let count = 0; count < 80; count++) {
    if (server.exitCode !== null) throw new Error('Production preview exited: ' + serverLog);
    try {
      if ((await fetch(origin + '/', { signal: AbortSignal.timeout(1000) })).ok) {
        serverReady = true;
        break;
      }
    } catch {}
    await delay(250);
  }
  assert.ok(serverReady, serverLog);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const width of [320, 390, 768, 1440]) {
    const touch = width < 1024;
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      hasTouch: touch,
      isMobile: width < 768,
    });
    const state = {
      legacy: false,
      addresses: [original, alias],
      change: null,
      unavailable: false,
      dropNext: false,
      rejectNext: false,
      mutations: [],
      syncReads: [],
      omitAddresses: false,
    };
    const inbox = () => ({
      id: 'inbox',
      agentId: id,
      emailAddress:
        state.addresses.find((entry) => entry.kind === 'primary' && entry.status === 'active')
          ?.emailAddress ?? original.emailAddress,
      verificationStatus: 'Success',
      dkimConfigured: true,
      spfConfigured: true,
      dmarcConfigured: true,
      createdAt: at,
    });
    await context.route('**/*', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin !== origin) {
        if (url.hostname === 'mainnet.base.org') {
          const body = request.postDataJSON();
          const response = (value) => ({ jsonrpc: '2.0', id: value.id, result: '0x0' });
          return route.fulfill({ json: Array.isArray(body) ? body.map(response) : response(body) });
        }
        return route.abort();
      }
      if (!url.pathname.startsWith('/api/v1/')) return route.continue();
      if (url.pathname === '/api/v1/auth/session')
        return route.fulfill({ json: { authenticated: true, address: wallet, chainId: 8453 } });
      if (url.pathname.endsWith('/management-view'))
        return route.fulfill({
          json: {
            agent: { id, walletAddress: wallet, metadataUri: null },
            dns: [],
            inbox: inbox(),
            publicConfig: {
              usdc: '0x' + '2'.repeat(40),
              renewalVault: null,
              metadataGateway: 'https://example.test',
              builderCode: null,
            },
          },
        });
      const email = `/api/v1/agents/${id}/email`;
      if (url.pathname === email && request.method() === 'GET') {
        const sync = url.searchParams.get('sync') === 'true';
        state.syncReads.push(sync);
        const pending = state.change && !['completed', 'cancelled'].includes(state.change.phase);
        return route.fulfill({
          json: {
            inbox: inbox(),
            messages: [message],
            ...(!state.omitAddresses ? { addresses: state.addresses } : {}),
            addressChange: state.unavailable ? { phase: 'unavailable' } : state.change,
            mailStatus: state.legacy
              ? { state: 'provider-managed' }
              : !sync
                ? { state: 'unchecked' }
                : {
                    state: pending ? 'pending' : 'ready',
                    checkedAt: at,
                    reason: 'PRIVATE_PROVIDER_ERROR',
                  },
            limits: { plan: 'starter', planLabel: 'Starter', emailAliases: 3 },
          },
        });
      }
      if ([email, email + '/aliases'].includes(url.pathname)) {
        const action =
          request.method() === 'PATCH'
            ? 'primary-rename'
            : request.method() === 'DELETE'
              ? 'alias-delete'
              : 'alias-create';
        const target =
          action === 'alias-delete'
            ? url.searchParams.get('emailAddress')
            : request.postDataJSON().username + '@' + domain;
        const requestId = request.headers()['idempotency-key'];
        assert.match(
          requestId,
          /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
        );
        state.mutations.push({ requestId, action, target, body: request.postData() });
        if (state.rejectNext) {
          state.rejectNext = false;
          return route.fulfill({
            status: 409,
            json: { code: 'EMAIL_ADDRESS_TAKEN', message: 'Address already assigned.' },
          });
        }
        if (state.dropNext) {
          state.dropNext = false;
          return route.abort('failed');
        }
        if (state.legacy) {
          if (action === 'alias-delete') {
            state.addresses = state.addresses.filter((entry) => entry.emailAddress !== target);
            return route.fulfill({ json: { deleted: true, addresses: state.addresses } });
          }
          throw new Error('Unexpected legacy mutation');
        }
        state.change = { requestId, action, target, phase: 'pending' };
        return route.fulfill({ status: 202, json: { change: state.change } });
      }
      if (url.pathname === email + '/send')
        throw new Error('This browser fixture never submits email');
      if (url.pathname === email + '/blocklist') return route.fulfill({ json: { entries: [] } });
      if (url.pathname === email + '/webhook') return route.fulfill({ json: { webhook: null } });
      if (url.pathname === email + '/usage')
        return route.fulfill({
          json: {
            used: 1,
            limit: 3000,
            sent: 0,
            received: 1,
            remaining: 2999,
            cycleEnd: '2026-10-20T00:00:00.000Z',
            requestsPerSecond: 5,
          },
        });
      if (url.pathname === '/api/v1/keys') return route.fulfill({ json: { keys: [] } });
      if (url.pathname.startsWith('/api/v1/registrations'))
        return route.fulfill({ json: { items: [], total: 0, hasMore: false } });
      return route.fulfill({ status: 404, json: {} });
    });
    await context.addInitScript(
      ({ wallet }) => {
        const handlers = new Map();
        window.ethereum = {
          isMetaMask: true,
          on(event, fn) {
            const set = handlers.get(event) ?? new Set();
            set.add(fn);
            handlers.set(event, set);
          },
          removeListener(event, fn) {
            handlers.get(event)?.delete(fn);
          },
          async request({ method }) {
            if (['eth_accounts', 'eth_requestAccounts'].includes(method)) return [wallet];
            if (method === 'eth_chainId') return '0x2105';
            if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions')
              return [{ parentCapability: 'eth_accounts' }];
            if (method.includes('sign') || method.includes('sendTransaction'))
              throw new Error('No real signing in browser fixture');
            return null;
          },
        };
      },
      { wallet },
    );
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    page.setDefaultTimeout(20000);
    const activate = (locator) => (touch ? locator.tap() : locator.click());
    const panel = page.locator('[aria-label="Email management"]');
    const refresh = async () => {
      await activate(panel.getByRole('button', { name: 'Refresh', exact: true }));
      await panel.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
      await page.waitForFunction(
        () => !document.querySelector('[aria-label="Email management"] button')?.disabled,
      );
    };
    const capture = async (name) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      const overflow = await page.evaluate(() => {
        const root = document.querySelector('[aria-label="Email management"]');
        return {
          page: document.documentElement.scrollWidth > innerWidth + 1,
          elements: [...root.querySelectorAll('*')]
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return box.width && box.height && (box.left < -1 || box.right > innerWidth + 1);
            })
            .map((el) => el.tagName + ':' + el.className)
            .slice(0, 8),
        };
      });
      assert.deepEqual(overflow, { page: false, elements: [] }, `${width}/${name}`);
      assert.doesNotMatch(await panel.innerText(), /PRIVATE_PROVIDER_ERROR/);
      const box = await panel.boundingBox();
      assert.ok(box);
      await page.screenshot({
        path: resolve(output, `${width}-${name}.png`),
        fullPage: true,
        clip: box,
      });
    };
    try {
      await page.goto(`${origin}/agents/${id}`, { timeout: 90000 });
      await panel.waitFor();
      await panel.getByText('Email not checked', { exact: true }).waitFor();
      await activate(panel.getByRole('button', { name: 'Send Email', exact: true }));
      await panel.getByPlaceholder('recipient@example.com').fill('recipient@example.test');
      await panel.getByPlaceholder('Subject', { exact: true }).fill('Preserved draft subject');
      await panel
        .getByPlaceholder('Message', { exact: true })
        .fill('Preserve the compose body through every address transition.');
      const from = panel.getByLabel('From address');
      const send = panel.getByRole('button', { name: 'Send email', exact: true });
      assert.equal(await send.isDisabled(), true);
      await refresh();
      await panel.getByText('Email ready', { exact: true }).waitFor();
      assert.equal(await from.inputValue(), original.emailAddress);
      await panel.getByLabel('Primary email username').fill('operations-team-with-a-long-address');
      await activate(panel.getByRole('button', { name: 'Update', exact: true }));
      await panel.getByText('Address change queued', { exact: true }).waitFor();
      assert.equal(await from.inputValue(), original.emailAddress);
      assert.equal(await send.isDisabled(), true);
      assert.equal(await panel.getByLabel('Primary email username').isDisabled(), true);
      assert.equal(await panel.getByLabel('Alias username').isDisabled(), true);
      assert.equal(await page.getByText('Primary email updated', { exact: true }).count(), 0);
      await capture('pending');
      const renamed = { ...original, emailAddress: state.change.target };
      state.addresses = [renamed, alias];
      for (const phase of ['native_applied', 'projected', 'uncertain', 'rejected']) {
        state.change.phase = phase;
        await refresh();
        await panel
          .getByText(
            ['uncertain', 'rejected'].includes(phase)
              ? 'Address change needs review'
              : 'Verifying address change',
            { exact: true },
          )
          .waitFor();
        assert.equal(
          await from.inputValue(),
          original.emailAddress,
          `${phase} must not force From`,
        );
        assert.equal(await send.isDisabled(), true);
        if (phase === 'projected' || phase === 'uncertain') await capture(phase);
      }
      state.unavailable = true;
      await refresh();
      await panel
        .getByRole('status')
        .getByText('Address status unavailable', { exact: true })
        .waitFor();
      assert.ok((await panel.innerText()).includes('Preserved inbox message'));
      assert.equal(await send.isDisabled(), true);
      await capture('unavailable');
      state.unavailable = false;
      state.change.phase = 'completed';
      await refresh();
      await panel.getByText('Address change completed', { exact: true }).waitFor();
      await page.waitForFunction(
        (target) => document.querySelector('[aria-label="From address"]')?.value === target,
        renamed.emailAddress,
      );
      assert.equal(await send.isDisabled(), false);
      await capture('completed');
      await from.selectOption(alias.emailAddress);
      await activate(
        panel.getByRole('button', { name: `Remove ${alias.emailAddress}`, exact: true }),
      );
      await panel.getByText('Address change queued', { exact: true }).waitFor();
      assert.equal(await from.inputValue(), alias.emailAddress);
      state.addresses = [renamed];
      state.change.phase = 'completed';
      await refresh();
      await page.waitForFunction(
        (target) => document.querySelector('[aria-label="From address"]')?.value === target,
        renamed.emailAddress,
      );
      assert.equal(await from.locator('option', { hasText: alias.emailAddress }).count(), 0);
      state.change = null;
      state.dropNext = true;
      await panel.getByLabel('Alias username').fill('support');
      await activate(panel.getByRole('button', { name: 'Add', exact: true }));
      await panel.getByText('Request status unknown', { exact: true }).waitFor();
      const unknown = state.mutations.at(-1);
      await refresh();
      await panel.getByText('Request status unknown', { exact: true }).waitFor();
      assert.equal(await send.isDisabled(), true);
      await capture('unknown');
      await activate(panel.getByRole('button', { name: 'Retry request', exact: true }));
      await panel.getByText('Address change queued', { exact: true }).waitFor();
      assert.deepEqual(
        state.mutations.at(-1),
        unknown,
        'Explicit retry must preserve UUID and payload',
      );
      state.change.phase = 'cancelled';
      await refresh();
      await panel.getByText('Address change cancelled', { exact: true }).waitFor();
      assert.equal(await panel.getByLabel('Alias username').isDisabled(), false);
      assert.equal(
        await panel.getByPlaceholder('Message', { exact: true }).inputValue(),
        'Preserve the compose body through every address transition.',
      );
      assert.equal(
        await panel.getByPlaceholder('Subject', { exact: true }).inputValue(),
        'Preserved draft subject',
      );
      await capture('cancelled');
      state.rejectNext = true;
      await panel.getByLabel('Alias username').fill('billing');
      await activate(panel.getByRole('button', { name: 'Add', exact: true }));
      await page.getByText('Address change rejected', { exact: true }).waitFor();
      assert.equal(await panel.getByText('Request status unknown', { exact: true }).count(), 0);
      assert.equal(await panel.getByRole('button', { name: 'Retry request' }).count(), 0);
      assert.equal(await panel.getByLabel('Alias username').isDisabled(), false);
      assert.equal(
        await panel.getByPlaceholder('Subject', { exact: true }).inputValue(),
        'Preserved draft subject',
      );
      state.addresses = [];
      state.change = null;
      await refresh();
      await page.waitForFunction(
        () => document.querySelector('[aria-label="From address"]')?.value === '',
      );
      assert.equal(await send.isDisabled(), true);
      state.legacy = true;
      state.addresses = [original, alias];
      await page.reload();
      await panel.waitFor();
      await activate(panel.getByRole('button', { name: 'Send Email', exact: true }));
      await from.selectOption(alias.emailAddress);
      await activate(
        panel.getByRole('button', { name: `Remove ${alias.emailAddress}`, exact: true }),
      );
      await page.waitForFunction(
        (target) => document.querySelector('[aria-label="From address"]')?.value === target,
        original.emailAddress,
      );
      assert.equal(await from.locator('option', { hasText: alias.emailAddress }).count(), 0);
      await capture('legacy');
      assert.deepEqual(errors, []);
      evidence.push({
        width,
        touch,
        mutations: state.mutations.length,
        syncTrueReads: state.syncReads.filter(Boolean).length,
        draftPreserved: true,
        overflow: false,
      });
    } finally {
      await context.close();
    }
  }
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify({ buildId, origin, optimizedBuild: true, liveWrites: false, evidence }, null, 2),
  );
  console.log(JSON.stringify({ buildId, optimizedBuild: true, screenshots: output, evidence }));
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    if (process.platform === 'win32')
      execFileSync('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    else server.kill('SIGTERM');
    await new Promise((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once('exit', resolve);
    });
  }
}
