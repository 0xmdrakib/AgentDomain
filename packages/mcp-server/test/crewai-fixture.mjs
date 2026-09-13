import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionResult, multicall3Abi, parseAbi } from 'viem';
import './fixtures/identity-rpc.mjs';

// The real MCP server and SDK run below. Only their network boundary is replaced.
for (const key of Object.keys(process.env)) {
  assert.doesNotMatch(
    key,
    /^(AGENT_PRIVATE_KEY|AGENTDOMAIN_API_KEY|ALLOW_WRITES|NODE_OPTIONS|OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY)$/i,
  );
}
assert.equal(process.env.AGENTDOMAIN_ENABLE_WRITE_TOOLS, 'false');
assert.equal(process.env.AGENTDOMAIN_API_URL, undefined);
console.error(`CREWAI_CHILD ${JSON.stringify({ pid: process.pid, writes: false })}`);

const mode = process.argv[2] ?? 'found';
const writeStdout = process.stdout.write.bind(process.stdout);
process.stdout.write = function (chunk, ...args) {
  if (['missing-tool', 'duplicate-tool', 'invalid-schema'].includes(mode)) {
    try {
      const message = JSON.parse(String(chunk));
      const tools = message.result?.tools;
      if (Array.isArray(tools)) {
        const target = tools.find((tool) => tool.name === 'inspect_agent_identity');
        assert.ok(target);
        if (mode === 'missing-tool') message.result.tools = tools.filter((tool) => tool !== target);
        if (mode === 'duplicate-tool') tools.push(target);
        if (mode === 'invalid-schema') target.inputSchema.additionalProperties = true;
        chunk = `${JSON.stringify(message)}\n`;
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return writeStdout(chunk, ...args);
};
const registry = '0x234a2B83B32910436A35CDa797CCC57988B9Bd15';
const vault = '0xb7b19826a566ebd9e8b50bee986a8da04bbb2c0a';
const hash = `0x${'ab'.repeat(32)}`;
const abi = parseAbi([
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
  'function renewalVault() view returns (address)',
]);
const values = {
  balanceOfToken: mode === 'underfunded' ? 0n : 50_000_000n,
  autoRenewEnabled: mode === 'no-change' || mode === 'pending',
  pendingRenewals: mode === 'pending' ? [5_000_000n, 2_000_000_000n, 1_780_682_752n] : [0n, 0n, 0n],
  renewalWindow: 2_592_000n,
  renewalDuration: 31_536_000n,
  renewalFee: 5_000_000n,
  nft: registry,
  registry,
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  lastRenewedAt: 0n,
  isRenewable: false, // Fixture expiry is outside the renewal window.
  renewalVault: vault,
};

const identityFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const payload = await request.clone().json();
  const calls = Array.isArray(payload) ? payload : [payload];
  const replies = [];
  for (const call of calls) {
    console.error(
      `CREWAI_RPC ${JSON.stringify({ pid: process.pid, mode, method: call.method, params: call.params })}`,
    );
    assert.ok(
      ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'].includes(call.method),
    );
    if (mode === 'rpc-error') {
      replies.push({
        jsonrpc: '2.0',
        id: call.id,
        error: { code: -32000, message: 'Fixture unavailable' },
      });
      continue;
    }
    let decoded;
    if (
      call.method === 'eth_call' &&
      call.params[0].to.toLowerCase() === '0xca11bde05977b3631167028862be2a173976ca11'
    ) {
      decoded = decodeFunctionData({ abi: multicall3Abi, data: call.params[0].data });
    }
    const renewal = decoded?.args[0].some((item) => item.target.toLowerCase() === vault);
    if (renewal) {
      assert.equal(new URL(request.url).href, 'https://mainnet.base.org/');
      assert.equal(request.method, 'POST');
      for (const name of request.headers.keys())
        assert.doesNotMatch(name, /authorization|cookie|api.key/i);
      assert.deepEqual(call.params[1], { blockHash: hash, requireCanonical: true });
      assert.equal(call.params[0].from, undefined);
      assert.equal(call.params[0].value, undefined);
      assert.equal(decoded.functionName, 'aggregate3');
      const results = decoded.args[0].map((item) => {
        const { functionName, args } = decodeFunctionData({ abi, data: item.callData });
        assert.equal(
          item.target.toLowerCase(),
          functionName === 'renewalVault' ? registry.toLowerCase() : vault,
        );
        if (args?.length) assert.equal(args[0], 7n);
        assert.ok(Object.hasOwn(values, functionName));
        console.error(`CREWAI_VAULT ${JSON.stringify({ functionName, at: call.params[1] })}`);
        return {
          success: true,
          returnData: encodeFunctionResult({ abi, functionName, result: values[functionName] }),
        };
      });
      replies.push({
        jsonrpc: '2.0',
        id: call.id,
        result: encodeFunctionResult({
          abi: multicall3Abi,
          functionName: 'aggregate3',
          result: results,
        }),
      });
    } else {
      const result = await identityFetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(call),
      });
      replies.push(await result.json());
    }
  }
  return Response.json(Array.isArray(payload) ? replies : replies[0]);
};

await import('../dist/index.js');
