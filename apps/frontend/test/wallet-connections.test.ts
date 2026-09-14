import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfig, createConnector, http } from 'wagmi';
import { connect, getConnections } from 'wagmi/actions';
import { base } from 'wagmi/chains';
import { disconnectWalletConnections } from '../src/lib/wallet-connections';
import { clearWalletConnectionStorage } from '../src/lib/wagmi';

function fixture() {
  const calls: string[] = [];
  const failing = new Set<string>();
  const connector = (id: string) =>
    createConnector(() => ({
      id,
      name: id,
      type: 'fixture',
      connect: async () => ({ accounts: ['0x' + '1'.repeat(40)] as never, chainId: base.id }),
      disconnect: async () => {
        calls.push(id);
        if (failing.has(id)) throw new Error(`Cannot disconnect ${id}`);
      },
      getAccounts: async () => ['0x' + '1'.repeat(40)] as never,
      getChainId: async () => base.id,
      getProvider: async () => ({}),
      isAuthorized: async () => false,
      onAccountsChanged() {},
      onChainChanged() {},
      onDisconnect() {},
    }));
  const config = createConfig({
    chains: [base],
    connectors: [connector('legacy'), connector('eip6963')],
    transports: { [base.id]: http() },
    multiInjectedProviderDiscovery: false,
    storage: null,
  });
  return { config, calls, failing };
}

test('one disconnect operation clears all connector aliases, not just the current one', async () => {
  const { config, calls } = fixture();
  for (const connector of config.connectors) await connect(config, { connector });
  assert.equal(getConnections(config).length, 2);
  await disconnectWalletConnections(config);
  assert.deepEqual(calls, ['legacy', 'eip6963']);
  assert.equal(config.state.status, 'disconnected');
  assert.equal(getConnections(config).length, 0);
  await disconnectWalletConnections(config);
  assert.equal(calls.length, 2);
});

test('a failed connector does not prevent other disconnects or claim false success', async () => {
  const { config, calls, failing } = fixture();
  for (const connector of config.connectors) await connect(config, { connector });
  failing.add('legacy');
  await assert.rejects(disconnectWalletConnections(config), /Cannot disconnect legacy/);
  assert.deepEqual(calls, ['legacy', 'eip6963']);
  assert.equal(getConnections(config).length, 1);
  assert.equal(config.state.status, 'connected');
  failing.clear();
  await disconnectWalletConnections(config);
  assert.equal(getConnections(config).length, 0);
});

test('connector cleanup preserves disconnect shims and unrelated browser data', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map([
    ['wagmi.store', '{}'],
    ['wagmi.recentConnectorId', 'com.coinbase.wallet'],
    ['wagmi.com.coinbase.wallet.disconnected', 'true'],
    ['wagmi.coinbaseWalletSDK.disconnected', 'true'],
    ['wagmi.baseApp.disconnected', 'true'],
    ['wagmi.io.metamask.disconnected', 'true'],
    ['wc@2:client', '{}'],
    ['walletlink-session', '{}'],
    ['unrelated-user-preference', 'keep'],
  ]);
  const storage = {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
  };
  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: storage, sessionStorage: storage },
    });
    clearWalletConnectionStorage();
    assert.deepEqual(
      [...values.keys()],
      [
        'wagmi.com.coinbase.wallet.disconnected',
        'wagmi.coinbaseWalletSDK.disconnected',
        'wagmi.baseApp.disconnected',
        'wagmi.io.metamask.disconnected',
        'unrelated-user-preference',
      ],
    );
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: Object.defineProperty({}, 'localStorage', {
        get() {
          throw new Error('Storage denied');
        },
      }),
    });
    assert.doesNotThrow(clearWalletConnectionStorage);
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
