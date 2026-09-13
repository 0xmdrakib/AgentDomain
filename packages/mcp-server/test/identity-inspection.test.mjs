import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const resources = [];
const owner = '0x1111111111111111111111111111111111111111';
const registry = '0x234a2B83B32910436A35CDa797CCC57988B9Bd15';
const blockHash = `0x${'ab'.repeat(32)}`;
const atBlock = { blockHash, requireCanonical: true };

afterEach(async () => {
  while (resources.length) await resources.pop()();
});

async function start(mode = 'found', overrides = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /^(AGENTDOMAIN_|AGENT_PRIVATE_KEY$|RENEWAL_VAULT_ADDRESS$|NODE_OPTIONS$|IDENTITY_RPC_FIXTURE_)/.test(
        key,
      )
    ) {
      delete env[key];
    }
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', './test/fixtures/identity-rpc.mjs', 'dist/index.js'],
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...env, IDENTITY_RPC_FIXTURE_MODE: mode, ...overrides },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const client = new Client({ name: 'agentdomain-identity-inspection-test', version: '1.0.0' });
  resources.push(() => client.close());
  await client.connect(transport);
  const traces = (prefix) =>
    stderr
      .split(/\r?\n/)
      .filter((line) => line.startsWith(prefix))
      .map((line) => JSON.parse(line.slice(prefix.length)));
  return {
    client,
    calls: () => traces('IDENTITY_RPC_FIXTURE '),
    fetches: () => traces('IDENTITY_FETCH_FIXTURE '),
    multicalls: () => traces('IDENTITY_MULTICALL_FIXTURE '),
  };
}

function data(result) {
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  return JSON.parse(result.content[0].text);
}

