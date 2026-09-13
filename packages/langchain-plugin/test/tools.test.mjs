import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { isLangChainTool, ToolInputParsingException } from '@langchain/core/tools';
import { isToolMessage } from '@langchain/core/messages';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import {
  inspectAgentIdentity,
  inspectAgentRenewal,
  prepareAutoRenewChange,
  parseBuilderCodeAttribution,
} from '@agentdomain/sdk';
import { decodeFunctionData } from 'viem';
import { createAgentDomainTools } from '../dist/index.js';
import { abi, hash, other, owner, startFixture, tokenId, vault } from './fixtures/base-rpc.mjs';

process.env.LANGSMITH_TRACING = 'false';
process.env.LANGCHAIN_TRACING_V2 = 'false';

let fixture;
const nativeFetch = globalThis.fetch;
const unexpected = [];
before(async () => {
  fixture = await startFixture();
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== fixture.url) {
      unexpected.push(request.url);
      throw new Error('External requests are forbidden in this integration test');
    }
    return nativeFetch(input, init);
  };
});
beforeEach(() => {
  fixture.state.scenario = 'found';
  fixture.state.requests.length = 0;
  fixture.state.calls.length = 0;
});
afterEach(() => {
  assert.deepEqual(fixture.state.violations, []);
  assert.deepEqual(unexpected, [], 'No arbitrary URI, CCIP, model, telemetry or API fetch');
});
after(async () => {
  globalThis.fetch = nativeFetch;
  await fixture?.close();
});

