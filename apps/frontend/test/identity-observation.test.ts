import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  baseScanLink,
  inspectionFailure,
  observationJson,
  observationSummary,
  observationTime,
  type IdentityObservation,
} from '../src/lib/identity-observation';

const address = '0x234a2B83B32910436A35CDa797CCC57988B9Bd15';
const owner = `0x${'1'.repeat(40)}` as const;
const found: Extract<IdentityObservation, { status: 'found' }> = {
  version: 1,
  status: 'found',
  chainId: 8453,
  registryAddress: address,
  input: { domain: 'fixture.example' },
  block: {
    number: '9007199254740993',
    hash: `0x${'a'.repeat(64)}`,
    timestamp: '1789280000',
    tag: 'safe',
  },
  tokenId: '9007199254740993',
  identity: {
    owner,
    domain: 'fixture.example',
    basename: 'fixture.base.eth',
    ensName: '',
    metadataUri: 'https://untrusted.invalid/metadata',
    createdAt: '1789000000',
    expiresAt: '1800000000',
    revoked: false,
  },
  nftOwner: owner,
  metadataUri: 'https://untrusted.invalid/metadata',
  lifecycle: 'active',
  checks: {
    ownerConsistent: true,
    domainConsistent: true,
    metadataConsistent: true,
    lifecycleConsistent: true,
    expectedOwnerMatches: null,
  },
  consistent: true,
};

test('summary reports only SDK consistency; optional owner mismatch is distinct', () => {
  assert.deepEqual(observationSummary(found), { label: 'Records consistent', tone: 'success' });
  for (const check of [
    'ownerConsistent',
    'domainConsistent',
    'metadataConsistent',
    'lifecycleConsistent',
  ] as const)
    assert.equal(
      observationSummary({ ...found, checks: { ...found.checks, [check]: false } }).tone,
      'danger',
    );
  assert.equal(observationSummary({ ...found, consistent: false }).label, 'Records differ');
  assert.equal(
    observationSummary({ ...found, checks: { ...found.checks, expectedOwnerMatches: false } })
      .label,
    'Expected wallet differs',
  );
});

test('expired, revoked and not-found do not receive a successful verdict', () => {
  assert.equal(observationSummary({ ...found, lifecycle: 'expired' }).tone, 'warning');
  assert.equal(observationSummary({ ...found, lifecycle: 'revoked' }).tone, 'danger');
  assert.deepEqual(
    observationSummary({
      version: 1,
      status: 'not_found',
      chainId: 8453,
      registryAddress: address,
      input: { tokenId: '3' },
      block: found.block,
      tokenId: '3',
    }),
    { label: 'Identity not found', tone: 'neutral' },
  );
});

test('export preserves exact SDK result, large integers and untrusted URI text', () => {
  const json = observationJson(found);
  assert.deepEqual(JSON.parse(json), found);
  assert.equal(JSON.parse(json).tokenId, '9007199254740993');
  assert.equal(JSON.parse(json).block.number, '9007199254740993');
  assert.equal(JSON.parse(json).identity.metadataUri, 'https://untrusted.invalid/metadata');
});

test('explorer links stay on fixed BaseScan with exact typed paths', () => {
  assert.equal(
    baseScanLink('token', address, found.tokenId),
    `https://basescan.org/token/${address}?a=${found.tokenId}`,
  );
  assert.equal(baseScanLink('address', owner), `https://basescan.org/address/${owner}`);
  assert.equal(
    baseScanLink('block', found.block.hash),
    `https://basescan.org/block/${found.block.hash}`,
  );
  for (const value of [
    'https://untrusted.invalid',
    '//other.invalid',
    `${address}/../settings`,
    'javascript:alert(1)',
  ])
    assert.equal(baseScanLink('address', value), null);
  for (const token of ['1&next=evil', '-1', 'NaN', '1/2'])
    assert.equal(baseScanLink('token', address, token), null);
  assert.equal(baseScanLink('block', '123'), null);
});

test('time formatting is UTC and handles out-of-range contract timestamps', () => {
  assert.equal(observationTime('0'), '1970-01-01 00:00:00 UTC');
  assert.equal(observationTime('18446744073709551615'), '18446744073709551615 seconds (Unix)');
  assert.equal(observationTime('unavailable'), 'unavailable');
});

test('error messages distinguish input, network and snapshot failure without reflecting provider data', () => {
  assert.match(inspectionFailure({ code: 'INVALID_INPUT' }), /Check the domain/);
  assert.match(inspectionFailure({ code: 'WRONG_CHAIN' }), /another network/);
  assert.match(inspectionFailure({ code: 'UNSAFE_SNAPSHOT' }), /safe block/);
  for (const failure of [
    new Error('https://secret:password@rpc.invalid'),
    { code: 'UNAVAILABLE', message: 'secret' },
    null,
  ]) {
    assert.match(inspectionFailure(failure), /RPC check failed/);
    assert.doesNotMatch(inspectionFailure(failure), /secret|password|not found/i);
  }
});

test('public and connected navigation expose the tool without adding wallet code to it', () => {
  const read = (path: string) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
  assert.match(read('components/landing/public-nav.tsx'), /href: '\/verify'/);
  assert.match(read('components/landing/nav.tsx'), /href="\/verify"/);
  assert.match(read('lib/seo.ts'), /'\/verify'/);
  const component = read('components/verify/identity-verifier.tsx');
  assert.match(component, /await inspectAgentIdentity\(input\)/);
  assert.doesNotMatch(
    component,
    /\bfetch\s*\(|setInterval|walletClient|writeContract|signTypedData|localStorage|sessionStorage/,
  );
  assert.doesNotMatch(component, /href=\{result\.(?:identity\.)?(?:metadataUri|basename|ensName)/);
});
