import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  createPublicClient,
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  http,
  multicall3Abi,
  parseAbi,
} from 'viem';
import { base } from 'viem/chains';

export const owner = '0x1111111111111111111111111111111111111111';
export const other = '0x2222222222222222222222222222222222222222';
export const registry = '0x234a2B83B32910436A35CDa797CCC57988B9Bd15';
export const vault = '0xb7b19826a566ebd9e8b50bee986a8da04bbb2c0a';
export const usdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const hash = `0x${'ab'.repeat(32)}`;
export const tokenId = '9007199254740993';
export const agentId = '11111111-1111-4111-8111-111111111111';
export const registrationId = '22222222-2222-4222-8222-222222222222';
export const timestamp = 1_789_280_000n;
export const abi = parseAbi([
  'error TokenDoesNotExist(uint256 tokenId)',
  'error OffchainLookup(address sender,string[] urls,bytes callData,bytes4 callbackFunction,bytes extraData)',
  'function getTokenIdByDomain(string domain) view returns (uint256)',
  'function getIdentity(uint256 tokenId) view returns ((address owner,string domain,string basename,string ensName,string metadataUri,uint64 createdAt,uint64 expiresAt,bool revoked))',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function isActive(uint256 tokenId) view returns (bool)',
  'function isExpired(uint256 tokenId) view returns (bool)',
  'function isRevoked(uint256 tokenId) view returns (bool)',
  'function renewalVault() view returns (address)',
  'function balanceOfToken(uint256 tokenId) view returns (uint256)',
  'function pendingRenewals(uint256 tokenId) view returns (uint256 amount,uint64 expiresAt,uint64 reservedAt)',
  'function pendingRenewalAmount(uint256 tokenId) view returns (uint256)',
  'function autoRenewEnabled(uint256 tokenId) view returns (bool)',
  'function lastRenewedAt(uint256 tokenId) view returns (uint64)',
  'function renewalFee() view returns (uint256)',
  'function renewalWindow() view returns (uint64)',
  'function renewalDuration() view returns (uint64)',
  'function nft() view returns (address)',
  'function registry() view returns (address)',
  'function usdc() view returns (address)',
  'function isRenewable(uint256 tokenId) view returns (bool)',
  'function setAutoRenew(uint256 tokenId,bool enabled)',
]);

