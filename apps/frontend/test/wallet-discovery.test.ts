import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareWalletProviders,
  isVisibleWalletProvider,
  readEip6963ProviderDetail,
  walletIconSource,
} from '../src/lib/wallet-discovery';

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

test('accepts Phantom-style outer whitespace without modifying image data or admitting other URLs', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(walletIconSource(`\n${png}`), png);
  assert.equal(walletIconSource(` \t${png}\r\n`), png);
  assert.equal(walletIconSource(`\n${icon}\n`), icon);
  assert.equal(walletIconSource(' \nhttps://tracker.invalid/icon.png\n'), undefined);
  assert.equal(walletIconSource(' \njavascript:alert(1)\n'), undefined);
  assert.equal(walletIconSource(`data:image/\npng;base64,eA==`), undefined);
  assert.equal(walletIconSource(`${' '.repeat(256 * 1024)}${png}`), undefined);
  const detail = readEip6963ProviderDetail({
    info: { ...info, name: 'Phantom', rdns: 'app.phantom', icon: `\n${png}` },
    provider,
  });
  assert.equal(detail?.info.icon, png);
  assert.equal(detail?.info.name, 'Phantom');
});

test('prioritizes familiar EVM wallets, retains Backpack and excludes only Keplr', () => {
  const entries = [
    ['Keplr', 'app.keplr'],
    ['Phantom', 'app.phantom'],
    ['Backpack', 'app.backpack'],
    ['Coinbase Wallet', 'com.coinbase.wallet'],
    ['Rabby Wallet', 'io.rabby'],
    ['MetaMask', 'io.metamask'],
    ['Other Wallet', 'org.other'],
  ].map(([name, rdns]) => ({ info: { ...info, name, rdns }, provider }));
  const sorted = entries.filter(isVisibleWalletProvider).sort(compareWalletProviders);
  assert.deepEqual(
    sorted.map((item) => item.info.name),
    ['MetaMask', 'Rabby Wallet', 'Coinbase Wallet', 'Phantom', 'Backpack', 'Other Wallet'],
  );
  assert.equal(sorted.length, entries.length - 1);
  assert.ok(sorted.every((item) => entries.includes(item)));
  assert.equal(isVisibleWalletProvider({ info: { ...info, rdns: 'APP.KEPLR' }, provider }), false);
});

test('accepts the installed Backpack UUIDv5 without treating metadata as authentication', () => {
  const backpack = {
    ...info,
    uuid: '4194b504-b5f1-5a4c-8732-0e1a34475ad0',
    name: 'Backpack',
    rdns: 'app.backpack',
  };
  const detail = readEip6963ProviderDetail({ info: backpack, provider });
  assert.deepEqual(detail?.info, backpack);
  assert.equal(detail?.provider, provider);
  for (const uuid of [
    '4194b504-b5f1-0a4c-8732-0e1a34475ad0',
    '4194b504-b5f1-9a4c-8732-0e1a34475ad0',
    '4194b504-b5f1-5a4c-1732-0e1a34475ad0',
  ])
    assert.equal(readEip6963ProviderDetail({ info: { ...backpack, uuid }, provider }), null);
});
