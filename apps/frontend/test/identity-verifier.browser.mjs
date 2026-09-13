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
} = require('viem');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const loadConfig = require('tailwindcss/loadConfig');
const root = fileURLToPath(new URL('../', import.meta.url));
const captures = resolve(root, '.qa/identity-verifier');
const origin = 'https://identity-check.fixture.test';
const rpc = 'https://mainnet.base.org/';
const registry = '0x234a2B83B32910436A35CDa797CCC57988B9Bd15';
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

// Only Next's image wrapper is replaced. The SDK and all RPC decoding/checks are real.
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
    await context.route('**/*', async (route) => {
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
      if (url.href !== rpc) {
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
          assert.equal(
            target.toLowerCase(),
            registry.toLowerCase(),
            'Only canonical registry calls',
          );
          const call = decodeFunctionData({ abi, data: callData });
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
          assert.deepEqual(
            call.args[0].map(
              (entry) => decodeFunctionData({ abi, data: entry.callData }).functionName,
            ),
            ['ownerOf', 'tokenURI', 'getTokenIdByDomain', 'isActive'],
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
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/verify');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole('heading', { name: 'AgentDomain Identity Check' }).waitFor();
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
    assert.deepEqual(errors, []);
    assert.deepEqual(fixture.unexpected, [], 'No metadata, wallet, API or other network requests');
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
      ],
    });
    await context.close();
  }
  console.log(JSON.stringify({ passed: completed, captures }, null, 2));
} finally {
  await browser.close();
}
