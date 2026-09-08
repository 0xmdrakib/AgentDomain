import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// An optional module path supports an operator's already-installed browser runtime.
const { chromium } = require(process.argv[2] ?? 'playwright');
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const { outputFiles } = await build({
  stdin: {
    contents: `
      import React, { StrictMode } from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { TurnstileWidget } from './src/components/turnstile-widget';

      const root = createRoot(document.getElementById('root'));
      const state = window.syntheticTurnstile = { widgets: [], removed: [], resets: [], tokens: [] };
      window.turnstile = {
        render(container, options) {
          const id = String(state.widgets.length);
          state.widgets.push(options);
          const status = document.createElement('div');
          status.dataset.syntheticWidget = id;
          container.appendChild(status);
          return id;
        },
        reset(id) { state.resets.push(id); },
        remove(id) {
          state.removed.push(id);
          document.querySelector('[data-synthetic-widget="' + id + '"]')?.remove();
          const options = state.widgets[Number(id)];
          options.callback('removed-widget-success');
          options['error-callback']();
          options['expired-callback']();
        },
      };
      window.mountWidget = ({ siteKey = 'synthetic-a', disabled = false, callback = 'first' } = {}) => {
        flushSync(() => root.render(
          <StrictMode>
            <TurnstileWidget
              siteKey={siteKey}
              disabled={disabled}
              onToken={(token) => state.tokens.push({ callback, token })}
            />
          </StrictMode>
        ));
      };
      window.unmountWidget = () => flushSync(() => root.unmount());
    `,
    loader: 'tsx',
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  define: { 'process.env.NODE_ENV': '"development"' },
});

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext();
  const network = [];
  const errors = [];
  await context.route('**/*', (route) => {
    network.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: outputFiles[0].text });
  await page.evaluate(() => window.mountWidget());
  await page.waitForFunction(() => window.syntheticTurnstile.widgets.length === 1);

  await page.evaluate(() => window.syntheticTurnstile.widgets[0]['error-callback']());
  await page.getByRole('alert').waitFor();
  await page.evaluate(() => window.syntheticTurnstile.widgets[0].callback('synthetic-valid'));
  await page.getByRole('alert').waitFor({ state: 'detached' });
  const valid = await page.evaluate(() => window.syntheticTurnstile.tokens);
  assert.equal(valid.at(-1).token, 'synthetic-valid');

  for (const disabled of [true, false, true]) {
    await page.evaluate(
      (disabled) => window.mountWidget({ disabled, callback: 'latest' }),
      disabled,
    );
  }
  assert.deepEqual(await page.evaluate(() => window.syntheticTurnstile.tokens), valid);
  assert.equal(await page.locator('[data-synthetic-widget]').count(), 1);
  assert.equal(await page.evaluate(() => window.syntheticTurnstile.widgets.length), 1);
  assert.deepEqual(await page.evaluate(() => window.syntheticTurnstile.removed), []);
  assert.deepEqual(await page.evaluate(() => window.syntheticTurnstile.resets), []);

  await page.evaluate(() => window.syntheticTurnstile.widgets[0].callback('synthetic-fresh'));
  assert.deepEqual(await page.evaluate(() => window.syntheticTurnstile.tokens.at(-1)), {
    callback: 'latest',
    token: 'synthetic-fresh',
  });
  await page.evaluate(() => window.syntheticTurnstile.widgets[0]['expired-callback']());
  assert.deepEqual(await page.evaluate(() => window.syntheticTurnstile.tokens.at(-1)), {
    callback: 'latest',
    token: null,
  });
  await page.evaluate(() => window.syntheticTurnstile.widgets[0].callback('before-key-change'));

  await page.evaluate(() =>
    window.mountWidget({ siteKey: 'synthetic-b', callback: 'replacement' }),
  );
  await page.waitForFunction(() => window.syntheticTurnstile.widgets.length === 2);
  assert.deepEqual(await page.evaluate(() => window.syntheticTurnstile.tokens.at(-1)), {
    callback: 'replacement',
    token: null,
  });
  assert.deepEqual(await page.evaluate(() => window.syntheticTurnstile.removed), ['0']);
  await page.evaluate(() => window.syntheticTurnstile.widgets[1].callback('replacement-valid'));
  const replacement = await page.evaluate(() => window.syntheticTurnstile.tokens);
  await page.evaluate(() => {
    const stale = window.syntheticTurnstile.widgets[0];
    stale.callback('stale-success');
    stale['error-callback']();
    stale['expired-callback']();
  });
  assert.deepEqual(await page.evaluate(() => window.syntheticTurnstile.tokens), replacement);
  assert.equal(await page.getByRole('alert').count(), 0);

  await page.evaluate(() => window.unmountWidget());
  await page.evaluate(() => {
    const stale = window.syntheticTurnstile.widgets[1];
    stale.callback('after-unmount');
    stale['error-callback']();
    stale['expired-callback']();
  });
  assert.deepEqual(await page.evaluate(() => window.syntheticTurnstile.tokens), replacement);
  assert.deepEqual(await page.evaluate(() => window.syntheticTurnstile.removed), ['0', '1']);
  assert.deepEqual(await page.evaluate(() => window.syntheticTurnstile.resets), []);
  assert.deepEqual(network, [], 'the synthetic provider must not request a live captcha');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: StrictMode, error recovery, callback refs, disabled transitions, key changes, unmount',
  );
} finally {
  await browser.close();
}
