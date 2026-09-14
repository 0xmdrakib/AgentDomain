import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] ?? 'playwright');
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const {
  decodeFunctionData,
  encodeFunctionResult,
  encodeErrorResult,
  parseAbi,
  multicall3Abi,
  createPublicClient,
  custom,
} = await import('viem');
const { base } = await import('viem/chains');
const { inspectAgentIdentity, inspectAgentRenewal } = await import('@agentdomain/sdk');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const loadConfig = require('tailwindcss/loadConfig');
const root = fileURLToPath(new URL('../', import.meta.url));
const captures = resolve(root, '.qa/identity-verifier');
const origin = 'https://identity-check.fixture.test';
const rpc = 'https://mainnet.base.org/';
const registry = '0x234a2B83B32910436A35CDa797CCC57988B9Bd15';
const vault = '0xb7b19826a566ebd9e8b50bee986a8da04bbb2c0a';
const usdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const owner = '0x' + '1'.repeat(40);
const other = '0x' + '2'.repeat(40);
const hash = '0x' + 'a'.repeat(64);
const now = 1789280000n;
const blockNumber = 50_000_000n;
const hugeToken = 9007199254740993n;
const metadata =
  'https://untrusted.invalid/' + 'a'.repeat(700) + '?content=<script>window.bad=true</script>';
const longDomain = [63, 63, 63, 61].map((n) => 'a'.repeat(n)).join('.');
const abi = parseAbi([
  'error TokenDoesNotExist(uint256 tokenId)',
  'function getTokenIdByDomain(string domain) view returns (uint256)',
  'function getIdentity(uint256 tokenId) view returns ((address owner, string domain, string basename, string ensName, string metadataUri, uint64 createdAt, uint64 expiresAt, bool revoked) identity)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function isActive(uint256 tokenId) view returns (bool)',
  'function renewalVault() view returns (address)',
  'function balanceOfToken(uint256 tokenId) view returns (uint256)',
  'function autoRenewEnabled(uint256 tokenId) view returns (bool)',
  'function pendingRenewals(uint256 tokenId) view returns (uint256 amount,uint64 expiresAt,uint64 reservedAt)',
  'function renewalWindow() view returns (uint64)',
  'function renewalDuration() view returns (uint64)',
  'function renewalFee() view returns (uint256)',
  'function nft() view returns (address)',
  'function registry() view returns (address)',
  'function usdc() view returns (address)',
  'function lastRenewedAt(uint256 tokenId) view returns (uint64)',
  'function isRenewable(uint256 tokenId) view returns (bool)',
]);
const block = {
  baseFeePerGas: '0x1',
  difficulty: '0x0',
  extraData: '0x',
  gasLimit: '0x1c9c380',
  gasUsed: '0x0',
  hash,
  logsBloom: '0x' + '0'.repeat(512),
  miner: owner,
  mixHash: hash,
  nonce: '0x0000000000000000',
  number: '0x' + blockNumber.toString(16),
  parentHash: hash,
  receiptsRoot: hash,
  sha3Uncles: hash,
  size: '0x1',
  stateRoot: hash,
  timestamp: '0x' + now.toString(16),
  totalDifficulty: '0x0',
  transactions: [],
  transactionsRoot: hash,
  uncles: [],
};

