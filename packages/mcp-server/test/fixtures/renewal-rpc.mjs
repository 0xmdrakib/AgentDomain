import assert from 'node:assert/strict';
import {
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  multicall3Abi,
  parseAbi,
} from 'viem';

// Stdio child preload only. Every fetch is intercepted; no network is contacted.
const mode = process.env.RENEWAL_RPC_FIXTURE_MODE ?? 'found';
assert.ok(
  [
    'found',
    'enabled',
    'pending',
    'revoked',
    'expired',
    'insufficient',
    'minimum-unset',
    'not-found',
    'owner-mismatch',
    'vault-mismatch',
    'reservation-mismatch',
    'rpc-error',
    'wrong-chain',
    'changed-block',
    'renewal-changed-block',
    'fork-mix',
    'unsupported-eip1898',
    'offchain-lookup',
    'vault-offchain-lookup',
  ].includes(mode),
);
const registry = '0x234a2B83B32910436A35CDa797CCC57988B9Bd15';
const vault = '0xb7b19826a566ebd9e8b50bee986a8da04bbb2c0a';
const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const multicall = '0xca11bde05977b3631167028862be2a173976ca11';
const owner = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const otherOwner = '0x2222222222222222222222222222222222222222';
const blockHash = `0x${'ab'.repeat(32)}`;
const blockNumber = '0x2faf080';
const atBlock = { blockHash, requireCanonical: true };
const timestamp = 1_800_000_000n;
const window = 2_592_000n;
const expiry = mode === 'expired' ? timestamp - window - 1n : timestamp + 86_400n;
const revoked = mode === 'revoked';
const enabled = [
  'enabled',
  'pending',
  'revoked',
  'expired',
  'insufficient',
  'reservation-mismatch',
].includes(mode);
const reserved = ['pending', 'reservation-mismatch'].includes(mode) ? 3_000_000n : 0n;
const metadataUri = 'https://metadata.example.invalid/identity.json';
let anchorChecks = 0;
const identityAbi = parseAbi([
  'function getTokenIdByDomain(string domain) view returns (uint256)',
  'function getIdentity(uint256 tokenId) view returns ((address owner,string domain,string basename,string ensName,string metadataUri,uint64 createdAt,uint64 expiresAt,bool revoked))',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function isActive(uint256 tokenId) view returns (bool)',
  'function renewalVault() view returns (address)',
  'error TokenDoesNotExist(uint256 tokenId)',
  'error OffchainLookup(address sender,string[] urls,bytes callData,bytes4 callbackFunction,bytes extraData)',
]);
const vaultAbi = parseAbi([
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
  'error OffchainLookup(address sender,string[] urls,bytes callData,bytes4 callbackFunction,bytes extraData)',
]);

function contractRead(target, data, alternateFork = false) {
  const identity = target.toLowerCase() === registry.toLowerCase();
  assert.ok(identity || target.toLowerCase() === vault);
  const abi = identity ? identityAbi : vaultAbi;
  const decoded = decodeFunctionData({ abi, data });
  const functionName = decoded.functionName;
  if (
    (mode === 'offchain-lookup' && functionName === 'getIdentity') ||
    (mode === 'vault-offchain-lookup' && functionName === 'balanceOfToken')
  ) {
    return {
      success: false,
      returnData: encodeErrorResult({
        abi,
        errorName: 'OffchainLookup',
        args: [
          target,
          ['https://rpc-callback.example.invalid/untrusted'],
          '0x1234',
          '0x12345678',
          '0x',
        ],
      }),
    };
  }
  if (functionName === 'getTokenIdByDomain') {
    assert.equal(decoded.args[0], 'reader.xyz');
    return {
      success: true,
      returnData: encodeFunctionResult({
        abi,
        functionName,
        result: mode === 'not-found' ? 0n : 7n,
      }),
    };
  }
  if (decoded.args?.length) {
    const token = decoded.args[0];
    if (identity && (token !== 7n || mode === 'not-found')) {
      return {
        success: false,
        returnData: encodeErrorResult({ abi, errorName: 'TokenDoesNotExist', args: [token] }),
      };
    }
    assert.equal(token, 7n);
  }
  const observedOwner = alternateFork ? otherOwner : owner;
  const identityValues = {
    getIdentity: {
      owner: observedOwner,
      domain: 'reader.xyz',
      basename: 'reader.base.eth',
      ensName: 'reader.eth',
      metadataUri,
      createdAt: 1_700_000_000n,
      expiresAt: expiry,
      revoked,
    },
    ownerOf: mode === 'owner-mismatch' ? otherOwner : observedOwner,
    tokenURI: metadataUri,
    isActive: !revoked && expiry > timestamp,
    renewalVault: vault,
  };
  const vaultValues = {
    balanceOfToken: mode === 'insufficient' ? 1_000_000n : 20_000_000n,
    autoRenewEnabled: enabled,
    pendingRenewals:
      reserved === 0n
        ? [0n, 0n, 0n]
        : [reserved, mode === 'reservation-mismatch' ? expiry + 1n : expiry, timestamp - 300n],
    renewalWindow: window,
    renewalDuration: 31_536_000n,
    renewalFee: mode === 'minimum-unset' ? 0n : alternateFork ? 99_000_000n : 7_000_000n,
    nft: registry,
    registry: mode === 'vault-mismatch' ? otherOwner : registry,
    usdc,
    lastRenewedAt: 0n,
    isRenewable:
      enabled &&
      reserved === 0n &&
      !revoked &&
      expiry <= timestamp + window &&
      timestamp <= expiry + window,
  };
  const values = identity ? identityValues : vaultValues;
  assert.ok(Object.hasOwn(values, functionName));
  return {
    success: true,
    returnData: encodeFunctionResult({ abi, functionName, result: values[functionName] }),
  };
}