describe('renewal observation and unsigned planning through LangChain', () => {
  function tools(includeUnsignedPlans = false) {
    return createAgentDomainTools({ publicClient: fixture.publicClient, includeUnsignedPlans });
  }
  const intent = { tokenId, expectedOwner: owner, enabled: true, builderCode: 'fixture_app' };

  it('reads the vault and identity at the same hash without treating the minimum as a quote', async () => {
    const input = { tokenId };
    const result = await tools()
      .find((candidate) => candidate.name === 'inspect_agent_renewal')
      .invoke(input);
    assert.equal(result.ok, true);
    assert.equal(result.data.status, 'found');
    assert.equal(result.data.identity.block.hash, hash);
    assert.equal(result.data.vault.availableAtomicUsdc, '5000000');
    assert.equal(result.data.vault.reservedAtomicUsdc, '0');
    assert.equal(result.data.vault.minimumFeeAtomicUsdc, '3900000');
    assert.equal(result.data.renewalExecution, 'keeper_registrar_confirmation_required');
    assert.equal(result.data.consistent, true);
    assert.equal('quote' in result.data, false);
    assert.deepEqual(
      result.data,
      await inspectAgentRenewal(input, { publicClient: fixture.publicClient }),
    );
  });

  it('keeps native isRenewable true separate from underfunding', async () => {
    fixture.state.scenario = 'underfunded';
    const result = await tools()
      .find((candidate) => candidate.name === 'inspect_agent_renewal')
      .invoke({ tokenId });
    assert.equal(result.ok, true);
    assert.equal(result.data.vault.isRenewable, true);
    assert.equal(result.data.checks.availableCoversMinimum, false);
    assert.equal(result.data.consistent, true);
  });

  it('preserves an unset minimum without inventing a price or affordability verdict', async () => {
    fixture.state.scenario = 'unset-fee';
    const result = await tools()
      .find((candidate) => candidate.name === 'inspect_agent_renewal')
      .invoke({ tokenId });
    assert.equal(result.ok, true);
    assert.equal(result.data.vault.minimumFeeAtomicUsdc, '0');
    assert.equal(result.data.checks.minimumFeeConfigured, false);
    assert.equal(result.data.checks.availableCoversMinimum, false);
  });

  it('returns missing renewal identity without claiming an empty vault', async () => {
    fixture.state.scenario = 'not-found';
    const result = await tools()
      .find((candidate) => candidate.name === 'inspect_agent_renewal')
      .invoke({ domain: 'reader.example' });
    assert.equal(result.ok, true);
    assert.equal(result.data.status, 'not_found');
    assert.equal('vault' in result.data, false);
    assert.equal(fixture.state.calls.includes('balanceOfToken'), false);
  });

  for (const [scenario, code] of [
    ['vault-failure', 'UNAVAILABLE'],
    ['renewal-changed-block', 'UNSAFE_SNAPSHOT'],
  ]) {
    it(`rejects partial renewal observations on ${scenario}`, async () => {
      fixture.state.scenario = scenario;
      const result = await tools()
        .find((candidate) => candidate.name === 'inspect_agent_renewal')
        .invoke({ tokenId });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, code);
      assert.equal('data' in result, false);
    });
  }

  it('has no prepare tool by default and never exposes execution or model approval', () => {
    assert.equal(
      tools().some((candidate) => candidate.name === 'prepare_auto_renew_change'),
      false,
    );
    assert.equal(
      tools('true').some((candidate) => candidate.name === 'prepare_auto_renew_change'),
      false,
    );
    const configured = tools(true);
    assert.deepEqual(
      configured.map((candidate) => candidate.name),
      ['inspect_agent_identity', 'inspect_agent_renewal', 'prepare_auto_renew_change'],
    );
    assert.ok(configured.every(isLangChainTool));
    const plan = convertToOpenAITool(configured[2]);
    assert.deepEqual(plan.function.parameters.required.sort(), [
      'builderCode',
      'enabled',
      'expectedOwner',
      'tokenId',
    ]);
    assert.deepEqual(Object.keys(plan.function.parameters.properties).sort(), [
      'builderCode',
      'enabled',
      'expectedOwner',
      'tokenId',
    ]);
    assert.equal(plan.function.parameters.additionalProperties, false);
  });

  it('prepares exact zero-value attributed calldata without simulating or submitting any write', async () => {
    const planTool = tools(true).find(
      (candidate) => candidate.name === 'prepare_auto_renew_change',
    );
    const result = await planTool.invoke(intent);
    assert.equal(result.ok, true);
    assert.equal(result.data.kind, 'set_auto_renew');
    assert.equal(result.data.noChange, false);
    assert.equal(result.data.chainId, 8453);
    assert.equal(result.data.transaction.to.toLowerCase(), vault);
    assert.equal(result.data.transaction.value, '0');
    const decoded = decodeFunctionData({ abi, data: result.data.transaction.data });
    assert.equal(decoded.functionName, 'setAutoRenew');
    assert.deepEqual(decoded.args, [BigInt(tokenId), true]);
    assert.equal(parseBuilderCodeAttribution(result.data.transaction.data).a, 'fixture_app');
    assert.deepEqual(
      result.data,
      await prepareAutoRenewChange(intent, { publicClient: fixture.publicClient }),
    );
    assert.equal(fixture.state.calls.includes('setAutoRenew'), false);
    assert.doesNotThrow(() => JSON.stringify(result));
  });

  it('returns noChange when the requested flag already matches', async () => {
    fixture.state.scenario = 'enabled';
    const result = await tools(true)
      .find((candidate) => candidate.name === 'prepare_auto_renew_change')
      .invoke(intent);
    assert.equal(result.ok, true);
    assert.equal(result.data.noChange, true);
  });

  it('preserves the pending reservation warning when preparing disable', async () => {
    fixture.state.scenario = 'pending';
    const result = await tools(true)
      .find((candidate) => candidate.name === 'prepare_auto_renew_change')
      .invoke({ ...intent, enabled: false });
    assert.equal(result.ok, true);
    assert.equal(result.data.observation.vault.reservedAtomicUsdc, '4000000');
    assert.equal(result.data.observation.vault.pendingRenewal.amountAtomicUsdc, '4000000');
    assert.ok(result.data.warnings.some((warning) => /does not cancel/.test(warning)));
  });

  for (const [scenario, input, code] of [
    ['found', { ...intent, expectedOwner: other }, 'OWNER_MISMATCH'],
    ['missing-token', intent, 'IDENTITY_NOT_FOUND'],
    ['mismatch', intent, 'INCONSISTENT_STATE'],
    ['vault-mismatch', intent, 'INCONSISTENT_STATE'],
    ['revoked', intent, 'REVOKED'],
    ['past-grace', intent, 'EXPIRED_TOO_LONG'],
  ]) {
    it(`does not prepare a plan for ${scenario}/${code}`, async () => {
      fixture.state.scenario = scenario;
      const result = await tools(true)
        .find((candidate) => candidate.name === 'prepare_auto_renew_change')
        .invoke(input);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, code);
      assert.equal('data' in result, false);
    });
  }

  it('allows unsigned disable of a revoked identity without claiming renewal success', async () => {
    fixture.state.scenario = 'revoked';
    const result = await tools(true)
      .find((candidate) => candidate.name === 'prepare_auto_renew_change')
      .invoke({ ...intent, enabled: false });
    assert.equal(result.ok, true);
    assert.equal(result.data.observation.identity.lifecycle, 'revoked');
    assert.equal(result.data.enabled, false);
  });

  for (const input of [
    { ...intent, approved: true },
    { ...intent, enabled: 'true' },
    { ...intent, builderCode: '' },
    { ...intent, builderCode: 'a'.repeat(33) },
    { ...intent, expectedOwner: undefined },
    { ...intent, rpcUrl: 'https://untrusted.example.invalid' },
  ]) {
    it(`rejects invalid or approval-bearing plan input (${Object.keys(input).join(',')})`, async () => {
      await assert.rejects(
        tools(true)
          .find((candidate) => candidate.name === 'prepare_auto_renew_change')
          .invoke(input),
        ToolInputParsingException,
      );
      assert.equal(fixture.state.requests.length, 0);
    });
  }
});
function identityTool() {
  return createAgentDomainTools({ publicClient: fixture.publicClient }).find(
    (candidate) => candidate.name === 'inspect_agent_identity',
  );
}

