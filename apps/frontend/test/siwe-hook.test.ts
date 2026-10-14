import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { SiweMessage } from 'siwe';
import { getAddress } from 'viem';
import { requestSiwe } from '../src/lib/siwe-request';
import { formatWalletAuthError } from '../src/lib/wallet-auth-errors';
import type { SiweSession } from '../src/hooks/use-siwe';

const wallet = `0x${'1'.repeat(40)}`;
const other = `0x${'2'.repeat(40)}`;
type Operation = 'session' | 'nonce' | 'verify' | 'sign-out';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

// Execute the real hook, using the repository's hook-dispatcher pattern and no DOM or network.
function fixture(session: SiweSession = { authenticated: false }) {
  const require = createRequire(import.meta.url);
  const { transformSync } = createRequire(require.resolve('tsx/package.json'))('esbuild') as {
    transformSync(source: string, options: object): { code: string };
  };
  const compiled = transformSync(
    readFileSync(new URL('../src/hooks/use-siwe.ts', import.meta.url), 'utf8'),
    { loader: 'ts', format: 'cjs', target: 'es2022' },
  );
  const requests: {
    operation: Operation;
    signal: AbortSignal;
    resolve: (value: Response) => void;
  }[] = [];
  const state = {
    address: wallet as string | undefined,
    session,
    signatures: 0,
    disconnects: 0,
    clears: 0,
    updatesAfterUnmount: 0,
    manual: new Set<Operation>(),
    late: new Set<Operation>(),
    signature: deferred<string>(),
    disconnect: null as ReturnType<typeof deferred<void>> | null,
  };
  let cursor = 0;
  let disposed = false;
  const slots: unknown[] = [];
  type Effect = { deps: unknown[]; cleanup?: void | (() => void) };
  const effects = new Set<Effect>();
  const events = new EventTarget();
  const config = {};
  const fetcher: typeof fetch = async (input, init) => {
    assert.match(String(input), /^\/api\/v1\/auth\/(nonce|session|verify)$/);
    const operation = (
      init?.method === 'DELETE' ? 'sign-out' : String(input).split('/').pop()
    ) as Operation;
    const response = deferred<Response>();
    const signal = init!.signal!;
    requests.push({ operation, signal, resolve: response.resolve });
    if (!state.late.has(operation))
      signal.addEventListener('abort', () => response.reject(signal.reason), { once: true });
    if (!state.manual.has(operation)) {
      if (operation === 'nonce') response.resolve(Response.json({ nonce: 'syntheticnonce' }));
      else if (operation === 'sign-out') response.resolve(new Response(null, { status: 204 }));
      else response.resolve(Response.json(state.session));
    }
    return response.promise;
  };
  const modules: Record<string, unknown> = {
    react: {
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [
          slots[index],
          (value: unknown) => {
            if (disposed) state.updatesAfterUnmount++;
            slots[index] = typeof value === 'function' ? value(slots[index]) : value;
          },
        ];
      },
      useRef(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useCallback(callback: unknown, deps: unknown[]) {
        const index = cursor++;
        const previous = slots[index] as { callback: unknown; deps: unknown[] } | undefined;
        if (previous && deps.every((value, position) => Object.is(value, previous.deps[position])))
          return previous.callback;
        slots[index] = { callback, deps };
        return callback;
      },
      useEffect(callback: () => void | (() => void), deps: unknown[]) {
        const index = cursor++;
        const previous = slots[index] as Effect | undefined;
        if (previous && deps.every((value, position) => Object.is(value, previous.deps[position])))
          return;
        previous?.cleanup?.();
        if (previous) effects.delete(previous);
        const effect = { deps, cleanup: callback() };
        slots[index] = effect;
        effects.add(effect);
      },
    },
    wagmi: {
      useAccount: () => ({ address: state.address, isConnected: Boolean(state.address) }),
      useChainId: () => 8453,
      useConfig: () => config,
      useSignMessage: () => ({
        signMessageAsync: async () => {
          state.signatures++;
          return state.signature.promise;
        },
      }),
    },
    siwe: { SiweMessage },
    viem: { getAddress },
    '@/lib/wagmi': {
      clearWalletConnectionStorage: () => {
        state.clears++;
      },
    },
    '@/lib/wallet-connections': {
      disconnectWalletConnections: async () => {
        state.disconnects++;
        await state.disconnect?.promise;
      },
    },
    '@/lib/wallet-auth-errors': { formatWalletAuthError },
    '@/lib/siwe-request': {
      requestSiwe: (operation: Operation, init: RequestInit) =>
        operation === 'sign-out'
          ? requestSiwe(operation, init, fetcher)
          : requestSiwe(operation, init, fetcher),
    },
  };
  const compiledModule = {
    exports: {} as { useSiwe: typeof import('../src/hooks/use-siwe').useSiwe },
  };
  runInNewContext(compiled.code, {
    module: compiledModule,
    exports: compiledModule.exports,
    AbortController,
    Event,
    require(name: string) {
      assert.ok(name in modules, `Unexpected hook dependency: ${name}`);
      return modules[name];
    },
    window: {
      location: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    },
  });
  const render = () => {
    cursor = 0;
    return compiledModule.exports.useSiwe();
  };
  return {
    state,
    requests,
    render,
    refresh: () => events.dispatchEvent(new Event('agentdomain:session-changed')),
    flush: async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      return render();
    },
    unmount: () => {
      disposed = true;
      for (const effect of effects) effect.cleanup?.();
    },
  };
}

