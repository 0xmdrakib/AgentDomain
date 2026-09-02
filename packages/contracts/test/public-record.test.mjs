import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('published contract metadata is reproducible and contains no backend configuration', async () => {
  const record = JSON.parse(await readFile(join(root, 'deployments', 'base-mainnet.json'), 'utf8'));
  const foundry = await readFile(join(root, 'foundry.toml'), 'utf8');
  const readme = await readFile(join(root, 'README.md'), 'utf8');

  assert.equal(record.network, 'base-mainnet');
  assert.equal(record.chainId, 8453);
  assert.equal(record.renewalVault.compiler, '0.8.34+commit.80d5c536');
  assert.deepEqual(record.renewalVault.compilerSettings, {
    optimizerEnabled: false,
    viaIR: false,
    evmVersion: 'cancun',
  });
  assert.equal('productionEnv' in record, false);

  assert.match(foundry, /^solc_version = "0\.8\.34"$/m);
  assert.match(foundry, /^optimizer = false$/m);
  assert.match(foundry, /^via_ir = false$/m);
  assert.match(foundry, /^evm_version = "cancun"$/m);
  assert.doesNotMatch(readme, /published ABI|forge test/i);

  for (const source of ['AgentIdentityRegistry.sol', 'PaymentRouter.sol', 'RenewalVault.sol']) {
    await access(join(root, 'src', source));
  }
});
