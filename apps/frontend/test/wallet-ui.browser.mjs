import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] ?? 'playwright');
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const loadConfig = require('tailwindcss/loadConfig');
const root = fileURLToPath(new URL('../', import.meta.url));
const captures = resolve(root, '.qa/wallet-ui');
const icon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><path fill="#0052ff" d="M0 0h96v96H0z"/><circle fill="white" cx="48" cy="48" r="28"/></svg>')}`;

// Wallet discovery, connector state and UI are real. Only the EIP-1193 provider and
// Next wrappers are fixtures; no account signatures, transactions or remote RPCs run.
const bundle = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { WagmiProvider } from 'wagmi';
      import { getConnections } from 'wagmi/actions';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import { getWagmiConfig } from './src/lib/wagmi';
      import { LandingNav } from './src/components/landing/nav';
      import { ConnectWalletButton } from './src/components/wallet/connect-wallet-button';
      const listeners = new Map();
      const f = window.fixture = { calls: [], accounts: [] };
      f.emit = (event, value) => { for (const listener of listeners.get(event) ?? []) listener(value); };
      f.provider = {
        isCoinbaseWallet: true,
        on(event, listener) {
          const list = listeners.get(event) ?? new Set();
          list.add(listener);
          listeners.set(event, list);
        },
        removeListener(event, listener) { listeners.get(event)?.delete(listener); },
        async request({ method }) {
          f.calls.push(method);
          if (method === 'eth_chainId') return '0x2105';
          if (method === 'eth_accounts') return f.accounts;
          if (method === 'wallet_requestPermissions' || method === 'eth_requestAccounts') {
            f.accounts = ['0x' + '1'.repeat(40)];
            return method === 'eth_requestAccounts' ? f.accounts : [{ caveats: [{ value: f.accounts }] }];
          }
          if (method === 'wallet_revokePermissions') {
            // A legacy wallet can lack programmatic revocation; wagmi must preserve its shim.
            throw Object.assign(new Error('Method not supported'), { code: 4200 });
          }
          throw new Error('Unexpected fixture RPC: ' + method);
        },
      };
      window.ethereum = f.provider;
      f.detail = Object.freeze({ info: {
        uuid: '350670db-19fa-4704-a166-e52e178b59d2',
        rdns: 'com.coinbase.wallet', name: 'Coinbase Wallet', icon: ${JSON.stringify(icon)},
      }, provider: f.provider });
      f.announce = (detail = f.detail) => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
      window.addEventListener('eip6963:requestProvider', () => f.announce());
      const config = f.config = getWagmiConfig();
      f.connections = () => getConnections(config).map(connection => ({ id: connection.connector.id, uid: connection.connector.uid }));
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      createRoot(document.getElementById('root')).render(
        <WagmiProvider config={config} reconnectOnMount={false}>
          <QueryClientProvider client={client}>
            <LandingNav />
            <main style={{ padding: 24, minHeight: '180vh' }}>
              <h1>Wallet fixture</h1>
              <ConnectWalletButton />
            </main>
          </QueryClientProvider>
        </WagmiProvider>
      );
    `,
    loader: 'tsx',
    resolveDir: root,
  },
  absWorkingDir: root,
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  splitting: true,
  outdir: resolve(root, '.qa/wallet-ui/bundle'),
  entryNames: 'wallet-fixture',
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"development"',
    'process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID': '""',
  },
  plugins: [
    {
      name: 'wallet-next-wrappers',
      setup(builder) {
        builder.onResolve({ filter: /^next\/(image|link)$/ }, ({ path }) => ({
          path,
          namespace: 'wallet-next',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'wallet-next' }, ({ path }) => ({
          contents:
            path === 'next/link'
              ? "import React from 'react'; export default function Link({children,...props}) { return <a {...props}>{children}</a>; }"
              : "import React from 'react'; export default function Image({priority,unoptimized,...props}) { return <img {...props} />; }",
          loader: 'tsx',
          resolveDir: root,
        }));
      },
    },
  ],
});
const config = loadConfig(resolve(root, 'tailwind.config.ts'));
config.content = [resolve(root, 'src/components/**/*.{ts,tsx}')];
const css = (
  await postcss([tailwind(config)]).process(
    readFileSync(resolve(root, 'src/app/globals.css'), 'utf8'),
    {
      from: resolve(root, 'src/app/globals.css'),
    },
  )
).css;

await mkdir(captures, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const { width, touch } of [
    { width: 1440, touch: false },
    { width: 390, touch: false },
    { width: 390, touch: true },
    { width: 320, touch: true },
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      hasTouch: touch,
      isMobile: touch,
    });
    const external = [];
    const errors = [];
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://wallet.fixture.test' && url.pathname === '/')
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:Arial,sans-serif"><div id="root"></div></body></html>',
        });
      if (url.origin === 'https://wallet.fixture.test' && url.pathname.startsWith('/brand/'))
        return route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        });
      const script = bundle.outputFiles.find((file) =>
        file.path.replaceAll('\\', '/').endsWith(url.pathname),
      );
      if (url.origin === 'https://wallet.fixture.test' && script)
        return route.fulfill({ contentType: 'text/javascript', body: script.text });
      external.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('https://wallet.fixture.test/');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({
      type: 'module',
      url: 'https://wallet.fixture.test/wallet-fixture.js',
    });
    const activate = (locator) => (touch ? locator.tap() : locator.click());
    await activate(
      page.locator('main').getByRole('button', { name: 'Connect Wallet', exact: true }),
    );
    const overlay = page.locator('[data-agentdomain-wallet-dialog="true"]');
    assert.equal(await overlay.count(), 1);
    assert.equal(
      await overlay.evaluate((element) => getComputedStyle(element).backdropFilter),
      'blur(12px)',
    );
    assert.equal(await overlay.getByText('MetaMask, Rabby, Coinbase', { exact: true }).count(), 1);
    assert.equal(
      await overlay.getByRole('button', { name: 'Coinbase Wallet', exact: true }).count(),
      1,
    );
    assert.doesNotMatch(await overlay.innerText(), /Base App|Extension/);
    await page.screenshot({
      path: resolve(captures, `selector-${width}-${touch ? 'touch' : 'mouse'}.png`),
    });
    await activate(page.getByRole('button', { name: /^Injected Wallet/ }));
    assert.equal(await overlay.count(), 1, 'only the active selector overlays the page');
    const injectedWallet = overlay.getByRole('button', { name: 'Coinbase Wallet', exact: true });
    const logo = injectedWallet.locator('img');
    assert.equal(await logo.getAttribute('src'), icon);
    assert.deepEqual(
      await logo.evaluate((element) => {
        const style = getComputedStyle(element);
        const parent = getComputedStyle(element.parentElement);
        return {
          padding: style.padding,
          background: style.backgroundColor,
          radius: style.borderRadius,
          fit: style.objectFit,
          clipped: parent.overflow,
        };
      }),
      {
        padding: '0px',
        background: 'rgba(0, 0, 0, 0)',
        radius: '0px',
        fit: 'contain',
        clipped: 'visible',
      },
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-agentdomain-wallet-dialog] img')].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    assert.doesNotMatch(await injectedWallet.innerText(), /Base App|[Ee]xtension/);
    await page.screenshot({
      path: resolve(captures, `injected-${width}-${touch ? 'touch' : 'mouse'}.png`),
    });
    await activate(injectedWallet);
    await page.waitForFunction(() => window.fixture.connections().length > 0);
    await page.evaluate(() => window.fixture.emit('accountsChanged', window.fixture.accounts));
    await page.waitForFunction(() => window.fixture.connections().length > 1);
    const before = await page.evaluate(() => window.fixture.connections());
    if (width < 1280)
      await activate(page.getByRole('button', { name: 'Toggle navigation', exact: true }));
    await activate(page.locator('header button[aria-haspopup="menu"]:visible'));
    const walletMenu = page.getByRole('menu', { name: 'Connected wallet menu' });
    assert.equal(
      await walletMenu.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
        );
      }),
      true,
      `${width}/${touch}: wallet actions remain in the viewport`,
    );
    await page.screenshot({
      path: resolve(captures, `account-${width}-${touch ? 'touch' : 'mouse'}.png`),
    });
    const disconnectButton = page.getByRole('menuitem', { name: 'Disconnect wallet', exact: true });
    if (touch) {
      await disconnectButton.dispatchEvent('pointerdown', { pointerType: 'touch' });
      await disconnectButton.dispatchEvent('pointercancel', { pointerType: 'touch' });
      assert.deepEqual(
        await page.evaluate(() => window.fixture.connections()),
        before,
        'a cancelled touch/scroll gesture must not disconnect',
      );
    }
    await activate(disconnectButton);
    await page.getByRole('menu', { name: 'Connected wallet menu' }).waitFor({ state: 'hidden' });
    assert.deepEqual(
      await page.evaluate(() => window.fixture.connections()),
      [],
      `${width}/${touch}: one activation must disconnect all ${JSON.stringify(before)}`,
    );
    assert.equal(
      await page
        .locator('header')
        .getByRole('button', { name: 'Connect Wallet', exact: true })
        .isVisible(),
      true,
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem('wagmi.com.coinbase.wallet.disconnected')),
      'true',
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem('wagmi.baseApp.disconnected')),
      'true',
    );
    await activate(
      page.locator('header').getByRole('button', { name: 'Connect Wallet', exact: true }),
    );
    const malicious = '<img src=x onerror=window.untrustedWalletExecuted=true>';
    await page.evaluate(
      ({ malicious }) => {
        const provider = { ...window.fixture.provider, isCoinbaseWallet: undefined };
        window.fixture.announce({
          info: {
            uuid: '530670db-19fa-4704-a166-e52e178b59d2',
            rdns: 'invalid.tracker.wallet',
            name: malicious,
            icon: 'https://tracker.invalid/wallet.png',
          },
          provider,
        });
        const svgProvider = { ...window.fixture.provider, isCoinbaseWallet: undefined };
        window.fixture.announce({
          info: {
            uuid: '630670db-19fa-4704-a166-e52e178b59d2',
            rdns: 'invalid.svg.wallet',
            name: 'SVG Test Wallet',
            icon:
              'data:image/svg+xml,' +
              encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" onload="parent.untrustedWalletExecuted=true"><script>parent.untrustedWalletExecuted=true</script><rect width="96" height="96"/></svg>',
              ),
          },
          provider: svgProvider,
        });
      },
      { malicious },
    );
    await activate(page.getByRole('button', { name: /^Injected Wallet/ }));
    assert.equal(await overlay.getByRole('button', { name: malicious, exact: true }).count(), 1);
    await page.evaluate(
      ({ icon }) => {
        const wallets = [
          ['Keplr', 'app.keplr', 'a50670db-19fa-4704-a166-e52e178b59d2'],
          ['Backpack', 'app.backpack', '4194b504-b5f1-5a4c-8732-0e1a34475ad0'],
          ['Phantom', 'app.phantom', 'fae43c5a-52fe-4998-b254-974f531df424'],
          ['Rabby Wallet', 'io.rabby', 'b50670db-19fa-4704-a166-e52e178b59d2'],
          ['MetaMask', 'io.metamask', 'c50670db-19fa-4704-a166-e52e178b59d2'],
        ];
        for (const [name, rdns, uuid] of wallets)
          window.fixture.announce({
            info: { name, rdns, uuid, icon: name === 'Phantom' ? '\n' + icon : icon },
            provider: { ...window.fixture.provider, isCoinbaseWallet: undefined },
          });
      },
      { icon },
    );
    await overlay.getByRole('button', { name: 'Backpack', exact: true }).waitFor();
    assert.deepEqual((await overlay.locator('button bdi').allTextContents()).slice(0, 5), [
      'MetaMask',
      'Rabby Wallet',
      'Coinbase Wallet',
      'Phantom',
      'Backpack',
    ]);
    assert.equal(await overlay.getByRole('button', { name: 'Keplr', exact: true }).count(), 0);
    assert.equal(
      await overlay
        .getByRole('button', { name: 'Phantom', exact: true })
        .locator('img')
        .getAttribute('src'),
      icon,
    );
    assert.equal(
      await overlay.getByRole('button', { name: malicious, exact: true }).locator('img').count(),
      0,
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-agentdomain-wallet-dialog] img')].every(
        (image) => image.complete,
      ),
    );
    assert.equal(await page.evaluate(() => window.untrustedWalletExecuted), undefined);
    assert.equal(await overlay.locator('script, iframe, object, embed').count(), 0);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await activate(page.getByRole('button', { name: 'Close injected wallet selector' }));
    await activate(page.getByRole('button', { name: 'Close wallet selector' }));
    assert.equal(
      await page.locator('body').getAttribute('data-agentdomain-wallet-dialog-open'),
      null,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(
      `PASS wallet blur, provider metadata/icons, one-click disconnect and viewport fit: ${width}px ${touch ? 'touch' : 'mouse'}`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
