import assert from 'node:assert/strict';
import test from 'node:test';
import { readEip6963ProviderDetail, walletIconSource } from '../src/lib/wallet-discovery';

const provider = { request: async () => [] };
const icon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
const info = {
  uuid: '350670db-19fa-4704-a166-e52e178b59d2',
  name: 'Coinbase Wallet',
  rdns: 'com.coinbase.wallet',
  icon,
};

test('discovered names and icons remain provider-supplied, without branding overrides', () => {
  const detail = readEip6963ProviderDetail({ info, provider });
  assert.deepEqual(detail?.info, info);
  assert.equal(detail?.provider, provider);
  for (const name of ['Coinbase Wallet', 'MetaMask', 'Rabby Wallet', 'Coinbase Test Wallet']) {
    const result = readEip6963ProviderDetail({ info: { ...info, name }, provider });
    assert.equal(result?.info.name, name);
    assert.equal(result?.info.icon, icon);
  }
});

test('wallet icon input is restricted to data images without changing their bytes', () => {
  for (const source of [
    icon,
    'data:image/svg+xml;charset=utf-8,%3Csvg/%3E',
    'data:image/png;base64,eA==',
    'data:image/webp;base64,eA==',
    'data:image/jpeg;base64,eA==',
    'data:image/gif;base64,eA==',
  ])
    assert.equal(walletIconSource(source), source);
  for (const source of [
    undefined,
    null,
    {},
    'javascript:alert(1)',
    'https://tracker.invalid/wallet.png',
    '//tracker.invalid/wallet.png',
    'blob:https://tracker.invalid/icon',
    'data:text/html,<svg onload="alert(1)">',
    'data:image/svg+xml',
    'data:image/svg+xml,',
    'data:image/svg+xml;url=https://tracker.invalid,x',
    `data:image/svg+xml,${'x'.repeat(256 * 1024)}`,
  ])
    assert.equal(walletIconSource(source), undefined);
  const result = readEip6963ProviderDetail({
    info: { ...info, icon: 'https://tracker.invalid/icon.png' },
    provider,
  });
  assert.equal(result?.info.name, 'Coinbase Wallet');
  assert.equal(result?.info.icon, undefined);
});

test('malformed provider announcements are ignored without crashing the wallet picker', () => {
  for (const detail of [
    null,
    {},
    { info },
    { info, provider: {} },
    { info: { ...info, uuid: 'not-a-session-uuid' }, provider },
    { info: { ...info, name: {} }, provider },
    { info: { ...info, name: ' ' }, provider },
    { info: { ...info, name: 'x'.repeat(129) }, provider },
    { info: { ...info, name: 'Wallet\nInjected' }, provider },
    { info: { ...info, rdns: 'bad/identifier' }, provider },
    { info: { ...info, rdns: 'bad..identifier' }, provider },
    { info: { ...info, rdns: `${'x'.repeat(64)}.wallet` }, provider },
    { info: { ...info, rdns: Array(6).fill('x'.repeat(50)).join('.') }, provider },
    Object.defineProperty({}, 'info', {
      get: () => {
        throw new Error('untrusted getter');
      },
    }),
  ])
    assert.equal(readEip6963ProviderDetail(detail), null);
});

test('markup-like names remain plain display data, not HTML or trusted wallet identities', () => {
  const name = '<img src=x onerror=alert(1)>';
  const detail = readEip6963ProviderDetail({ info: { ...info, name }, provider });
  assert.equal(detail?.info.name, name);
  assert.equal(detail?.provider, provider);
});
