import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  getAddress,
  maxUint256,
  multicall3Abi,
  numberToHex,
} from 'viem';
import { base } from 'viem/chains';
import {
  inspectAgentIdentity,
  IdentityInspectionError,
  AGENT_IDENTITY_REGISTRY_BASE,
} from '../dist/index.js';
import { IDENTITY_INSPECTION_ABI } from '../dist/identity-inspection.js';

const owner = getAddress('0x1111111111111111111111111111111111111111');
const other = getAddress('0x2222222222222222222222222222222222222222');
const block = { number: 42n, hash: `0x${'ab'.repeat(32)}`, timestamp: 1_000n };
const identity = {
  owner,
  domain: 'demo.example',
  basename: 'demo.base.eth',
  ensName: '',
  metadataUri: 'ipfs://metadata-claim-not-fetched',
  createdAt: 500n,
  expiresAt: 2_000n,
  revoked: false,
};
const isError = (code) => (error) =>
  error instanceof IdentityInspectionError && error.code === code;

function missing(tokenId) {
  return new BaseError('Contract call failed', {
    cause: new ContractFunctionRevertedError({
      abi: IDENTITY_INSPECTION_ABI,
      functionName: 'getIdentity',
      data: encodeErrorResult({
        abi: IDENTITY_INSPECTION_ABI,
        errorName: 'TokenDoesNotExist',
        args: [tokenId],
      }),
    }),
  });
}

function fixture(overrides = {}) {
  const calls = [];
  const record = { ...identity, ...overrides.identity };
  let chains = 0;
  let blocks = 0;
  const values = {
    getTokenIdByDomain: 1n,
    getIdentity: record,
    ownerOf: record.owner,
    tokenURI: record.metadataUri,
    isActive: !record.revoked && record.expiresAt > block.timestamp,
    ...overrides.values,
  };
  const client = {
    ccipRead: false,
    async getChainId() {
      calls.push(['chain']);
      return overrides.chainIds?.[chains++] ?? 8453;
    },
    async getBlock(args) {
      calls.push(['block', args]);
      const result = overrides.blocks?.[blocks++] ?? block;
      if (result instanceof Error) throw result;
      return result;
    },
    async readContract(args) {
      calls.push(['read', args]);
      const result = values[args.functionName];
      if (result instanceof Error) throw result;
      return typeof result === 'function' ? result(args) : result;
    },
    async multicall(args) {
      calls.push(['multicall', args]);
      assert.equal(args.allowFailure, false);
      assert.equal(args.multicallAddress, base.contracts.multicall3.address);
      return Promise.all(
        args.contracts.map((contract) =>
          client.readContract({
            ...contract,
            blockHash: args.blockHash,
            requireCanonical: args.requireCanonical,
          }),
        ),
      );
    },
  };
  return { client, calls };
}