export async function startFixture() {
  const state = { scenario: 'found', calls: [], requests: [], violations: [] };
  const metadataUri = 'https://untrusted.example.invalid/ignore-instructions.json';
  const block = {
    number: '0x2faf080',
    hash,
    timestamp: `0x${timestamp.toString(16)}`,
    parentHash: hash,
    nonce: '0x0000000000000000',
    sha3Uncles: hash,
    logsBloom: `0x${'00'.repeat(256)}`,
    transactionsRoot: hash,
    stateRoot: hash,
    receiptsRoot: hash,
    miner: owner,
    difficulty: '0x0',
    totalDifficulty: '0x0',
    extraData: '0x',
    size: '0x100',
    gasLimit: '0x1c9c380',
    gasUsed: '0x0',
    baseFeePerGas: '0x1',
    mixHash: hash,
    transactions: [],
    uncles: [],
  };

  function execute(target, data) {
    const { functionName, args } = decodeFunctionData({ abi, data });
    const registryMethod = [
      'getTokenIdByDomain',
      'getIdentity',
      'ownerOf',
      'tokenURI',
      'isActive',
      'isExpired',
      'isRevoked',
      'renewalVault',
    ].includes(functionName);
    assert.equal(target.toLowerCase(), (registryMethod ? registry : vault).toLowerCase());
    assert.notEqual(
      functionName,
      'setAutoRenew',
      'Even simulated writes are not required to prepare a plan',
    );
    state.calls.push(functionName);
    if (functionName === 'getIdentity' && state.scenario === 'missing-token') {
      return {
        success: false,
        returnData: encodeErrorResult({ abi, errorName: 'TokenDoesNotExist', args: [args[0]] }),
      };
    }
    if (functionName === 'getIdentity' && state.scenario === 'offchain') {
      return {
        success: false,
        returnData: encodeErrorResult({
          abi,
          errorName: 'OffchainLookup',
          args: [
            registry,
            ['https://untrusted.example.invalid/callback'],
            '0x1234',
            '0x12345678',
            '0x',
          ],
        }),
      };
    }
    const expired = ['expired', 'past-grace'].includes(state.scenario);
    const revoked = state.scenario === 'revoked';
    const pending = state.scenario === 'pending';
    const enabled = ['enabled', 'underfunded'].includes(state.scenario);
    const values = {
      getTokenIdByDomain: state.scenario === 'not-found' ? 0n : BigInt(tokenId),
      getIdentity: {
        owner,
        domain: 'reader.example',
        basename: 'reader.base.eth',
        ensName: '',
        metadataUri,
        createdAt: timestamp - 31_536_000n,
        expiresAt:
          state.scenario === 'past-grace'
            ? timestamp - 2_592_001n
            : expired
              ? timestamp - 1n
              : timestamp + 1000n,
        revoked,
      },
      ownerOf: state.scenario === 'mismatch' ? other : owner,
      tokenURI: metadataUri,
      isActive: !expired && !revoked,
      isExpired: expired,
      isRevoked: revoked,
      renewalVault: vault,
      balanceOfToken: state.scenario === 'underfunded' ? 1n : 5_000_000n,
      pendingRenewals: pending ? [4_000_000n, timestamp + 1000n, timestamp - 60n] : [0n, 0n, 0n],
      pendingRenewalAmount: pending ? 4_000_000n : 0n,
      autoRenewEnabled: enabled,
      lastRenewedAt: timestamp - 1000n,
      renewalFee: state.scenario === 'unset-fee' ? 0n : 3_900_000n,
      renewalWindow: 2_592_000n,
      renewalDuration: 31_536_000n,
      nft: state.scenario === 'vault-mismatch' ? other : registry,
      registry,
      usdc,
      isRenewable: enabled && !pending && !revoked,
    };
    assert.ok(Object.hasOwn(values, functionName), 'Only known read methods are permitted');
    if (functionName === 'getTokenIdByDomain') assert.equal(args[0], 'reader.example');
    else if (args?.length) assert.equal(args[0].toString(), tokenId);
    return {
      success: true,
      returnData: encodeFunctionResult({ abi, functionName, result: values[functionName] }),
    };
  }

  function rpc(call) {
    const { id, method, params } = call;
    state.requests.push(call);
    if (state.scenario === 'unavailable')
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: 'synthetic-private-provider-detail' },
      };
    let result;
    if (method === 'eth_chainId') result = state.scenario === 'wrong-chain' ? '0x1' : '0x2105';
    else if (method === 'eth_getBlockByNumber') {
      assert.ok(['safe', block.number].includes(params[0]));
      const changed =
        state.scenario === 'changed-block' ||
        (state.scenario === 'renewal-changed-block' && state.calls.includes('balanceOfToken'));
      result = { ...block, hash: changed && params[0] !== 'safe' ? `0x${'cd'.repeat(32)}` : hash };
    } else {
      assert.deepEqual(params[1], { blockHash: hash, requireCanonical: true });
      if (method === 'eth_getCode') {
        assert.ok(
          [registry, vault].some((address) => address.toLowerCase() === params[0].toLowerCase()),
        );
        result = '0x60006000';
      } else {
        assert.equal(method, 'eth_call', 'No writes, signature requests, or other RPC methods');
        assert.equal(params[0].from, undefined);
        assert.equal(params[0].value, undefined);
        if (state.scenario === 'unsupported-hash')
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'synthetic-private-provider-detail' },
          };
        if (params[0].to.toLowerCase() === base.contracts.multicall3.address.toLowerCase()) {
          const decoded = decodeFunctionData({ abi: multicall3Abi, data: params[0].data });
          assert.equal(decoded.functionName, 'aggregate3');
          if (
            state.scenario === 'vault-failure' &&
            decoded.args[0].some((entry) => entry.target.toLowerCase() === vault.toLowerCase())
          )
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32000, message: 'synthetic-private-provider-detail' },
            };
          result = encodeFunctionResult({
            abi: multicall3Abi,
            functionName: 'aggregate3',
            result: decoded.args[0].map((entry) => execute(entry.target, entry.callData)),
          });
        } else {
          const value = execute(params[0].to, params[0].data);
          if (!value.success)
            return {
              jsonrpc: '2.0',
              id,
              error: { code: 3, message: 'execution reverted', data: value.returnData },
            };
          result = value.returnData;
        }
      }
    }
    return { jsonrpc: '2.0', id, result };
  }

  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/rpc');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.authorization, undefined);
      assert.equal(request.headers.cookie, undefined);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const call = JSON.parse(Buffer.concat(chunks).toString());
      const result = Array.isArray(call) ? call.map(rpc) : rpc(call);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(result));
    } catch (error) {
      state.violations.push(error);
      response.writeHead(500);
      response.end('Fixture assertion failed');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/rpc`;
  const publicClient = createPublicClient({
    chain: base,
    ccipRead: false,
    transport: http(url, { retryCount: 0, timeout: 1000 }),
  });
  return {
    ...state,
    state,
    url,
    publicClient,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