test('actual SIWE hook coalesces queued reads and restores wallet B after wallet A settles', async () => {
  const current = fixture();
  current.render();
  const signing = (await current.flush()).signIn();
  await current.flush();
  assert.equal(current.state.signatures, 1);
  current.state.address = other;
  current.state.session = { authenticated: true, address: other, chainId: 8453 };
  current.render();
  for (let i = 0; i < 3; i++) current.refresh();
  assert.equal(await current.render().signIn(), false);
  assert.equal(current.requests.filter(({ operation }) => operation === 'session').length, 1);
  current.state.signature.resolve('synthetic-signature');
  assert.equal(await signing, false);
  const restored = await current.flush();
  assert.equal(restored.session.address, other);
  assert.equal(restored.session.authenticated, true);
  assert.equal(current.requests.filter(({ operation }) => operation === 'session').length, 2);
  assert.equal(current.requests.filter(({ operation }) => operation === 'verify').length, 0);
  current.unmount();
});

test('actual SIWE hook restores the current wallet after aborting obsolete nonce HTTP', async () => {
  const current = fixture();
  current.render();
  await current.flush();
  current.state.manual.add('nonce');
  const signing = current.render().signIn();
  current.state.address = other;
  current.state.session = { authenticated: true, address: other };
  current.render();
  assert.equal(await signing, false);
  assert.equal((await current.flush()).session.address, other);
  assert.equal(current.state.signatures, 0);
  assert.equal(
    current.requests.find(({ operation }) => operation === 'nonce')!.signal.aborted,
    true,
  );
  current.unmount();
});

for (const phase of ['request', 'disconnect'] as const) {
  test(`actual SIWE hook unmount during sign-out ${phase} blocks late cleanup and queued reads`, async () => {
    const current = fixture({ authenticated: true, address: wallet });
    current.render();
    await current.flush();
    if (phase === 'request') {
      current.state.manual.add('sign-out');
      current.state.late.add('sign-out');
    } else current.state.disconnect = deferred<void>();
    const signingOut = current.render().signOut();
    await current.flush();
    current.refresh();
    const reads = current.requests.filter(({ operation }) => operation === 'session').length;
    current.unmount();
    if (phase === 'request')
      current.requests
        .find(({ operation }) => operation === 'sign-out')!
        .resolve(new Response(null, { status: 204 }));
    else current.state.disconnect!.resolve();
    await signingOut;
    assert.equal(current.state.clears, 0);
    assert.equal(current.state.disconnects, phase === 'request' ? 0 : 1);
    assert.equal(current.state.updatesAfterUnmount, 0);
    assert.equal(current.requests.filter(({ operation }) => operation === 'session').length, reads);
  });
}
