import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { AGENT_IDENTITY_REGISTRY_BASE, AGENT_RENEWAL_VAULT_BASE } from '@agentdomain/sdk';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/identity-check-client.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
});
const observation = {
  version: 1,
  chainId: 8453,
  registryAddress: AGENT_IDENTITY_REGISTRY_BASE,
  status: 'not_found',
  input: { tokenId: '1' },
  tokenId: '1',
  block: { number: '16', timestamp: '256', hash: '0x' + 'a'.repeat(64), tag: 'safe' },
};
function fixture(response) {
  const calls = [];
  const compiledModule = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, {
    module: compiledModule,
    exports: compiledModule.exports,
    require,
    URL,
    Headers,
    Request,
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return typeof response === 'function' ? response(init) : response;
    },
  });
  return { client: compiledModule.exports, calls };
}

test('identity and renewal use only the same-origin public endpoint without login or direct RPC', async () => {
  for (const kind of ['identity', 'renewal']) {
    const result =
      kind === 'identity'
        ? observation
        : {
            version: 1,
            chainId: 8453,
            status: 'not_found',
            vaultAddress: AGENT_RENEWAL_VAULT_BASE,
            identity: observation,
          };
    const f = fixture(Response.json(result));
    const controller = new AbortController();
    const data = await (
      kind === 'identity' ? f.client.requestIdentityCheck : f.client.requestRenewalCheck
    )({ tokenId: '1' }, controller.signal);
    assert.deepEqual(JSON.parse(JSON.stringify(data)), result);
    assert.equal(f.calls.length, 1);
    const { url, init } = f.calls[0];
    assert.equal(url, '/api/v1/public/identity-inspection');
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.equal(init.signal, controller.signal);
    assert.deepEqual(JSON.parse(init.body), { tokenId: '1', kind });
  }
});

test('429 honors a bounded Retry-After without retry, fallback, or provider-message reflection', async () => {
  for (const header of ['60', '3600', '0', '-1', '3601', '1e3', 'malicious-text']) {
    const f = fixture(
      Response.json(
        { message: 'private-provider-detail' },
        { status: 429, headers: { 'Retry-After': header } },
      ),
    );
    await assert.rejects(f.client.requestIdentityCheck({ tokenId: '1' }), (error) => {
      assert.equal(error.code, 'RATE_LIMITED');
      assert.equal(
        error.retryAfterSeconds,
        ['60', '3600'].includes(header) ? Number(header) : undefined,
      );
      assert.doesNotMatch(error.message, /private-provider-detail/);
      return true;
    });
    assert.equal(f.calls.length, 1);
  }
});

test('invalid input and unavailable service preserve only allowlisted codes', async () => {
  for (const [code, expected] of [
    ['VALIDATION_ERROR', 'INVALID_INPUT'],
    ['INVALID_INPUT', 'INVALID_INPUT'],
    ['WRONG_CHAIN', 'WRONG_CHAIN'],
    ['UNSAFE_SNAPSHOT', 'UNSAFE_SNAPSHOT'],
    ['RATE_LIMITER_UNAVAILABLE', 'UNAVAILABLE'],
    ['private-detail', 'UNAVAILABLE'],
  ]) {
    const f = fixture(Response.json({ code, message: 'private-provider-detail' }, { status: 503 }));
    await assert.rejects(
      f.client.requestIdentityCheck({ tokenId: '1' }),
      (error) => error.code === expected && !error.message.includes('private-provider-detail'),
    );
    assert.equal(f.calls.length, 1);
  }
});

test('malformed or wrong-contract/network success is unavailable, never a not-found result', async () => {
  for (const data of [
    null,
    {},
    { version: 1 },
    { ...observation, chainId: 1 },
    { ...observation, registryAddress: '0x' + '1'.repeat(40) },
    { ...observation, status: 'found' },
    { ...observation, block: {} },
  ]) {
    const f = fixture(Response.json(data));
    await assert.rejects(
      f.client.requestIdentityCheck({ tokenId: '1' }),
      (error) => error.code === 'UNAVAILABLE',
    );
    assert.equal(f.calls.length, 1);
  }
});

test('request cancellation reaches fetch and never causes an automatic retry', async () => {
  const controller = new AbortController();
  controller.abort();
  const f = fixture((init) => {
    init.signal.throwIfAborted();
  });
  await assert.rejects(f.client.requestIdentityCheck({ tokenId: '1' }, controller.signal));
  assert.equal(f.calls.length, 1);
});
