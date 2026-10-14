import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] ?? 'playwright-core');
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const root = fileURLToPath(new URL('../', import.meta.url));
const wallet = '0x' + '1'.repeat(40);
const other = '0x' + '2'.repeat(40);
const boundaries = {
  wagmi: `
    import { useSyncExternalStore } from 'react';
    const config = {};
    const subscribe = callback => {
      window.fixture.listeners.add(callback);
      return () => window.fixture.listeners.delete(callback);
    };
    export function useAccount() {
      const address = useSyncExternalStore(subscribe, () => window.fixture.address);
      return { address, isConnected: Boolean(address) };
    }
    export const useChainId = () => 8453;
    export const useConfig = () => config;
    export const useSignMessage = () => ({ signMessageAsync: window.fixture.sign });
  `,
  '@/lib/wagmi': `export const clearWalletConnectionStorage = () => window.fixture.clears++;`,
  '@/lib/wallet-connections': `export const disconnectWalletConnections = async () => {
    window.fixture.disconnects++;
    if (window.fixture.holdDisconnect)
      await new Promise(resolve => window.fixture.releaseDisconnect = resolve);
  };`,
};
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { useSiwe } from './src/hooks/use-siwe';
      const f = window.fixture = {
        address: '${wallet}', listeners: new Set(), deadlines: [], requests: [],
        mode: {}, signatures: 0, disconnects: 0, clears: 0,
        session: { authenticated: false },
      };
      f.changeWallet = address => {
        f.address = address;
        for (const callback of f.listeners) callback();
      };
      f.sign = async () => {
        f.signatures++;
        return new Promise((resolve, reject) => {
          f.approve = () => resolve('synthetic-signature');
          f.reject = () => reject(new Error('User rejected the request'));
        });
      };
      AbortSignal.timeout = ms => {
        const controller = new AbortController();
        f.deadlines.push({ ms, controller });
        return controller.signal;
      };
      f.expire = () => {
        for (const { controller } of f.deadlines)
          controller.abort(new DOMException('Expired', 'TimeoutError'));
      };
      window.fetch = async (path, init) => {
        const kind = init.method === 'DELETE' ? 'sign-out' : path.split('/').pop();
        const request = { kind, signal: init.signal, body: init.body };
        f.requests.push(request);
        if (f.mode[kind] === 'stall' || f.mode[kind] === 'late') {
          return new Promise((resolve, reject) => {
            request.resolve = data => resolve(Response.json(data));
            if (f.mode[kind] !== 'late')
              init.signal.addEventListener('abort', () => reject(init.signal.reason));
          });
        }
        if (f.mode[kind] === 'network') throw new TypeError('Failed to fetch');
        if (f.mode[kind] === 'http-error') return Response.json({}, { status: 503 });
        if (kind === 'nonce') return Response.json({ nonce: 'syntheticnonce' });
        if (kind === 'session') return Response.json(f.session);
        if (kind === 'verify') {
          f.session = { authenticated: true, address: f.address, chainId: 8453 };
          return Response.json(f.session);
        }
        f.session = { authenticated: false };
        return new Response(null, { status: 204 });
      };
      function Harness() {
        const hook = useSiwe();
        f.hook = hook;
        return <main>
          <button onClick={hook.signIn} disabled={hook.loading}>Sign in</button>
          <button onClick={hook.signOut} disabled={hook.loading}>Sign out</button>
          <div role="alert">{hook.error}</div>
          <output>{JSON.stringify(hook.session)}</output>
        </main>;
      }
      const app = createRoot(document.getElementById('root'));
      f.unmount = () => app.unmount();
      app.render(<Harness />);
    `,
  },
  absWorkingDir: root,
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'synthetic-wallet-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          args.path in boundaries ? { path: args.path, namespace: 'synthetic-wallet' } : undefined,
        );
        builder.onLoad({ filter: /.*/, namespace: 'synthetic-wallet' }, (args) => ({
          contents: boundaries[args.path],
          loader: 'tsx',
          resolveDir: root,
        }));
      },
    },
  ],
});

const browser = await chromium.launch({
  ...(process.env.AGENTDOMAIN_TEST_BROWSER_EXECUTABLE
    ? { executablePath: process.env.AGENTDOMAIN_TEST_BROWSER_EXECUTABLE }
    : { channel: process.platform === 'win32' ? 'msedge' : 'chrome' }),
  headless: true,
});
const fixtureUrl = 'http://127.0.0.1/siwe-fixture';
let passed = 0;
async function scenario(name, run) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const errors = [];
  await context.route('**/*', (route) =>
    route.request().url() === fixtureUrl
      ? route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><div id="root"></div>',
        })
      : route.abort('blockedbyclient'),
  );
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(5000);
  try {
    await page.goto(fixtureUrl);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => window.fixture.hook && window.fixture.requests.length === 1);
    await run(page);
    assert.deepEqual(errors, [], name);
    assert.ok(
      await page.evaluate(() => window.fixture.deadlines.every((item) => item.ms === 10_000)),
    );
    console.log('PASS', name);
    passed++;
  } finally {
    await context.close();
  }
}
const idle = (page) => page.waitForFunction(() => !window.fixture.hook.loading);
const pendingSignature = (page) => page.waitForFunction(() => window.fixture.signatures > 0);
const count = (page, kind) =>
  page.evaluate(
    (kind) => window.fixture.requests.filter((item) => item.kind === kind).length,
    kind,
  );

try {
  await scenario(
    'nonce timeout resets loading with visible retry; manual retry alone opens wallet',
    async (page) => {
      await page.evaluate(() => {
        window.fixture.mode.nonce = 'stall';
      });
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForFunction(() =>
        window.fixture.requests.some((item) => item.kind === 'nonce'),
      );
      await page.evaluate(() => window.fixture.expire());
      await idle(page);
      assert.match(
        await page.getByRole('alert').innerText(),
        /Sign-in request timed out.*try again/,
      );
      assert.equal(await page.evaluate(() => window.fixture.signatures), 0);
      assert.equal(await count(page, 'nonce'), 1);
      assert.equal(
        await page.getByRole('button', { name: 'Sign in', exact: true }).isDisabled(),
        false,
      );
      await page.evaluate(() => {
        window.fixture.mode.nonce = null;
      });
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await pendingSignature(page);
      assert.equal(await count(page, 'nonce'), 2);
    },
  );

  await scenario(
    'pending wallet prompt has no HTTP timeout or duplicate signature; rejection resets loading',
    async (page) => {
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await pendingSignature(page);
      await page.evaluate(() => window.fixture.expire());
      assert.equal(await page.evaluate(() => window.fixture.hook.signIn()), false);
      assert.equal(await page.evaluate(() => window.fixture.hook.loading), true);
      assert.equal(await page.getByRole('alert').innerText(), '');
      assert.equal(await page.evaluate(() => window.fixture.signatures), 1);
      assert.equal(await count(page, 'verify'), 0);
      await page.evaluate(() => window.fixture.reject());
      await idle(page);
      assert.match(await page.getByRole('alert').innerText(), /Wallet signature request cancelled/);
    },
  );

  await scenario(
    'verify timeout never resends or resigns; explicit retry succeeds',
    async (page) => {
      await page.evaluate(() => {
        window.fixture.mode.verify = 'stall';
      });
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await pendingSignature(page);
      await page.evaluate(() => window.fixture.approve());
      await page.waitForFunction(() =>
        window.fixture.requests.some((item) => item.kind === 'verify'),
      );
      await page.evaluate(() => window.fixture.expire());
      await idle(page);
      assert.match(await page.getByRole('alert').innerText(), /Sign-in verification timed out/);
      assert.equal(await count(page, 'verify'), 1);
      assert.equal(await page.evaluate(() => window.fixture.signatures), 1);
      assert.equal(await page.evaluate(() => window.fixture.hook.session.authenticated), false);
      await page.evaluate(() => {
        window.fixture.mode.verify = null;
      });
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForFunction(() => window.fixture.signatures === 2);
      await page.evaluate(() => window.fixture.approve());
      await idle(page);
      assert.equal(await page.evaluate(() => window.fixture.hook.session.authenticated), true);
      assert.equal(await count(page, 'verify'), 2);
    },
  );

  await scenario(
    'superseded session reads are aborted and cannot overwrite a newer session',
    async (page) => {
      await page.evaluate(() => {
        window.fixture.mode.session = 'late';
        window.dispatchEvent(new Event('agentdomain:session-changed'));
      });
      await page.waitForFunction(() => window.fixture.requests.length === 2);
      await page.evaluate(() => {
        const f = window.fixture;
        f.mode.session = null;
        f.session = { authenticated: true, address: f.address, chainId: 8453 };
        window.dispatchEvent(new Event('agentdomain:session-changed'));
      });
      await page.waitForFunction(() => window.fixture.hook.session.authenticated);
      assert.equal(await page.evaluate(() => window.fixture.requests[1].signal.aborted), true);
      await page.evaluate(() => window.fixture.requests[1].resolve({ authenticated: false }));
      assert.equal(await page.evaluate(() => window.fixture.hook.session.authenticated), true);
    },
  );

  await scenario(
    'session timeout fails closed with visible retry; manual sign-in clears the read error',
    async (page) => {
      await page.evaluate(() => {
        window.fixture.mode.session = 'stall';
        window.dispatchEvent(new Event('agentdomain:session-changed'));
      });
      await page.waitForFunction(() => window.fixture.requests.length === 2);
      await page.evaluate(() => window.fixture.expire());
      await page.waitForFunction(() => Boolean(window.fixture.hook.error));
      assert.match(await page.getByRole('alert').innerText(), /Session check timed out.*try again/);
      assert.equal(await page.evaluate(() => window.fixture.hook.session.authenticated), false);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await pendingSignature(page);
      assert.equal(await page.getByRole('alert').innerText(), '');
    },
  );

  await scenario('unmount aborts session HTTP and removes refresh listeners', async (page) => {
    await page.evaluate(() => {
      window.fixture.mode.session = 'stall';
      window.dispatchEvent(new Event('agentdomain:session-changed'));
    });
    await page.waitForFunction(() => window.fixture.requests.length === 2);
    await page.evaluate(() => window.fixture.unmount());
    assert.equal(await page.evaluate(() => window.fixture.requests[1].signal.aborted), true);
    await page.evaluate(() => window.dispatchEvent(new Event('agentdomain:session-changed')));
    assert.equal(await count(page, 'session'), 2);
  });

  await scenario(
    'wallet change aborts nonce HTTP without opening a stale signing prompt',
    async (page) => {
      await page.evaluate(() => {
        window.fixture.mode.nonce = 'stall';
      });
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForFunction(() =>
        window.fixture.requests.some((item) => item.kind === 'nonce'),
      );
      await page.evaluate((other) => window.fixture.changeWallet(other), other);
      await idle(page);
      assert.equal(await page.evaluate(() => window.fixture.signatures), 0);
      assert.equal(
        await page.evaluate(
          () => window.fixture.requests.find((item) => item.kind === 'nonce').signal.aborted,
        ),
        true,
      );
    },
  );

  await scenario(
    'wallet change does not fake-cancel a pending prompt or verify its late signature',
    async (page) => {
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await pendingSignature(page);
      await page.evaluate((other) => window.fixture.changeWallet(other), other);
      assert.equal(await page.evaluate(() => window.fixture.hook.loading), true);
      assert.equal(await page.evaluate(() => window.fixture.hook.signIn()), false);
      await page.evaluate(() => window.fixture.approve());
      await idle(page);
      assert.equal(await count(page, 'verify'), 0);
      assert.equal(await page.evaluate(() => window.fixture.hook.session.authenticated), false);
      assert.equal(await page.getByRole('alert').innerText(), '');
    },
  );

  await scenario(
    'wallet B session is restored once after the obsolete wallet A prompt settles',
    async (page) => {
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await pendingSignature(page);
      await page.evaluate((other) => {
        const f = window.fixture;
        f.session = { authenticated: true, address: other, chainId: 8453 };
        f.changeWallet(other);
      }, other);
      await page.waitForFunction(
        () => window.fixture.requests.find((item) => item.kind === 'nonce').signal.aborted,
      );
      await page.evaluate(() => {
        for (let i = 0; i < 3; i++) window.dispatchEvent(new Event('agentdomain:session-changed'));
      });
      assert.equal(await count(page, 'session'), 1);
      assert.equal(await page.evaluate(() => window.fixture.hook.signIn()), false);
      await page.evaluate(() => window.fixture.approve());
      await page.waitForFunction(() => window.fixture.hook.session.authenticated);
      assert.equal(await page.evaluate(() => window.fixture.hook.session.address), other);
      assert.equal(await count(page, 'session'), 2);
      assert.equal(await count(page, 'verify'), 0);
      assert.equal(await page.evaluate(() => window.fixture.signatures), 1);
    },
  );

  for (const phase of ['request', 'disconnect']) {
    await scenario(
      `unmount during sign-out ${phase} prevents late cleanup or queued reads`,
      async (page) => {
        await page.evaluate((phase) => {
          const f = window.fixture;
          f.session = { authenticated: true, address: f.address, chainId: 8453 };
          if (phase === 'request') f.mode['sign-out'] = 'late';
          else f.holdDisconnect = true;
          window.dispatchEvent(new Event('agentdomain:session-changed'));
        }, phase);
        await page.waitForFunction(() => window.fixture.hook.session.authenticated);
        await page.evaluate(() => {
          window.fixture.operation = window.fixture.hook.signOut();
        });
        await page.waitForFunction(
          (phase) =>
            phase === 'request'
              ? window.fixture.requests.some((item) => item.kind === 'sign-out')
              : window.fixture.disconnects === 1,
          phase,
        );
        const reads = await count(page, 'session');
        await page.evaluate(() => {
          window.dispatchEvent(new Event('agentdomain:session-changed'));
          window.fixture.unmount();
        });
        await page.evaluate(async (phase) => {
          const f = window.fixture;
          if (phase === 'request') f.requests.find((item) => item.kind === 'sign-out').resolve({});
          else f.releaseDisconnect();
          await f.operation;
        }, phase);
        assert.equal(await page.evaluate(() => window.fixture.clears), 0);
        assert.equal(await count(page, 'session'), reads);
        assert.equal(
          await page.evaluate(() => window.fixture.disconnects),
          phase === 'request' ? 0 : 1,
        );
      },
    );
  }

  await scenario(
    'failed sign-out remains authenticated with retry; successful retry disconnects once',
    async (page) => {
      await page.evaluate(() => {
        const f = window.fixture;
        f.session = { authenticated: true, address: f.address, chainId: 8453 };
        f.mode['sign-out'] = 'stall';
        window.dispatchEvent(new Event('agentdomain:session-changed'));
      });
      await page.waitForFunction(() => window.fixture.hook.session.authenticated);
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.waitForFunction(() =>
        window.fixture.requests.some((item) => item.kind === 'sign-out'),
      );
      await page.evaluate(() => window.fixture.expire());
      await idle(page);
      assert.match(await page.getByRole('alert').innerText(), /Sign-out request timed out/);
      assert.deepEqual(
        await page.evaluate(() => [
          window.fixture.hook.session.authenticated,
          window.fixture.disconnects,
          window.fixture.clears,
        ]),
        [true, 0, 0],
      );
      await page.evaluate(() => {
        window.fixture.mode['sign-out'] = 'http-error';
      });
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await idle(page);
      assert.match(await page.getByRole('alert').innerText(), /failed \(503\)/);
      assert.equal(await page.evaluate(() => window.fixture.hook.session.authenticated), true);
      await page.evaluate(() => {
        window.fixture.mode['sign-out'] = null;
      });
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await idle(page);
      assert.deepEqual(
        await page.evaluate(() => [
          window.fixture.hook.session.authenticated,
          window.fixture.disconnects,
          window.fixture.clears,
        ]),
        [false, 1, 1],
      );
    },
  );
  console.log(
    `${passed} SIWE hook browser regressions passed (synthetic fixture, not production visual QA).`,
  );
} finally {
  await browser.close();
}
