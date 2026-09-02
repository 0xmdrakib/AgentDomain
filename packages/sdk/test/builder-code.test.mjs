import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { encodeFunctionData } from 'viem';
import {
  encodeBuilderCodeSuffix,
  parseBuilderCodeSuffixFromCalldata,
} from '@x402/extensions/builder-code';
import {
  AgentDomain,
  appendBuilderCodeAttribution,
  encodeSetAutoRenewCalldata,
} from '../dist/index.js';

const owner = '0x1111111111111111111111111111111111111111';
const vault = '0x2222222222222222222222222222222222222222';
const txHash = `0x${'ab'.repeat(32)}`;
const builderCode = 'agentdomain_test';
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('public API default', () => {
  it('uses the canonical API subdomain', async () => {
    let requestedUrl;
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ available: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const ad = new AgentDomain();
    await ad.checkAvailability('research-agent', { tld: 'xyz' });

    assert.equal(
      requestedUrl,
      'https://api.agentdomain.app/api/v1/domains/availability?name=research-agent&tld=xyz',
    );
  });
});

describe('ERC-8021 direct Base attribution', () => {
  it('encodes and decodes app attribution on RenewalVault calldata', () => {
    const data = encodeSetAutoRenewCalldata(42n, true, builderCode);
    assert.deepEqual(parseBuilderCodeSuffixFromCalldata(data), { a: builderCode });
  });

  it('preserves matching attribution and rejects invalid or conflicting attribution', () => {
    const baseData = '0x12345678';
    const attributed = appendBuilderCodeAttribution(baseData, builderCode);
    assert.equal(appendBuilderCodeAttribution(attributed, builderCode), attributed);
    assert.throws(
      () => appendBuilderCodeAttribution(attributed, 'other_builder'),
      /different builder-code attribution/,
    );
    assert.throws(() => appendBuilderCodeAttribution(baseData, 'INVALID-CODE'), /1-32 lowercase/);
  });

  it('submits attributed setAutoRenew calldata through the configured wallet client', async () => {
    let submitted;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          tokenId: '42',
          ownerAddress: owner,
          autoRenewEnabled: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    const ad = new AgentDomain({
      apiUrl: 'https://example.test/api/v1',
      builderCode,
      renewalVaultAddress: vault,
      walletClient: {
        account: { address: owner },
        sendTransaction: async (request) => {
          submitted = request;
          return txHash;
        },
      },
    });

    const result = await ad.setAutoRenew('agent-id', true);

    assert.equal(result.txHash, txHash);
    assert.equal(submitted.to, vault);
    assert.deepEqual(parseBuilderCodeSuffixFromCalldata(submitted.data), { a: builderCode });
  });

  it('fails before wallet submission when direct attribution is missing', async () => {
    let submitted = false;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          tokenId: '42',
          ownerAddress: owner,
          autoRenewEnabled: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    const ad = new AgentDomain({
      apiUrl: 'https://example.test/api/v1',
      renewalVaultAddress: vault,
      walletClient: {
        account: { address: owner },
        sendTransaction: async () => {
          submitted = true;
          return txHash;
        },
      },
    });

    await assert.rejects(() => ad.setAutoRenew('agent-id', true), /requires builderCode/);
    assert.equal(submitted, false);
  });

  it('does not report auto-renew success when the confirmed transaction reverted', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          tokenId: '42',
          ownerAddress: owner,
          autoRenewEnabled: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    const ad = new AgentDomain({
      apiUrl: 'https://example.test/api/v1',
      builderCode,
      renewalVaultAddress: vault,
      walletClient: {
        account: { address: owner },
        sendTransaction: async () => txHash,
      },
      publicClient: {
        waitForTransactionReceipt: async () => ({ status: 'reverted' }),
      },
    });

    await assert.rejects(
      () => ad.setAutoRenew('agent-id', true, { waitForReceipt: true }),
      /reverted on Base/,
    );
  });

  it('attributes the Base withdrawal transaction returned by the API', async () => {
    const rawData = encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'withdraw',
          inputs: [
            { name: 'tokenId', type: 'uint256' },
            { name: 'amount', type: 'uint256' },
          ],
          outputs: [],
        },
      ],
      functionName: 'withdraw',
      args: [42n, 1_000_000n],
    });
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          chainId: 8453,
          to: vault,
          data: rawData,
          value: '0',
          functionName: 'withdraw',
          args: { tokenId: '42', amount: '1000000' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    const ad = new AgentDomain({ apiUrl: 'https://example.test/api/v1', builderCode });

    const transaction = await ad.withdrawFromVault('agent-id', '1');

    assert.equal(transaction.data.startsWith(rawData), true);
    assert.deepEqual(parseBuilderCodeSuffixFromCalldata(transaction.data), { a: builderCode });
  });

  it('recognizes a suffix produced directly by the official encoder', () => {
    const suffix = encodeBuilderCodeSuffix({ a: builderCode });
    assert.deepEqual(parseBuilderCodeSuffixFromCalldata(`0x12345678${suffix.slice(2)}`), {
      a: builderCode,
    });
  });
});