describe('real LangChain identity tools with actual SDK over HTTP', () => {
  it('creates genuine schema-bound tools with no eager network request', () => {
    const tools = createAgentDomainTools({ publicClient: fixture.publicClient });
    assert.deepEqual(
      tools.map((candidate) => candidate.name),
      ['inspect_agent_identity', 'inspect_agent_renewal'],
    );
    assert.ok(tools.every(isLangChainTool));
    assert.equal(fixture.state.requests.length, 0);
    const converted = convertToOpenAITool(identityTool());
    assert.equal(converted.type, 'function');
    assert.equal(converted.function.name, 'inspect_agent_identity');
    assert.equal(converted.function.parameters.type, 'object');
    assert.equal(converted.function.parameters.additionalProperties, false);
    assert.deepEqual(Object.keys(converted.function.parameters.properties).sort(), [
      'domain',
      'expectedOwner',
      'tokenId',
    ]);
  });

  it('returns the unchanged JSON-safe SDK observation, including large token IDs and recorded URI', async () => {
    const input = { domain: 'reader.example', expectedOwner: owner };
    const result = await identityTool().invoke(input);
    assert.equal(result.ok, true);
    assert.equal(result.data.status, 'found');
    assert.equal(result.data.tokenId, tokenId);
    assert.equal(result.data.block.hash, hash);
    assert.equal(result.data.checks.expectedOwnerMatches, true);
    assert.equal(result.data.consistent, true);
    assert.match(result.data.identity.metadataUri, /^https:\/\/untrusted\.example\.invalid\//);
    assert.deepEqual(
      result.data,
      await inspectAgentIdentity(input, { publicClient: fixture.publicClient }),
    );
    assert.deepEqual(JSON.parse(JSON.stringify(result)).data, result.data);
  });

  it('works through actual LangChain ToolCall/ToolMessage dispatch', async () => {
    const message = await identityTool().invoke({
      type: 'tool_call',
      id: 'identity-call-1',
      name: 'inspect_agent_identity',
      args: { tokenId },
    });
    assert.ok(isToolMessage(message));
    assert.equal(message.tool_call_id, 'identity-call-1');
    const output = JSON.parse(message.content);
    assert.equal(output.ok, true);
    assert.equal(output.data.tokenId, tokenId);
    assert.equal(output.data.checks.expectedOwnerMatches, null);
  });

  it('keeps optional owner mismatch separate from intrinsic inconsistency', async () => {
    const result = await identityTool().invoke({ tokenId, expectedOwner: other });
    assert.equal(result.ok, true);
    assert.equal(result.data.checks.expectedOwnerMatches, false);
    assert.equal(result.data.consistent, true);
    fixture.state.scenario = 'mismatch';
    const mismatch = await identityTool().invoke({ tokenId });
    assert.equal(mismatch.data.checks.ownerConsistent, false);
    assert.equal(mismatch.data.consistent, false);
  });

  for (const scenario of ['expired', 'revoked']) {
    it(`does not label ${scenario} identities active or verified`, async () => {
      fixture.state.scenario = scenario;
      const result = await identityTool().invoke({ tokenId });
      assert.equal(result.ok, true);
      assert.equal(result.data.lifecycle, scenario);
      assert.equal('verified' in result.data, false);
    });
  }

  for (const [scenario, input] of [
    ['not-found', { domain: 'reader.example' }],
    ['missing-token', { tokenId }],
  ]) {
    it(`preserves authoritative ${scenario} without turning it into an RPC failure`, async () => {
      fixture.state.scenario = scenario;
      const result = await identityTool().invoke(input);
      assert.equal(result.ok, true);
      assert.equal(result.data.status, 'not_found');
      assert.equal('identity' in result.data, false);
    });
  }

  for (const [scenario, code] of [
    ['unavailable', 'UNAVAILABLE'],
    ['wrong-chain', 'WRONG_CHAIN'],
    ['changed-block', 'UNSAFE_SNAPSHOT'],
    ['unsupported-hash', 'UNAVAILABLE'],
    ['offchain', 'UNAVAILABLE'],
  ]) {
    it(`fails closed for ${scenario} without fallback, secret details or retry`, async () => {
      fixture.state.scenario = scenario;
      const result = await identityTool().invoke({ tokenId });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, code);
      assert.equal('data' in result, false);
      assert.doesNotMatch(
        JSON.stringify(result),
        /synthetic-private-provider-detail|untrusted\.example/,
      );
      if (scenario === 'unsupported-hash') {
        assert.equal(
          fixture.state.requests.filter((request) => request.method === 'eth_call').length,
          1,
        );
      }
      const count = fixture.state.requests.length;
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(fixture.state.requests.length, count);
    });
  }

  for (const input of [
    { tokenId, apiKey: 'fixture-not-a-real-secret' },
    { tokenId, privateKey: 'fixture-not-a-real-secret' },
    { tokenId, rpcUrl: 'https://untrusted.example.invalid' },
    { tokenId, chainId: 1 },
    { tokenId, registryAddress: other },
    { tokenId: 1 },
    { tokenId: '01' },
    { tokenId, expectedOwner: 'invalid' },
  ]) {
    it(`validates model input before any RPC: ${Object.keys(input).join(',')}/${typeof input.tokenId}`, async () => {
      await assert.rejects(identityTool().invoke(input), ToolInputParsingException);
      assert.equal(fixture.state.requests.length, 0);
    });
  }

  for (const input of [
    {},
    { domain: 'reader.example', tokenId },
    { domain: 'https://reader.example/path' },
    { domain: `${'a'.repeat(64)}.example` },
    { tokenId: (1n << 256n).toString() },
  ]) {
    it(`preserves SDK cross-field/range validation for ${JSON.stringify(input)}`, async () => {
      const result = await identityTool().invoke(input);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'INVALID_INPUT');
      assert.equal(fixture.state.requests.length, 0);
    });
  }
});
