import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { renewalDuration, renewalJson, renewalUsdc } from '../src/lib/renewal-observation';

test('USDC formatting retains atomic precision without unsafe Number conversion', () => {
  assert.equal(renewalUsdc('1'), '0.000001 USDC');
  assert.equal(renewalUsdc('3900000'), '3.9 USDC');
  assert.equal(renewalUsdc('9007199254740993000001'), '9007199254740993.000001 USDC');
  assert.equal(renewalUsdc('0'), '0 USDC');
});

test('duration retains exact seconds rather than rounding a partial day', () => {
  assert.equal(renewalDuration('2592000'), '30 days');
  assert.equal(renewalDuration('31536000'), '365 days');
  assert.equal(renewalDuration('86401'), '86401 seconds');
  assert.equal(renewalDuration('0'), '0 seconds');
});

test('renewal JSON retains the actual missing observation without inventing zero balances', () => {
  const result = {
    version: 1 as const,
    status: 'not_found' as const,
    chainId: 8453 as const,
    vaultAddress: '0xb7b19826a566ebd9e8b50bee986a8da04bbb2c0a' as const,
    identity: {
      version: 1 as const,
      status: 'not_found' as const,
      chainId: 8453 as const,
      registryAddress: '0x234a2B83B32910436A35CDa797CCC57988B9Bd15' as const,
      input: { tokenId: '1' },
      tokenId: '1',
      block: {
        number: '50000000',
        hash: `0x${'ab'.repeat(32)}` as const,
        timestamp: '1789280000',
        tag: 'safe' as const,
      },
    },
  };
  assert.deepEqual(JSON.parse(renewalJson(result)), result);
  assert.equal('vault' in JSON.parse(renewalJson(result)), false);
});

test('readiness exposes a single explicit read and keeps owner execution in the existing dashboard', () => {
  const source = readFileSync(
    new URL('../src/components/verify/renewal-readiness.tsx', import.meta.url),
    'utf8',
  );
  assert.equal(source.match(/await inspectAgentRenewal\(/g)?.length, 1);
  assert.doesNotMatch(
    source,
    /setInterval|localStorage|sessionStorage|useAccount|useWallet|executeAutoRenewChange|prepareAutoRenewChange|sendTransaction|signTypedData/,
  );
  assert.match(source, /href="\/dashboard"/);
  assert.match(source, /inFlight\.current/);
  assert.match(source, /sequence\.current\+\+/);
  assert.match(source, /Minimum fee \(not a quote\)/);
  assert.match(source, /Yes \(minimum only\)/);
});