// The API fixture runs the real SDK with synthetic RPC. Browser requests must stay same-origin.
const bundle = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import VerifyPage from './src/app/verify/page';
    createRoot(document.getElementById('root')).render(<VerifyPage />);`,
    loader: 'tsx',
    resolveDir: root,
  },
  absWorkingDir: root,
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'fixture-next-image',
      setup(builder) {
        builder.onResolve({ filter: /^next\/image$/ }, () => ({
          path: 'image',
          namespace: 'fixture-image',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture-image' }, () => ({
          contents: `import React from 'react'; export default function Image({unoptimized,priority,...props}) {return <img {...props} />;}`,
          loader: 'tsx',
          resolveDir: root,
        }));
      },
    },
  ],
});
const config = loadConfig(resolve(root, 'tailwind.config.ts'));
config.content = [resolve(root, 'src/**/*.{ts,tsx}')];
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
const completed = [];
try {
  for (const width of [1440, 1280, 768, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.fixtureCopied = text;
          },
        },
      });
    });
    const fixture = {
      scenario: 'found',
      domain: longDomain,
      requests: [],
      unexpected: [],
      hold: false,
      release: null,
    };
    async function handleRoute(route, syntheticRpc = false) {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin === origin && url.pathname === '/verify')
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html lang="en" class="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="font-family:Arial,sans-serif"><div id="root"></div></body></html>',
        });
      if (url.origin === origin && url.pathname.startsWith('/brand/')) {
        const file = resolve(root, 'public', '.' + url.pathname);
        assert.ok(file.startsWith(resolve(root, 'public/brand')));
        return route.fulfill({
          contentType: file.endsWith('.svg') ? 'image/svg+xml' : 'image/png',
          body: await readFile(file),
        });
      }
      if (url.origin === origin && url.pathname === '/api/v1/public/identity-inspection') {
        const { kind, ...input } = request.postDataJSON();
        assert.equal(request.method(), 'POST');
        assert.ok(['identity', 'renewal'].includes(kind));
        if (fixture.scenario === 'rate-limited')
          return route.fulfill({
            status: 429,
            headers: { 'Retry-After': '60' },
            json: { code: 'RATE_LIMITED' },
          });
        const publicClient = createPublicClient({
          chain: base,
          ccipRead: false,
          transport: custom(
            {
              async request(data) {
                let envelope;
                await handleRoute(
                  {
                    request: () => ({
                      url: () => rpc,
                      method: () => 'POST',
                      postDataJSON: () => data,
                    }),
                    fulfill: ({ json }) => {
                      envelope = json;
                    },
                  },
                  true,
                );
                if (envelope.error)
                  throw Object.assign(new Error(envelope.error.message), envelope.error);
                return envelope.result;
              },
            },
            { retryCount: 0 },
          ),
        });
        try {
          const result = await (kind === 'renewal' ? inspectAgentRenewal : inspectAgentIdentity)(
            input,
            { publicClient },
          );
          return route.fulfill({ json: result });
        } catch (error) {
          return route.fulfill({
            status: error.code === 'INVALID_INPUT' ? 400 : 503,
            json: { code: error.code ?? 'UNAVAILABLE' },
          });
        }
      }
      if (url.href !== rpc || !syntheticRpc) {
        fixture.unexpected.push(url.href);
        return route.abort();
      }
      const data = request.postDataJSON();
      fixture.requests.push(data);
      assert.equal(request.method(), 'POST');
      if (fixture.hold) {
        fixture.hold = false;
        await new Promise((resume) => {
          fixture.release = resume;
        });
      }
      const error = { code: -32000, message: 'synthetic-private-provider-detail' };
      let result;
      if (fixture.scenario === 'rpc-failure')
        return route.fulfill({ json: { jsonrpc: '2.0', id: data.id, error } });
      if (data.method === 'eth_chainId')
        result = fixture.scenario === 'wrong-chain' ? '0x1' : '0x2105';
      else if (data.method === 'eth_getBlockByNumber') {
        assert.ok(['safe', block.number].includes(data.params[0]));
        result = {
          ...block,
          hash:
            fixture.scenario === 'block-change' && data.params[0] !== 'safe'
              ? '0x' + 'b'.repeat(64)
              : hash,
        };
      } else {
        assert.equal(data.method, 'eth_call');
        assert.deepEqual(
          data.params[1],
          { blockHash: hash, requireCanonical: true },
          'Every contract read must use the canonical safe hash; number/latest fallback is forbidden',
        );
        if (fixture.scenario === 'hash-unsupported')
          return route.fulfill({
            json: {
              jsonrpc: '2.0',
              id: data.id,
              error: {
                code: -32602,
                message: 'synthetic-private-provider-detail: blockHash unsupported',
              },
            },
          });
        function execute(target, callData) {
          const call = decodeFunctionData({ abi, data: callData });
          const registryRead = [
            'getTokenIdByDomain',
            'getIdentity',
            'ownerOf',
            'tokenURI',
            'isActive',
            'renewalVault',
          ].includes(call.functionName);
          assert.equal(
            target.toLowerCase(),
            (registryRead ? registry : vault).toLowerCase(),
            'Only the canonical registry or renewal vault may be read',
          );
          if (fixture.scenario === 'missing-token' && call.functionName === 'getIdentity')
            return {
              success: false,
              returnData: encodeErrorResult({
                abi,
                errorName: 'TokenDoesNotExist',
                args: [call.args[0]],
              }),
            };
          let value;
          switch (call.functionName) {
            case 'getTokenIdByDomain':
              value = fixture.scenario === 'missing' ? 0n : hugeToken;
              break;
            case 'getIdentity':
              value = {
                owner,
                domain: fixture.domain,
                basename: 'recorded.base.eth',
                ensName: '',
                metadataUri: metadata,
                createdAt: now - 1000n,
                expiresAt: fixture.scenario === 'expired' ? now : now + 1000n,
                revoked: fixture.scenario === 'revoked',
              };
              break;
            case 'ownerOf':
              value = fixture.scenario === 'record-mismatch' ? other : owner;
              break;
            case 'tokenURI':
              value = metadata;
              break;
            case 'isActive':
              value = !['expired', 'revoked'].includes(fixture.scenario);
              break;
            case 'renewalVault':
              value = vault;
              break;
            case 'balanceOfToken':
              value = fixture.scenario === 'renewal-underfunded' ? 1n : 5_000_000n;
              break;
            case 'autoRenewEnabled':
              value = fixture.scenario === 'renewal-underfunded';
              break;
            case 'pendingRenewals':
              value =
                fixture.scenario === 'renewal-pending'
                  ? [4_000_000n, now + 1000n, now - 60n]
                  : [0n, 0n, 0n];
              break;
            case 'renewalWindow':
              value = 2_592_000n;
              break;
            case 'renewalDuration':
              value = 31_536_000n;
              break;
            case 'renewalFee':
              value = fixture.scenario === 'renewal-unset-fee' ? 0n : 3_900_000n;
              break;
            case 'nft':
              value = fixture.scenario === 'renewal-mismatch' ? other : registry;
              break;
            case 'registry':
              value = registry;
              break;
            case 'usdc':
              value = usdc;
              break;
            case 'lastRenewedAt':
              value = now - 1000n;
              break;
            case 'isRenewable':
              value = fixture.scenario === 'renewal-underfunded';
              break;
            default:
              throw new Error('Unexpected contract method');
          }
          return {
            success: true,
            returnData: encodeFunctionResult({
              abi,
              functionName: call.functionName,
              result: value,
            }),
          };
        }
        if (data.params[0].to.toLowerCase() === '0xca11bde05977b3631167028862be2a173976ca11') {
          const call = decodeFunctionData({ abi: multicall3Abi, data: data.params[0].data });
          assert.equal(call.functionName, 'aggregate3');
          const vaultBatch = call.args[0][0].target.toLowerCase() === vault;
          if (vaultBatch && fixture.scenario === 'renewal-vault-failure')
            return route.fulfill({ json: { jsonrpc: '2.0', id: data.id, error } });
          assert.deepEqual(
            call.args[0].map(
              (entry) => decodeFunctionData({ abi, data: entry.callData }).functionName,
            ),
            vaultBatch
              ? [
                  'balanceOfToken',
                  'autoRenewEnabled',
                  'pendingRenewals',
                  'renewalWindow',
                  'renewalDuration',
                  'renewalFee',
                  'nft',
                  'registry',
                  'usdc',
                  'lastRenewedAt',
                  'isRenewable',
                  'renewalVault',
                ]
              : ['ownerOf', 'tokenURI', 'getTokenIdByDomain', 'isActive'],
          );
          result = encodeFunctionResult({
            abi: multicall3Abi,
            functionName: 'aggregate3',
            result: call.args[0].map((entry) => execute(entry.target, entry.callData)),
          });
        } else {
          const call = execute(data.params[0].to, data.params[0].data);
          if (!call.success)
            return route.fulfill({
              json: {
                jsonrpc: '2.0',
                id: data.id,
                error: { code: 3, message: 'execution reverted', data: call.returnData },
              },
            });
          result = call.returnData;
        }
      }
      return route.fulfill({ json: { jsonrpc: '2.0', id: data.id, result } });
    }
    await context.route('**/*', (route) => handleRoute(route));
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/verify');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page
      .getByRole('heading', { name: 'AgentDomain Identity Check' })
      .waitFor()
      .catch((error) => {
        throw new Error(
          `Identity page failed to render; browser errors: ${JSON.stringify(errors)}`,
          { cause: error },
        );
      });
    await page.waitForFunction(() =>
      [...document.images].every((image) => image.complete && image.naturalWidth > 0),
    );
    assert.equal(fixture.requests.length, 0, 'No RPC before explicit submit');
    assert.equal(
      await page.getByRole('button', { name: 'Check identity', exact: true }).isDisabled(),
      true,
    );
    if (width < 1280) {
      await page.locator('header summary').click();
      assert.equal(
        await page
          .getByRole('navigation', { name: 'Mobile navigation' })
          .getByRole('link', { name: 'Identity Check' })
          .getAttribute('href'),
        '/verify',
      );
      await page.locator('header summary').click();
    } else
      assert.equal(
        await page
          .getByRole('navigation', { name: 'Primary navigation' })
          .getByRole('link', { name: 'Identity Check' })
          .getAttribute('href'),
        '/verify',
      );
    await page.screenshot({ path: resolve(captures, `empty-${width}.png`), fullPage: true });

    const input = page.locator('#identity-query'),
      expected = page.locator('#identity-expected-owner');
    await input.fill(longDomain);
    fixture.hold = true;
    await page.getByRole('button', { name: 'Check identity', exact: true }).click();
    await page.getByText('Reading safe block', { exact: true }).waitFor();
    assert.equal(await input.isDisabled(), true);
    assert.equal(await expected.isDisabled(), true);
    assert.equal(
      await page.getByRole('button', { name: 'Checking', exact: true }).isDisabled(),
      true,
    );
    await page
      .locator('form')
      .evaluate((form) =>
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
      );
    await page.waitForTimeout(100);
    assert.equal(fixture.requests.length, 1, 'No second in-flight SDK call');
    fixture.release();
    await page.getByText('Records consistent', { exact: true }).last().waitFor();
    assert.equal(await page.getByText('Match', { exact: true }).count(), 4);
    assert.equal(await page.getByText('Not requested', { exact: true }).count(), 1);
    assert.match(await page.locator('main').innerText(), /9007199254740993/);
    assert.equal(await page.locator('a[href*="untrusted.invalid"]').count(), 0);
    assert.equal(await page.evaluate(() => window.bad), undefined);
    assert.equal(
      await page.getByRole('link', { name: 'View token on BaseScan' }).getAttribute('href'),
      `https://basescan.org/token/${registry}?a=${hugeToken}`,
    );
    await page.getByRole('button', { name: 'Copy JSON' }).click();
    const copied = JSON.parse(await page.evaluate(() => window.fixtureCopied));
    assert.equal(copied.tokenId, hugeToken.toString());
    assert.equal(copied.block.hash, hash);
    assert.equal(copied.identity.metadataUri, metadata);
    assert.equal(copied.status, 'found');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON' }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'agentdomain-identity-observation.json');
    const path = resolve(captures, `observation-${width}.json`);
    await download.saveAs(path);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), copied);
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    await page.screenshot({ path: resolve(captures, `found-${width}.png`), fullPage: true });
    await page.screenshot({ path: resolve(captures, `viewport-${width}.png`) });
    const bounds = await page.locator('main').evaluate((main) => {
      const boundary = main.getBoundingClientRect();
      return [...main.querySelectorAll('input,button,h1,h2,dd,li')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.left < boundary.left - 1 || r.right > boundary.right + 1;
        })
        .map((el) => el.tagName);
    });
    assert.deepEqual(bounds, [], 'Responsive controls and long text stay within main');
    const total = fixture.requests.length;
    await page.waitForTimeout(500);
    assert.equal(fixture.requests.length, total, 'No polling or automatic retry');

    await expected.fill(other);
    assert.equal(
      await page.getByRole('heading', { name: longDomain }).count(),
      0,
      'Editing invalidates prior result',
    );
    await page.getByRole('button', { name: 'Check identity', exact: true }).click();
    await page.getByText('Expected wallet differs', { exact: true }).last().waitFor();
    assert.equal(await page.getByText('Mismatch', { exact: true }).count(), 1);
    await expected.fill('');
    for (const [scenario, label] of [
      ['record-mismatch', 'Records differ'],
      ['expired', 'Expired identity'],
      ['revoked', 'Revoked identity'],
      ['missing', 'Identity not found'],
    ]) {
      fixture.scenario = scenario;
      await page.getByRole('button', { name: 'Check identity', exact: true }).click();
      await page.getByText(label, { exact: true }).last().waitFor();
      if (scenario === 'missing')
        assert.equal(await page.getByText('Consistency checks', { exact: true }).count(), 0);
    }
    for (const scenario of ['rpc-failure', 'wrong-chain', 'block-change', 'hash-unsupported']) {
      fixture.scenario = scenario;
      const before = fixture.requests.length;
      await page.getByRole('button', { name: 'Check identity', exact: true }).click();
      await page.getByRole('alert').waitFor();
      assert.doesNotMatch(
        await page.getByRole('alert').innerText(),
        /synthetic-private-provider-detail|Identity not found/,
      );
      assert.equal(await page.getByRole('button', { name: 'Copy JSON' }).count(), 0);
      assert.ok(fixture.requests.length > before);
      if (scenario === 'hash-unsupported') {
        assert.match(await page.getByRole('alert').innerText(), /The RPC check failed/);
        assert.equal(
          fixture.requests.slice(before).filter((request) => request.method === 'eth_call').length,
          1,
          'Unsupported hash fails immediately without a number/latest fallback',
        );
      }
      const count = fixture.requests.length;
      await page.waitForTimeout(300);
      assert.equal(fixture.requests.length, count);
    }
    fixture.scenario = 'rate-limited';
    const beforeThrottle = fixture.requests.length;
    await page.getByRole('button', { name: 'Check identity', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /rate-limited.*60 seconds/);
    await page.waitForTimeout(250);
    assert.equal(
      fixture.requests.length,
      beforeThrottle,
      'A throttle response never falls back to direct RPC',
    );
    fixture.scenario = 'found';
    await page.getByRole('button', { name: 'Token ID', exact: true }).click();
    await input.fill('01');
    const beforeInvalid = fixture.requests.length;
    await page.getByRole('button', { name: 'Check identity', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /Check the domain/);
    assert.equal(fixture.requests.length, beforeInvalid);
    await input.fill('999');
    fixture.scenario = 'missing-token';
    await page.getByRole('button', { name: 'Check identity', exact: true }).click();
    await page.getByText('Identity not found', { exact: true }).last().waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Token 999' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Check renewal', exact: true }).count(), 0);

    fixture.scenario = 'found';
    await input.fill(hugeToken.toString());
    await page.getByRole('button', { name: 'Check identity', exact: true }).click();
    await page.getByText('Records consistent', { exact: true }).last().waitFor();
    const readiness = page.getByRole('region', { name: 'Renewal readiness', exact: true });
    await readiness.getByText('Not checked', { exact: true }).waitFor();
    const beforeRenewal = fixture.requests.length;
    await page.waitForTimeout(250);
    assert.equal(
      fixture.requests.length,
      beforeRenewal,
      'Identity lookup does not automatically fetch renewal',
    );
    fixture.hold = true;
    await readiness.getByRole('button', { name: 'Check renewal', exact: true }).click();
    await readiness.getByText('Reading renewal state', { exact: true }).waitFor();
    assert.equal(
      await readiness.getByRole('button', { name: 'Checking renewal', exact: true }).isDisabled(),
      true,
    );
    await readiness
      .getByRole('button', { name: 'Checking renewal', exact: true })
      .dispatchEvent('click');
    await page.waitForTimeout(100);
    assert.equal(
      fixture.requests.length,
      beforeRenewal + 1,
      'One in-flight renewal inspection only',
    );
    fixture.release();
    await readiness.getByText('Vault records consistent', { exact: true }).waitFor();
    assert.equal(await readiness.getByText('5 USDC', { exact: true }).count(), 1);
    assert.equal(await readiness.getByText('3.9 USDC', { exact: true }).count(), 1);
    assert.equal(
      await readiness.getByText('Minimum fee (not a quote)', { exact: true }).count(),
      1,
    );
    assert.equal(await readiness.getByText('30 days', { exact: true }).count(), 1);
    assert.equal(
      await readiness.getByRole('link', { name: 'Manage in dashboard' }).getAttribute('href'),
      '/dashboard',
    );
    assert.equal(
      await readiness
        .getByRole('link', { name: 'View renewal block on BaseScan' })
        .getAttribute('href'),
      `https://basescan.org/block/${hash}`,
    );
    await readiness.getByRole('button', { name: 'Copy renewal JSON', exact: true }).click();
    const renewalCopied = JSON.parse(await page.evaluate(() => window.fixtureCopied));
    assert.equal(renewalCopied.identity.tokenId, hugeToken.toString());
    assert.equal(renewalCopied.identity.block.hash, hash);
    assert.equal(renewalCopied.vault.minimumFeeAtomicUsdc, '3900000');
    const renewalDownload = page.waitForEvent('download');
    await readiness.getByRole('button', { name: 'Download renewal JSON', exact: true }).click();
    const downloadedRenewal = await renewalDownload;
    assert.equal(downloadedRenewal.suggestedFilename(), 'agentdomain-renewal-observation.json');
    const renewalPath = resolve(captures, `renewal-${width}.json`);
    await downloadedRenewal.saveAs(renewalPath);
    assert.deepEqual(JSON.parse(await readFile(renewalPath, 'utf8')), renewalCopied);
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    await page.screenshot({
      path: resolve(captures, `renewal-readiness-${width}.png`),
      fullPage: true,
    });
    await readiness.evaluate((element) =>
      window.scrollTo({
        top: element.getBoundingClientRect().top + window.scrollY - 96,
        left: 0,
        behavior: 'instant',
      }),
    );
    await page.screenshot({ path: resolve(captures, `renewal-viewport-${width}.png`) });
    const renewalBounds = await readiness.evaluate((section) => {
      const boundary = section.getBoundingClientRect();
      return [...section.querySelectorAll('button,h2,h3,dd,li')]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < boundary.left - 1 || rect.right > boundary.right + 1;
        })
        .map((element) => element.tagName);
    });
    assert.deepEqual(renewalBounds, [], 'Renewal values and controls remain within the section');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    const renewalCount = fixture.requests.length;
    await page.waitForTimeout(300);
    assert.equal(fixture.requests.length, renewalCount, 'No renewal polling');

    for (const scenario of [
      'renewal-pending',
      'renewal-underfunded',
      'renewal-unset-fee',
      'renewal-mismatch',
    ]) {
      fixture.scenario = scenario;
      await readiness.getByRole('button', { name: 'Check renewal', exact: true }).click();
      await readiness
        .getByText(
          scenario === 'renewal-mismatch' ? 'Renewal records differ' : 'Vault records consistent',
          { exact: true },
        )
        .waitFor();
      if (scenario === 'renewal-pending') {
        assert.equal(await readiness.getByText('4 USDC', { exact: true }).count(), 2);
        assert.equal(
          await readiness
            .getByText('Disabling auto-renew does not cancel this pending reservation.', {
              exact: true,
            })
            .count(),
          1,
        );
      }
      if (scenario === 'renewal-underfunded') {
        assert.equal(await readiness.getByText('0.000001 USDC', { exact: true }).count(), 1);
        assert.equal(await readiness.getByText('Eligible', { exact: true }).count(), 1);
        assert.equal(await readiness.getByText('No', { exact: true }).count(), 1);
      }
      if (scenario === 'renewal-unset-fee')
        assert.equal(await readiness.getByText('Not configured', { exact: true }).count(), 1);
    }
    fixture.scenario = 'missing-token';
    await readiness.getByRole('button', { name: 'Check renewal', exact: true }).click();
    await readiness.getByText('Identity no longer found', { exact: true }).waitFor();
    assert.equal(await readiness.getByText('Available USDC', { exact: true }).count(), 0);
    for (const scenario of ['renewal-vault-failure', 'hash-unsupported']) {
      fixture.scenario = scenario;
      await readiness.getByRole('button', { name: 'Check renewal', exact: true }).click();
      await readiness.getByRole('alert').waitFor();
      assert.match(await readiness.getByRole('alert').innerText(), /The RPC check failed/);
      assert.equal(await readiness.getByRole('button', { name: 'Copy renewal JSON' }).count(), 0);
      assert.equal(await readiness.getByText('Available USDC', { exact: true }).count(), 0);
    }
    fixture.scenario = 'found';
    fixture.hold = true;
    await readiness.getByRole('button', { name: 'Check renewal', exact: true }).click();
    await readiness.getByText('Reading renewal state', { exact: true }).waitFor();
    await page.waitForTimeout(100);
    assert.equal(await input.isDisabled(), true);
    assert.equal(
      await page.getByRole('button', { name: 'Check identity', exact: true }).isDisabled(),
      true,
    );
    fixture.release();
    await readiness.getByText('Vault records consistent', { exact: true }).waitFor();
    await input.fill('2');
    assert.equal(await readiness.count(), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      fixture.unexpected,
      [],
      'No direct RPC, metadata, wallet or other network requests',
    );
    completed.push({
      width,
      cases: [
        'idle',
        'busy-deduplication',
        'found',
        'copy',
        'download',
        'responsive-long-text',
        'expected-owner',
        'mismatch',
        'expired',
        'revoked',
        'not-found',
        'rpc-failure',
        'wrong-chain',
        'changed-block',
        'unsupported-hash-no-fallback',
        'invalid-input',
        'missing-token',
        'renewal-explicit-only',
        'renewal-inflight-deduplication',
        'renewal-found-provenance',
        'renewal-json-copy-download',
        'renewal-responsive',
        'renewal-no-polling',
        'renewal-pending',
        'renewal-underfunded',
        'renewal-unset-fee',
        'renewal-mismatch',
        'renewal-not-found',
        'renewal-partial-rpc-failure',
        'renewal-unsupported-hash',
        'renewal-stale-completion',
      ],
    });
    await context.close();
  }
  console.log(JSON.stringify({ passed: completed, captures }, null, 2));
} finally {
  await browser.close();
}