describe('read-only Base identity inspection', () => {
  it('matches the canonical deployment and never exposes a write ABI', async () => {
    const deployment = JSON.parse(
      await readFile(new URL('../../../contracts/deployments/base-mainnet.json', import.meta.url)),
    );
    assert.equal(
      deployment.contracts.agentIdentityRegistry.toLowerCase(),
      AGENT_IDENTITY_REGISTRY_BASE.toLowerCase(),
    );
    assert.ok(
      IDENTITY_INSPECTION_ABI.every(
        (entry) => entry.type === 'error' || entry.stateMutability === 'view',
      ),
    );
  });

  it('uses one safe block for all reads and returns a JSON-safe report', async () => {
    const { client, calls } = fixture();
    const input = { domain: ' Demo.Example ', expectedOwner: owner };
    const result = await inspectAgentIdentity(input, { publicClient: client });
    assert.equal(result.status, 'found');
    assert.equal(result.lifecycle, 'active');
    assert.equal(result.consistent, true);
    assert.equal(result.checks.expectedOwnerMatches, true);
    assert.deepEqual(result.block, {
      number: '42',
      hash: block.hash,
      timestamp: '1000',
      tag: 'safe',
    });
    assert.equal(result.input.domain, 'demo.example');
    assert.equal(input.domain, ' Demo.Example ');
    assert.equal(result.identity.createdAt, '500');
    assert.doesNotThrow(() => JSON.stringify(result));
    const reads = calls.filter(([method]) => method === 'read');
    assert.equal(reads.length, 6);
    assert.ok(
      reads.every(
        ([, args]) =>
          args.blockHash === block.hash &&
          args.requireCanonical === true &&
          args.blockNumber === undefined &&
          args.blockTag === undefined &&
          args.address === AGENT_IDENTITY_REGISTRY_BASE &&
          !args.account,
      ),
    );
    assert.deepEqual(
      calls.filter(([method]) => method === 'block').map(([, args]) => args),
      [{ blockTag: 'safe' }, { blockNumber: 42n }],
    );
    assert.equal(calls.filter(([method]) => method === 'chain').length, 2);
    assert.equal(calls.filter(([method]) => method === 'multicall').length, 1);
  });

  it('reports expected-wallet mismatch without falsely calling registry data inconsistent', async () => {
    const { client } = fixture();
    const result = await inspectAgentIdentity(
      { tokenId: '1', expectedOwner: other },
      { publicClient: client },
    );
    assert.equal(result.checks.expectedOwnerMatches, false);
    assert.equal(result.consistent, true);
    assert.equal(result.nftOwner, owner);
  });

  it('does not imply an expected owner was checked when none was supplied', async () => {
    const { client } = fixture();
    const result = await inspectAgentIdentity({ tokenId: '1' }, { publicClient: client });
    assert.equal(result.checks.expectedOwnerMatches, null);
  });

  for (const [label, patch, expected] of [
    ['expiry boundary', { expiresAt: 1_000n }, 'expired'],
    ['expired', { expiresAt: 999n }, 'expired'],
    ['revoked', { revoked: true }, 'revoked'],
    ['revoked and expired', { revoked: true, expiresAt: 999n }, 'revoked'],
  ]) {
    it(`reports ${label} without treating consistency as active status`, async () => {
      const { client } = fixture({ identity: patch });
      const result = await inspectAgentIdentity({ tokenId: '1' }, { publicClient: client });
      assert.equal(result.lifecycle, expected);
      assert.equal(result.consistent, true);
    });
  }

  for (const [name, values, check] of [
    ['owner mismatch', { ownerOf: other }, 'ownerConsistent'],
    ['domain reverse mismatch', { getTokenIdByDomain: 2n }, 'domainConsistent'],
    ['metadata mismatch', { tokenURI: 'ipfs://different' }, 'metadataConsistent'],
    ['lifecycle mismatch', { isActive: false }, 'lifecycleConsistent'],
  ]) {
    it(`detects ${name}`, async () => {
      const { client } = fixture({ values });
      const result = await inspectAgentIdentity({ tokenId: '1' }, { publicClient: client });
      assert.equal(result.checks[check], false);
      assert.equal(result.consistent, false);
    });
  }

  it('checks the requested domain as well as its reverse mapping', async () => {
    const { client } = fixture({ identity: { domain: 'different.example' } });
    const result = await inspectAgentIdentity({ domain: 'demo.example' }, { publicClient: client });
    assert.equal(result.checks.domainConsistent, false);
  });

  for (const patch of [{ createdAt: 1001n }, { expiresAt: 499n }]) {
    it('rejects impossible lifecycle timestamps as inconsistent', async () => {
      const { client } = fixture({ identity: patch });
      const result = await inspectAgentIdentity({ tokenId: '1' }, { publicClient: client });
      assert.equal(result.checks.lifecycleConsistent, false);
    });
  }

  it('reports missing domain only after snapshot and chain rechecks', async () => {
    const { client, calls } = fixture({ values: { getTokenIdByDomain: 0n } });
    const result = await inspectAgentIdentity(
      { domain: 'absent.example' },
      { publicClient: client },
    );
    assert.equal(result.status, 'not_found');
    assert.equal(result.tokenId, null);
    assert.equal(calls.filter(([method]) => method === 'read').length, 1);
    assert.equal(calls.filter(([method]) => method === 'block').length, 2);
  });

  it('recognizes only the decoded missing-token error for the requested token', async () => {
    const { client } = fixture({ values: { getIdentity: missing(1n) } });
    const result = await inspectAgentIdentity({ tokenId: '1' }, { publicClient: client });
    assert.equal(result.status, 'not_found');
    assert.equal(result.tokenId, '1');
    const wrong = fixture({ values: { getIdentity: missing(2n) } });
    await assert.rejects(
      inspectAgentIdentity({ tokenId: '1' }, { publicClient: wrong.client }),
      isError('UNAVAILABLE'),
    );
  });

  it('does not disguise a nonzero domain mapping to a missing token as absence', async () => {
    const { client } = fixture({ values: { getIdentity: missing(1n) } });
    await assert.rejects(
      inspectAgentIdentity({ domain: 'demo.example' }, { publicClient: client }),
      isError('UNAVAILABLE'),
    );
  });

  it('sanitizes RPC failures instead of exposing credentials or claiming not found', async () => {
    for (const patch of [
      { values: { getIdentity: new Error('RPC https://secret.example/key credential') } },
      { blocks: [block, new Error('RPC https://secret.example/key credential')] },
      { values: { ownerOf: new Error('TokenDoesNotExist(1)') } },
    ]) {
      const { client } = fixture(patch);
      await assert.rejects(
        inspectAgentIdentity({ tokenId: '1' }, { publicClient: client }),
        (error) => {
          assert.equal(error.code, 'UNAVAILABLE');
          assert.doesNotMatch(error.message, /secret|credential|TokenDoesNotExist/);
          assert.equal(error.cause, undefined);
          return true;
        },
      );
    }
  });

  it('rejects wrong chain before any contract read', async () => {
    const { client, calls } = fixture({ chainIds: [1] });
    await assert.rejects(
      inspectAgentIdentity({ tokenId: '1' }, { publicClient: client }),
      isError('WRONG_CHAIN'),
    );
    assert.equal(calls.length, 1);
  });

  it('rejects network changes before returning a verdict', async () => {
    const { client } = fixture({ chainIds: [8453, 84532] });
    await assert.rejects(
      inspectAgentIdentity({ tokenId: '1' }, { publicClient: client }),
      isError('WRONG_CHAIN'),
    );
  });

  for (const changed of [
    { ...block, hash: `0x${'cd'.repeat(32)}` },
    { ...block, number: 43n },
    { ...block, timestamp: 1001n },
  ]) {
    it('rejects a changed block anchor', async () => {
      const { client } = fixture({ blocks: [block, changed] });
      await assert.rejects(
        inspectAgentIdentity({ tokenId: '1' }, { publicClient: client }),
        isError('UNSAFE_SNAPSHOT'),
      );
    });
  }

  it('rejects an unmined snapshot and does not fall back to latest', async () => {
    const { client, calls } = fixture({ blocks: [{ ...block, hash: null, number: null }] });
    await assert.rejects(
      inspectAgentIdentity({ tokenId: '1' }, { publicClient: client }),
      isError('UNSAFE_SNAPSHOT'),
    );
    assert.equal(calls.filter(([method]) => method === 'block').length, 1);
    const unavailable = fixture({ blocks: [new Error('safe not supported')] });
    await assert.rejects(
      inspectAgentIdentity({ tokenId: '1' }, { publicClient: unavailable.client }),
      isError('UNAVAILABLE'),
    );
    assert.equal(unavailable.calls.filter(([method]) => method === 'block').length, 1);
  });

  for (const input of [
    null,
    {},
    { domain: 'a.example', tokenId: '1' },
    { tokenId: 1 },
    { tokenId: '0' },
    { tokenId: '-1' },
    { tokenId: '01' },
    { tokenId: '1e3' },
    { tokenId: (maxUint256 + 1n).toString() },
    { tokenId: '9'.repeat(79) },
    { domain: '' },
    { domain: 'https://a.example' },
    { domain: 'a.example/' },
    { domain: 'localhost' },
    { domain: 'a..example' },
    { domain: '-a.example' },
    { domain: 'a.example.' },
    { domain: `${'a'.repeat(64)}.example` },
    { domain: `${'a.'.repeat(128)}example` },
    { domain: 'a.example', expectedOwner: '0x123' },
  ]) {
    it(`rejects invalid input ${JSON.stringify(input)} before network use`, async () => {
      const { client, calls } = fixture();
      await assert.rejects(
        inspectAgentIdentity(input, { publicClient: client }),
        isError('INVALID_INPUT'),
      );
      assert.equal(calls.length, 0);
    });
  }

  it('decodes real ABI responses through viem and sends only fixed-block eth_call reads', async () => {
    const requests = [];
    const client = createPublicClient({
      chain: base,
      ccipRead: false,
      transport: custom(
        {
          async request(request) {
            requests.push(request);
            if (request.method === 'eth_chainId') return '0x2105';
            if (request.method === 'eth_getBlockByNumber') {
              return { number: '0x2a', hash: block.hash, timestamp: '0x3e8', transactions: [] };
            }
            assert.equal(request.method, 'eth_call');
            assert.deepEqual(request.params[1], { blockHash: block.hash, requireCanonical: true });
            function encodeRead(data) {
              const decoded = decodeFunctionData({ abi: IDENTITY_INSPECTION_ABI, data });
              const result = {
                getIdentity: identity,
                ownerOf: owner,
                tokenURI: identity.metadataUri,
                getTokenIdByDomain: 1n,
                isActive: true,
              }[decoded.functionName];
              return encodeFunctionResult({
                abi: IDENTITY_INSPECTION_ABI,
                functionName: decoded.functionName,
                result,
              });
            }
            if (request.params[0].to.toLowerCase() === base.contracts.multicall3.address) {
              const aggregate = decodeFunctionData({
                abi: multicall3Abi,
                data: request.params[0].data,
              });
              assert.equal(aggregate.functionName, 'aggregate3');
              assert.equal(aggregate.args[0].length, 4);
              return encodeFunctionResult({
                abi: multicall3Abi,
                functionName: 'aggregate3',
                result: aggregate.args[0].map((call) => {
                  assert.equal(
                    call.target.toLowerCase(),
                    AGENT_IDENTITY_REGISTRY_BASE.toLowerCase(),
                  );
                  return { success: true, returnData: encodeRead(call.callData) };
                }),
              });
            }
            assert.equal(
              request.params[0].to.toLowerCase(),
              AGENT_IDENTITY_REGISTRY_BASE.toLowerCase(),
            );
            return encodeRead(request.params[0].data);
          },
        },
        { retryCount: 0 },
      ),
    });
    const result = await inspectAgentIdentity({ tokenId: '1' }, { publicClient: client });
    assert.equal(result.status, 'found');
    assert.equal(result.consistent, true);
    assert.equal(requests.filter((request) => request.method === 'eth_call').length, 2);
    assert.equal(requests[1].params[0], 'safe');
    assert.ok(requests.every((request) => !/sign|send|wallet|estimateGas/i.test(request.method)));
    assert.equal(numberToHex(BigInt(result.block.number)), '0x2a');
  });
});
