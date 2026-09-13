import assert from 'node:assert/strict';

// Test-process preload only: retain the SDK's default client while directing
// its public RPC HTTP request to the independently checked local fixture.
const target = new URL(process.env.LANGCHAIN_EXAMPLE_FIXTURE_RPC);
assert.equal(target.protocol, 'http:');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.pathname, '/rpc');
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  assert.equal(new URL(request.url).origin, 'https://mainnet.base.org');
  assert.equal(new URL(request.url).pathname, '/');
  assert.equal(request.method, 'POST');
  return nativeFetch(new Request(target, request));
};
