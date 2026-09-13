import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeFunctionData, encodeErrorResult, encodeFunctionResult, multicall3Abi } from 'viem';
import {
  AGENT_IDENTITY_REGISTRY_BASE as registry,
  IdentityInspectionError,
  inspectAgentIdentity,
} from '../dist/index.js';
import { IDENTITY_INSPECTION_ABI as abi } from '../dist/identity-inspection.js';

const rpcOrigin = 'https://mainnet.base.org';
const multicall = '0xca11bde05977b3631167028862be2a173976ca11';
const height = '0x2faf080';
const A = { hash: '0x' + 'aa'.repeat(32), owner: '0x' + '11'.repeat(20) };
const B = { hash: '0x' + 'bb'.repeat(32), owner: '0x' + '22'.repeat(20) };

function divergentNodes(t, mode = 'found') {
  const calls = [],
    selectors = [],
    targets = [],
    functions = [];
  let numericReads = 0;
  function execute(data, node) {
    const call = decodeFunctionData({ abi, data });
    functions.push(call.functionName);
    const identity = {
      owner: node.owner,
      domain: 'fork.example',
      basename: '',
      ensName: '',
      metadataUri: node === A ? 'ipfs://safe-a' : 'ipfs://foreign-b',
      createdAt: 500n,
      expiresAt: 2000n,
      revoked: false,
    };
    if (call.functionName === 'getIdentity' && mode === 'missing-token' && node === A) {
      return {
        success: false,
        returnData: encodeErrorResult({
          abi,
          errorName: 'TokenDoesNotExist',
          args: [call.args[0]],
        }),
      };
    }
    const values = {
      getIdentity: identity,
      ownerOf: node.owner,
      tokenURI: identity.metadataUri,
      getTokenIdByDomain: mode === 'missing-domain' && node === A ? 0n : 1n,
      isActive: true,
    };
    assert.ok(Object.hasOwn(values, call.functionName), 'only reviewed view functions');
    return {
      success: true,
      returnData: encodeFunctionResult({
        abi,
        functionName: call.functionName,
        result: values[call.functionName],
      }),
    };
  }
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).origin, rpcOrigin, 'no offchain or caller-selected endpoint');
    assert.equal(request.method, 'POST');
    const rpc = await request.json();
    calls.push(rpc);
    let result;
    if (rpc.method === 'eth_chainId') result = '0x2105';
    else if (rpc.method === 'eth_getBlockByNumber') {
      assert.ok(['safe', height].includes(rpc.params[0]));
      result = {
        number: height,
        hash: mode === 'changed-final-header' && rpc.params[0] === height ? B.hash : A.hash,
        timestamp: '0x3e8',
        transactions: [],
      };
    } else {
      assert.equal(rpc.method, 'eth_call');
      const selector = rpc.params[1];
      selectors.push(selector);
      const numeric = typeof selector === 'string';
      if (numeric) {
        assert.equal(selector, height);
        numericReads++;
      } else assert.deepEqual(selector, { blockHash: A.hash, requireCanonical: true });
      // Honest node disagreement: header requests see A, but a numeric-height
      // contract request reaches B. Only an explicit hash selector selects A.
      const node = numeric ? B : A;
      if (!numeric && ['unsupported-eip1898', 'not-canonical'].includes(mode)) {
        return Response.json({
          jsonrpc: '2.0',
          id: rpc.id,
          error: {
            code: mode === 'unsupported-eip1898' ? -32602 : -32000,
            message:
              mode === 'unsupported-eip1898'
                ? 'blockHash selector unsupported'
                : 'block is not canonical',
          },
        });
      }
      assert.equal(rpc.params[0].from, undefined);
      assert.equal(rpc.params[0].value, undefined);
      const target = rpc.params[0].to.toLowerCase();
      targets.push(target);
      if (target === multicall) {
        const batch = decodeFunctionData({ abi: multicall3Abi, data: rpc.params[0].data });
        assert.equal(batch.functionName, 'aggregate3');
        assert.equal(batch.args[0].length, 4, 'one explicit batch for the four consistency checks');
        result = encodeFunctionResult({
          abi: multicall3Abi,
          functionName: 'aggregate3',
          result: batch.args[0].map((call) => {
            assert.equal(call.target.toLowerCase(), registry.toLowerCase());
            return execute(call.callData, node);
          }),
        });
      } else {
        assert.equal(target, registry.toLowerCase());
        const read = execute(rpc.params[0].data, node);
        if (!read.success)
          return Response.json({
            jsonrpc: '2.0',
            id: rpc.id,
            error: { code: 3, message: 'execution reverted', data: read.returnData },
          });
        result = read.returnData;
      }
    }
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result });
  });
  return { calls, selectors, targets, functions, numericReads: () => numericReads };
}

