import assert from 'node:assert/strict';
import {
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  multicall3Abi,
  parseAbi,
} from 'viem';

// Test-process preload only. Every fetch is intercepted; no network is contacted.
const mode = process.env.IDENTITY_RPC_FIXTURE_MODE ?? 'found';
const registry = '0x234a2B83B32910436A35CDa797CCC57988B9Bd15';
const multicall = '0xca11bde05977b3631167028862be2a173976ca11';
const owner = '0x1111111111111111111111111111111111111111';
const blockHash = `0x${'ab'.repeat(32)}`;
const blockNumber = '0x2faf080'; // 50,000,000, after Base's Multicall3 deployment.
const abi = parseAbi([
  'function getTokenIdByDomain(string domain) view returns (uint256)',
  'function getIdentity(uint256 tokenId) view returns ((address owner,string domain,string basename,string ensName,string metadataUri,uint64 createdAt,uint64 expiresAt,bool revoked))',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function isActive(uint256 tokenId) view returns (bool)',
  'function isExpired(uint256 tokenId) view returns (bool)',
  'function isRevoked(uint256 tokenId) view returns (bool)',
  'error TokenDoesNotExist(uint256 tokenId)',
  'error OffchainLookup(address sender,string[] urls,bytes callData,bytes4 callbackFunction,bytes extraData)',
]);
const metadataUri = 'https://metadata.example.invalid/identity.json';

function contractRead(data, alternateFork = false) {
  const decoded = decodeFunctionData({ abi, data });
  const observedOwner = alternateFork ? '0x3333333333333333333333333333333333333333' : owner;
  if (mode === 'offchain-lookup' && decoded.functionName === 'getIdentity') {
    return {
      success: false,
      returnData: encodeErrorResult({
        abi,
        errorName: 'OffchainLookup',
        args: [
          registry,
          ['https://rpc-callback.example.invalid/untrusted'],
          '0x1234',
          '0x12345678',
          '0x',
        ],
      }),
    };
  }
  if (decoded.functionName === 'getTokenIdByDomain') {
    assert.equal(decoded.args[0], 'reader.xyz');
    return {
      success: true,
      returnData: encodeFunctionResult({
        abi,
        functionName: decoded.functionName,
        result: mode === 'not-found' ? 0n : 7n,
      }),
    };
  }
  const tokenId = decoded.args[0];
  if (tokenId !== 7n || mode === 'not-found') {
    return {
      success: false,
      returnData: encodeErrorResult({ abi, errorName: 'TokenDoesNotExist', args: [tokenId] }),
    };
  }
  const values = {
    getIdentity: {
      owner: observedOwner,
      domain: 'reader.xyz',
      basename: 'reader.base.eth',
      ensName: 'reader.eth',
      metadataUri,
      createdAt: 1_700_000_000n,
      expiresAt: 2_000_000_000n,
      revoked: false,
    },
    ownerOf:
      mode === 'owner-mismatch' ? '0x2222222222222222222222222222222222222222' : observedOwner,
    tokenURI: metadataUri,
    isActive: true,
    isExpired: false,
    isRevoked: false,
  };
  assert.ok(Object.hasOwn(values, decoded.functionName));
  return {
    success: true,
    returnData: encodeFunctionResult({
      abi,
      functionName: decoded.functionName,
      result: values[decoded.functionName],
    }),
  };
}

function reply(call) {
  const { id, method, params } = call;
  console.error(`IDENTITY_RPC_FIXTURE ${JSON.stringify({ method, params })}`);
  if (mode === 'rpc-error') {
    return { jsonrpc: '2.0', id, error: { code: -32000, message: 'Fixture RPC unavailable' } };
  }
  let result;
  switch (method) {
    case 'eth_chainId':
      result = mode === 'wrong-chain' ? '0x1' : '0x2105';
      break;
    case 'eth_getBlockByNumber':
      assert.ok(['safe', blockNumber].includes(params[0]), 'Only the safe snapshot may be read');
      result = {
        number: blockNumber,
        hash: mode === 'changed-block' && params[0] !== 'safe' ? `0x${'ef'.repeat(32)}` : blockHash,
        parentHash: `0x${'cd'.repeat(32)}`,
        timestamp: '0x6a9ba000',
        nonce: '0x0000000000000000',
        sha3Uncles: `0x${'00'.repeat(32)}`,
        logsBloom: `0x${'00'.repeat(256)}`,
        transactionsRoot: `0x${'00'.repeat(32)}`,
        stateRoot: `0x${'00'.repeat(32)}`,
        receiptsRoot: `0x${'00'.repeat(32)}`,
        miner: '0x0000000000000000000000000000000000000000',
        difficulty: '0x0',
        totalDifficulty: '0x0',
        extraData: '0x',
        size: '0x100',
        gasLimit: '0x1c9c380',
        gasUsed: '0x0',
        baseFeePerGas: '0x1',
        mixHash: `0x${'00'.repeat(32)}`,
        transactions: [],
        uncles: [],
      };
      break;
    case 'eth_getCode':
      assert.equal(params[0].toLowerCase(), registry.toLowerCase());
      assert.deepEqual(params[1], { blockHash, requireCanonical: true });
      result = '0x60006000';
      break;
    case 'eth_call': {
      // Model a load balancer serving fork B for numeric reads, but header A throughout.
      const alternateFork = mode === 'fork-mix' && params[1] === blockNumber;
      if (!alternateFork) assert.deepEqual(params[1], { blockHash, requireCanonical: true });
      assert.equal(params[0].from, undefined, 'A public observation needs no signer');
      assert.equal(params[0].value, undefined, 'No value-bearing call is permitted');
      if (mode === 'unsupported-eip1898') {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Fixture does not support EIP-1898 selectors' },
        };
      }
      if (params[0].to.toLowerCase() === multicall) {
        const batch = decodeFunctionData({ abi: multicall3Abi, data: params[0].data });
        assert.equal(batch.functionName, 'aggregate3');
        const results = batch.args[0].map((call) => {
          assert.equal(call.target.toLowerCase(), registry.toLowerCase());
          const result = contractRead(call.callData, alternateFork);
          const decoded = decodeFunctionData({ abi, data: call.callData });
          console.error(
            `IDENTITY_MULTICALL_FIXTURE ${JSON.stringify({ functionName: decoded.functionName, allowFailure: call.allowFailure, success: result.success })}`,
          );
          if (!result.success) assert.equal(call.allowFailure, true);
          return result;
        });
        result = encodeFunctionResult({
          abi: multicall3Abi,
          functionName: 'aggregate3',
          result: results,
        });
        break;
      }
      assert.equal(params[0].to.toLowerCase(), registry.toLowerCase());
      const response = contractRead(params[0].data, alternateFork);
      if (!response.success) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: 3, message: 'execution reverted', data: response.returnData },
        };
      }
      result = response.returnData;
      break;
    }
    default:
      assert.fail(`Unexpected RPC method: ${method}`);
  }
  return { jsonrpc: '2.0', id, result };
}

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  console.error(
    `IDENTITY_FETCH_FIXTURE ${JSON.stringify({ url: request.url, method: request.method, headers: [...request.headers.keys()] })}`,
  );
  assert.equal(new URL(request.url).origin, 'https://mainnet.base.org');
  assert.equal(new URL(request.url).pathname, '/');
  assert.equal(new URL(request.url).search, '');
  assert.equal(request.method, 'POST');
  for (const header of request.headers.keys()) {
    assert.doesNotMatch(header, /authorization|cookie|api.key|signature|payment/i);
  }
  const call = await request.json();
  return Response.json(Array.isArray(call) ? call.map(reply) : reply(call));
};