function reply({ id, method, params }) {
  console.error(`RENEWAL_RPC_FIXTURE ${JSON.stringify({ method, params })}`);
  if (mode === 'rpc-error')
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: 'UNTRUSTED_RPC_DETAILS https://secret.example.invalid/provider',
      },
    };
  let result;
  switch (method) {
    case 'eth_chainId':
      result = mode === 'wrong-chain' ? '0x1' : '0x2105';
      break;
    case 'eth_getBlockByNumber': {
      assert.ok(['safe', blockNumber].includes(params[0]));
      if (params[0] !== 'safe') anchorChecks++;
      const changed =
        params[0] !== 'safe' &&
        (mode === 'changed-block' || (mode === 'renewal-changed-block' && anchorChecks > 1));
      result = {
        number: blockNumber,
        hash: changed ? `0x${'ef'.repeat(32)}` : blockHash,
        timestamp: `0x${timestamp.toString(16)}`,
        parentHash: `0x${'cd'.repeat(32)}`,
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
    }
    case 'eth_getCode':
      assert.equal(params[0].toLowerCase(), registry.toLowerCase());
      assert.deepEqual(params[1], atBlock);
      result = '0x60006000';
      break;
    case 'eth_call': {
      const alternateFork = mode === 'fork-mix' && params[1] === blockNumber;
      if (!alternateFork) assert.deepEqual(params[1], atBlock);
      assert.equal(params[0].from, undefined, 'No wallet account may enter an observation');
      assert.equal(params[0].value, undefined, 'No value-bearing call is permitted');
      if (mode === 'unsupported-eip1898')
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'EIP-1898 not supported by fixture' },
        };
      if (params[0].to.toLowerCase() === multicall) {
        const batch = decodeFunctionData({ abi: multicall3Abi, data: params[0].data });
        assert.equal(batch.functionName, 'aggregate3');
        const results = batch.args[0].map((call) => {
          const abi = call.target.toLowerCase() === registry.toLowerCase() ? identityAbi : vaultAbi;
          const decoded = decodeFunctionData({ abi, data: call.callData });
          const response = contractRead(call.target, call.callData, alternateFork);
          console.error(
            `RENEWAL_MULTICALL_FIXTURE ${JSON.stringify({
              target: call.target.toLowerCase(),
              functionName: decoded.functionName,
              allowFailure: call.allowFailure,
              success: response.success,
            })}`,
          );
          if (!response.success) assert.equal(call.allowFailure, true);
          return response;
        });
        result = encodeFunctionResult({
          abi: multicall3Abi,
          functionName: 'aggregate3',
          result: results,
        });
      } else {
        assert.equal(params[0].to.toLowerCase(), registry.toLowerCase());
        const response = contractRead(params[0].to, params[0].data, alternateFork);
        if (!response.success)
          return {
            jsonrpc: '2.0',
            id,
            error: { code: 3, message: 'execution reverted', data: response.returnData },
          };
        result = response.returnData;
      }
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
    `RENEWAL_FETCH_FIXTURE ${JSON.stringify({
      url: request.url,
      method: request.method,
      headers: [...request.headers.keys()],
    })}`,
  );
  assert.equal(new URL(request.url).origin, 'https://mainnet.base.org');
  assert.equal(new URL(request.url).pathname, '/');
  assert.equal(new URL(request.url).search, '');
  assert.equal(request.method, 'POST');
  for (const header of request.headers.keys())
    assert.doesNotMatch(header, /authorization|cookie|api.key|signature|payment/i);
  const call = await request.json();
  return Response.json(Array.isArray(call) ? call.map(reply) : reply(call));
};