describe(
  'identity observations bind every wire read to the safe block hash',
  { concurrency: false },
  () => {
    for (const input of [{ domain: 'fork.example' }, { tokenId: '1' }]) {
      it(`${Object.keys(input)[0]} cannot consume a foreign same-height fork`, async (t) => {
        const fixture = divergentNodes(t);
        const result = await inspectAgentIdentity({ ...input, expectedOwner: B.owner });
        assert.equal(result.status, 'found');
        assert.equal(result.block.hash, A.hash);
        assert.equal(result.nftOwner.toLowerCase(), A.owner);
        assert.equal(result.identity.owner.toLowerCase(), A.owner);
        assert.equal(result.metadataUri, 'ipfs://safe-a');
        assert.equal(result.consistent, true);
        assert.equal(
          result.checks.expectedOwnerMatches,
          false,
          'fork B owner must not match safe A',
        );
        assert.equal(fixture.numericReads(), 0);
        assert.ok(
          fixture.selectors.every(
            (selector) => selector.blockHash === A.hash && selector.requireCanonical === true,
          ),
        );
        assert.equal(fixture.calls.length, 'domain' in input ? 7 : 6);
        assert.equal(fixture.targets.filter((target) => target === multicall).length, 1);
        assert.deepEqual(fixture.functions.slice(-4), [
          'ownerOf',
          'tokenURI',
          'getTokenIdByDomain',
          'isActive',
        ]);
      });
    }
    for (const mode of ['unsupported-eip1898', 'not-canonical']) {
      it(`${mode} is unavailable, with no numeric/latest fallback or false absence`, async (t) => {
        const fixture = divergentNodes(t, mode);
        await assert.rejects(inspectAgentIdentity({ tokenId: '1' }), (error) => {
          assert.ok(error instanceof IdentityInspectionError);
          assert.equal(error.code, 'UNAVAILABLE');
          return true;
        });
        assert.equal(fixture.numericReads(), 0);
        assert.equal(fixture.calls.length, 3);
        assert.deepEqual(fixture.selectors, [{ blockHash: A.hash, requireCanonical: true }]);
      });
    }
    for (const mode of ['missing-domain', 'missing-token']) {
      it(`${mode} absence also uses the canonical hash`, async (t) => {
        const fixture = divergentNodes(t, mode);
        const input =
          mode === 'missing-domain' ? { domain: 'fork.example' } : { tokenId: '999999' };
        const result = await inspectAgentIdentity(input);
        assert.equal(result.status, 'not_found');
        assert.equal(result.block.hash, A.hash);
        assert.equal(fixture.numericReads(), 0);
        assert.deepEqual(fixture.selectors, [{ blockHash: A.hash, requireCanonical: true }]);
        assert.equal(fixture.calls.length, 5);
      });
    }
    it('still rejects a changed final header after all hash-pinned reads', async (t) => {
      const fixture = divergentNodes(t, 'changed-final-header');
      await assert.rejects(inspectAgentIdentity({ tokenId: '1' }), (error) => {
        assert.ok(error instanceof IdentityInspectionError);
        assert.equal(error.code, 'UNSAFE_SNAPSHOT');
        return true;
      });
      assert.equal(fixture.numericReads(), 0);
    });
  },
);