describe('independent identity MCP tool', () => {
  it('is discoverable by default with exact read-only annotations and a closed input schema', async () => {
    const f = await start();
    const tool = (await f.client.listTools()).tools.find(
      (item) => item.name === 'inspect_agent_identity',
    );
    assert.ok(tool);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), [
      'domain',
      'expectedOwner',
      'tokenId',
    ]);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.inputSchema.oneOf, [{ required: ['domain'] }, { required: ['tokenId'] }]);
    assert.match(tool.description, /custom AgentDomain ERC-721/);
    assert.match(tool.description, /RPC observations/);
    assert.deepEqual(f.fetches(), []);
  });

  it('uses the real SDK on Base safe without keys, API authentication or metadata fetches', async () => {
    const f = await start();
    const result = data(
      await f.client.callTool({
        name: 'inspect_agent_identity',
        arguments: { domain: 'reader.xyz' },
      }),
    );
    assert.equal(result.status, 'found');
    assert.equal(result.chainId, 8453);
    assert.equal(result.registryAddress.toLowerCase(), registry.toLowerCase());
    assert.equal(result.tokenId, '7');
    assert.equal(result.identity.domain, 'reader.xyz');
    assert.equal(result.identity.basename, 'reader.base.eth');
    assert.equal(result.identity.ensName, 'reader.eth');
    assert.equal(result.identity.owner.toLowerCase(), owner);
    assert.equal(result.metadataUri, 'https://metadata.example.invalid/identity.json');
    assert.equal(result.nftOwner.toLowerCase(), owner);
    assert.equal(result.lifecycle, 'active');
    assert.equal(result.consistent, true);
    assert.equal(result.checks.expectedOwnerMatches, null);
    assert.equal(result.block.tag, 'safe');
    assert.equal(String(result.block.number), '50000000');
    assert.equal(result.block.hash, blockHash);
    assert.ok(f.calls().some((call) => call.method === 'eth_call'));
    for (const call of f.calls().filter((call) => call.method === 'eth_call')) {
      assert.deepEqual(call.params[1], atBlock);
    }
    assert.deepEqual(
      f.multicalls().map((call) => call.functionName),
      ['ownerOf', 'tokenURI', 'getTokenIdByDomain', 'isActive'],
    );
    assert.ok(
      f
        .calls()
        .some(
          (call) =>
            call.method === 'eth_call' &&
            call.params[0].to.toLowerCase() === '0xca11bde05977b3631167028862be2a173976ca11',
        ),
    );
    assert.ok(
      f.calls().some((call) => call.method === 'eth_getBlockByNumber' && call.params[0] === 'safe'),
    );
    assert.ok(
      f.fetches().every((request) => new URL(request.url).origin === 'https://mainnet.base.org'),
    );
    assert.ok(
      f
        .fetches()
        .every((request) =>
          request.headers.every(
            (header) => !/authorization|cookie|api.key|signature|payment/i.test(header),
          ),
        ),
    );
  });

  it('bypasses ambient platform configuration and invalid wallet keys, even when writes are enabled', async () => {
    const f = await start('found', {
      AGENTDOMAIN_ENABLE_WRITE_TOOLS: 'true',
      AGENTDOMAIN_API_URL: 'not-an-api-url',
      AGENTDOMAIN_API_KEY: 'synthetic-key-that-must-not-be-used',
      AGENT_PRIVATE_KEY: 'not-a-valid-wallet-key',
      AGENTDOMAIN_NETWORK: 'base-sepolia',
      AGENTDOMAIN_BUILDER_CODE: 'INVALID',
    });
    const result = data(
      await f.client.callTool({
        name: 'inspect_agent_identity',
        arguments: { tokenId: '7', expectedOwner: owner },
      }),
    );
    assert.equal(result.status, 'found');
    assert.equal(result.chainId, 8453);
    assert.equal(result.checks.expectedOwnerMatches, true);
  });

  it('reports an expected-owner mismatch without signing or changing the identity', async () => {
    const f = await start();
    const result = data(
      await f.client.callTool({
        name: 'inspect_agent_identity',
        arguments: { tokenId: '7', expectedOwner: '0x2222222222222222222222222222222222222222' },
      }),
    );
    assert.equal(result.status, 'found');
    assert.equal(result.nftOwner.toLowerCase(), owner);
    assert.equal(result.checks.expectedOwnerMatches, false);
    assert.equal(
      result.consistent,
      true,
      'Expected-owner comparison is separate from internal consistency',
    );
    assert.ok(f.calls().every((call) => !/send|sign|estimateGas/i.test(call.method)));
  });

  it('preserves a real owner-consistency failure from the SDK', async () => {
    const f = await start('owner-mismatch');
    const result = data(
      await f.client.callTool({ name: 'inspect_agent_identity', arguments: { tokenId: '7' } }),
    );
    assert.equal(result.status, 'found');
    assert.equal(result.checks.ownerConsistent, false);
    assert.equal(result.consistent, false);
  });

  it('returns not_found for an unregistered domain, without inventing an identity', async () => {
    const f = await start('not-found');
    const result = data(
      await f.client.callTool({
        name: 'inspect_agent_identity',
        arguments: { domain: 'reader.xyz' },
      }),
    );
    assert.equal(result.status, 'not_found');
    assert.equal(result.tokenId, null);
    assert.equal(result.identity, undefined);
    assert.equal(result.chainId, 8453);
  });

  it('decodes a direct missing-token revert before the consistency Multicall3 batch', async () => {
    const f = await start('not-found');
    const result = data(
      await f.client.callTool({ name: 'inspect_agent_identity', arguments: { tokenId: '999999' } }),
    );
    assert.equal(result.status, 'not_found');
    assert.equal(result.tokenId, '999999');
    assert.equal(result.identity, undefined);
    assert.equal(result.block.tag, 'safe');
    assert.deepEqual(f.multicalls(), []);
    const calls = f.calls().filter((call) => call.method === 'eth_call');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params[0].to.toLowerCase(), registry.toLowerCase());
    assert.deepEqual(calls[0].params[1], atBlock);
  });

  it('rejects ambiguous, invalid and extensible arguments before any fetch', async () => {
    const f = await start();
    for (const input of [
      {},
      { domain: 'reader.xyz', tokenId: '7' },
      { tokenId: 7 },
      { domain: ['reader.xyz'] },
      { domain: 'reader.xyz', expectedOwner: true },
      { domain: 'reader.xyz', rpcUrl: 'https://attacker.example' },
      { tokenId: '7', chainId: 1 },
      { tokenId: '7', registryAddress: owner },
      { tokenId: '7', publicClient: {} },
      { tokenId: '7', apiKey: 'not-allowed' },
      { domain: 'https://reader.xyz' },
      { domain: 'reader.xyz.' },
      { domain: '' },
      { tokenId: '0' },
      { tokenId: '07' },
      { tokenId: '0x7' },
      { tokenId: (2n ** 256n).toString() },
      { tokenId: '7', expectedOwner: 'not-an-address' },
    ]) {
      const result = await f.client.callTool({ name: 'inspect_agent_identity', arguments: input });
      assert.equal(result.isError, true, JSON.stringify(input));
      assert.equal(JSON.parse(result.content[0].text).error.code, 'INVALID_INPUT');
    }
    assert.deepEqual(f.fetches(), []);
  });

  it('rejects OffchainLookup without attempting a CCIP callback fetch', async () => {
    const f = await start('offchain-lookup');
    const result = await f.client.callTool({
      name: 'inspect_agent_identity',
      arguments: { tokenId: '7' },
    });
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).error.code, 'UNAVAILABLE');
    assert.doesNotMatch(result.content[0].text, /https?:\/\//);
    assert.deepEqual(f.multicalls(), []);
    const calls = f.calls().filter((call) => call.method === 'eth_call');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params[0].to.toLowerCase(), registry.toLowerCase());
    assert.deepEqual(calls[0].params[1], atBlock);
    assert.ok(f.fetches().length > 0);
    assert.ok(
      f.fetches().every((request) => new URL(request.url).origin === 'https://mainnet.base.org'),
    );
    assert.ok(
      f.fetches().every((request) => !request.url.includes('rpc-callback.example.invalid')),
    );
  });

  it('pins direct and consistency reads to header A instead of numeric-height fork B', async () => {
    const f = await start('fork-mix');
    const result = data(
      await f.client.callTool({
        name: 'inspect_agent_identity',
        arguments: { domain: 'reader.xyz' },
      }),
    );
    assert.equal(result.status, 'found');
    assert.equal(result.block.hash, blockHash);
    assert.equal(result.identity.owner.toLowerCase(), owner);
    assert.equal(result.nftOwner.toLowerCase(), owner);
    assert.equal(result.consistent, true);
    const calls = f.calls().filter((call) => call.method === 'eth_call');
    assert.equal(calls.length, 3, 'Direct domain and identity reads, then one consistency batch');
    for (const call of calls) assert.deepEqual(call.params[1], atBlock);
    assert.deepEqual(
      calls.map((call) => call.params[0].to.toLowerCase()),
      [
        registry.toLowerCase(),
        registry.toLowerCase(),
        '0xca11bde05977b3631167028862be2a173976ca11',
      ],
    );
  });

  it('fails closed when EIP-1898 is unsupported without numeric or latest fallback', async () => {
    const f = await start('unsupported-eip1898');
    const result = await f.client.callTool({
      name: 'inspect_agent_identity',
      arguments: { tokenId: '7' },
    });
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).error.code, 'UNAVAILABLE');
    assert.doesNotMatch(result.content[0].text, /"status"\s*:\s*"not_found"|https?:\/\//);
    const calls = f.calls().filter((call) => call.method === 'eth_call');
    assert.equal(calls.length, 1, 'An unsupported selector must not trigger a fallback call');
    assert.deepEqual(calls[0].params[1], atBlock);
    assert.deepEqual(f.multicalls(), []);
  });

  it('does not turn an RPC failure, wrong network or changed block into not_found', async () => {
    for (const [mode, code] of [
      ['rpc-error', 'UNAVAILABLE'],
      ['wrong-chain', 'WRONG_CHAIN'],
      ['changed-block', 'UNSAFE_SNAPSHOT'],
    ]) {
      const f = await start(mode);
      const result = await f.client.callTool({
        name: 'inspect_agent_identity',
        arguments: { tokenId: '7' },
      });
      assert.equal(result.isError, true, mode);
      assert.equal(JSON.parse(result.content[0].text).error.code, code);
      assert.doesNotMatch(result.content[0].text, /"status"\s*:\s*"not_found"/);
      assert.doesNotMatch(result.content[0].text, /https?:\/\//);
    }
  });
});
