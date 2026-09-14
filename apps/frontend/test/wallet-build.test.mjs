import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertWalletBackdropCss } from '../scripts/check-build.mjs';

test('compiled wallet CSS must retain standard backdrop blur', () => {
  assert.doesNotThrow(() =>
    assertWalletBackdropCss([
      '.agentdomain-wallet-backdrop{-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}',
    ]),
  );
  assert.doesNotThrow(() =>
    assertWalletBackdropCss(['.agentdomain-wallet-backdrop{backdrop-filter:blur(12px)}']),
  );
  for (const css of [
    '',
    '.agentdomain-wallet-backdrop{-webkit-backdrop-filter:blur(12px)}',
    '.other{backdrop-filter:blur(12px)}',
    '.agentdomain-wallet-backdrop{backdrop-filter:none}',
  ]) {
    assert.throws(() => assertWalletBackdropCss([css]), /lost standard blur/);
  }
});
