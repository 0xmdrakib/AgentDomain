import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountTurnstile, type TurnstileProvider } from '../src/components/turnstile-lifecycle';

type WidgetOptions = Parameters<TurnstileProvider['render']>[1];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture() {
  const widgets: WidgetOptions[] = [];
  const removed: string[] = [];
  const tokens: Array<string | null> = [];
  const errors: Array<string | null> = [];
  const provider: TurnstileProvider = {
    render(_container, options) {
      widgets.push(options);
      return String(widgets.length - 1);
    },
    remove(id) {
      assert.notEqual(id, undefined, 'only the owned widget can be removed');
      removed.push(id!);
      // The synthetic provider deliberately delivers callbacks during removal.
      const options = widgets[Number(id)];
      options.callback?.('removed-widget-token');
      options['expired-callback']?.();
      options['error-callback']?.();
    },
    reset() {
      assert.fail('checkout activity must not reset Turnstile');
    },
  };
  const options = {
    container: {} as HTMLElement,
    siteKey: 'synthetic-site-a',
    loadProvider: async () => provider,
    onToken: (token: string | null) => tokens.push(token),
    onError: (error: string | null) => errors.push(error),
  };
  return { widgets, removed, tokens, errors, provider, options };
}

test('success clears a previous widget error before forwarding the token', async () => {
  const f = fixture();
  const dispose = mountTurnstile(f.options);
  await settle();
  const widget = f.widgets[0];
  assert.equal(widget.sitekey, 'synthetic-site-a');
  assert.equal(widget.theme, 'dark');
  widget['error-callback']?.();
  assert.match(f.errors.at(-1)!, /Spam check failed/);
  assert.equal(f.tokens.at(-1), null);
  widget.callback?.('synthetic-success');
  assert.equal(f.errors.at(-1), null);
  assert.equal(f.tokens.at(-1), 'synthetic-success');
  widget['expired-callback']?.();
  assert.equal(f.tokens.at(-1), null, 'real expiration must still invalidate the token');
  widget.callback?.('synthetic-renewed');
  widget['error-callback']?.();
  assert.equal(f.tokens.at(-1), null, 'an active provider error must still invalidate the token');
  dispose();
});

test('removed widget callbacks cannot invalidate or replace the current site key token', async () => {
  const f = fixture();
  const oldDispose = mountTurnstile(f.options);
  await settle();
  f.widgets[0].callback?.('old-token');
  oldDispose();
  const dispose = mountTurnstile({ ...f.options, siteKey: 'synthetic-site-b' });
  assert.equal(f.tokens.at(-1), null, 'a new site key starts without the old token');
  assert.equal(f.errors.at(-1), null);
  await settle();
  assert.equal(f.widgets[1].sitekey, 'synthetic-site-b');
  f.widgets[1].callback?.('new-token');
  const before = { tokens: [...f.tokens], errors: [...f.errors] };
  f.widgets[0].callback?.('late-old-success');
  f.widgets[0]['error-callback']?.();
  f.widgets[0]['expired-callback']?.();
  oldDispose();
  assert.deepEqual(f.tokens, before.tokens);
  assert.deepEqual(f.errors, before.errors);
  assert.deepEqual(f.removed, ['0']);
  dispose();
  assert.deepEqual(f.removed, ['0', '1']);
  assert.deepEqual(f.tokens, before.tokens, 'unmount must not notify or reset a validated pass');
  assert.deepEqual(f.errors, before.errors);
});

test('unmount before script resolution prevents rendering', async () => {
  const f = fixture();
  const pending = deferred<TurnstileProvider>();
  const dispose = mountTurnstile({ ...f.options, loadProvider: () => pending.promise });
  dispose();
  pending.resolve(f.provider);
  await settle();
  assert.deepEqual(f.widgets, []);
  assert.deepEqual(f.removed, []);
  assert.deepEqual(f.tokens, [null]);
  assert.deepEqual(f.errors, [null]);
});

test('a stale script rejection cannot overwrite the replacement widget success', async () => {
  const f = fixture();
  const pending = deferred<TurnstileProvider>();
  const oldDispose = mountTurnstile({ ...f.options, loadProvider: () => pending.promise });
  oldDispose();
  const dispose = mountTurnstile({ ...f.options, siteKey: 'synthetic-site-b' });
  await settle();
  f.widgets[0].callback?.('replacement-token');
  const before = { tokens: [...f.tokens], errors: [...f.errors] };
  pending.reject(new Error('obsolete script failure'));
  await settle();
  assert.deepEqual(f.tokens, before.tokens);
  assert.deepEqual(f.errors, before.errors);
  dispose();
});

test('strict-mode setup, cleanup, setup renders only the active instance of a shared load', async () => {
  const f = fixture();
  const pending = deferred<TurnstileProvider>();
  const options = { ...f.options, loadProvider: () => pending.promise };
  mountTurnstile(options)();
  const dispose = mountTurnstile(options);
  pending.resolve(f.provider);
  await settle();
  assert.equal(f.widgets.length, 1);
  dispose();
  dispose();
  assert.deepEqual(f.removed, ['0']);
});

test('active script failures remain visible and fail closed', async () => {
  const f = fixture();
  const dispose = mountTurnstile({
    ...f.options,
    loadProvider: async () => {
      throw new Error('synthetic load failure');
    },
  });
  await settle();
  assert.deepEqual(f.widgets, []);
  assert.equal(f.errors.at(-1), 'synthetic load failure');
  assert.equal(f.tokens.at(-1), null);
  dispose();
});

test('render failures reject later callbacks from the failed instance', async () => {
  const f = fixture();
  const render = f.provider.render;
  f.provider.render = (container, options) => {
    render(container, options);
    throw new Error('synthetic render failure');
  };
  const dispose = mountTurnstile(f.options);
  await settle();
  const before = { tokens: [...f.tokens], errors: [...f.errors] };
  assert.equal(f.errors.at(-1), 'synthetic render failure');
  f.widgets[0].callback?.('failed-widget-token');
  f.widgets[0]['expired-callback']?.();
  f.widgets[0]['error-callback']?.();
  assert.deepEqual(f.tokens, before.tokens);
  assert.deepEqual(f.errors, before.errors);
  dispose();
});

test('synchronous success that unmounts during render still removes the exact widget', async () => {
  const f = fixture();
  const render = f.provider.render;
  f.provider.render = (container, options) => {
    const id = render(container, options);
    options.callback?.('synchronous-token');
    return id;
  };
  const dispose = mountTurnstile({
    ...f.options,
    onToken(token) {
      f.tokens.push(token);
      if (token) dispose();
    },
  });
  await settle();
  assert.deepEqual(f.tokens, [null, 'synchronous-token']);
  assert.deepEqual(f.removed, ['0']);
});
