import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  REVIEWED_PACKAGE_LICENSE_EXCEPTIONS,
  REVIEWED_PRODUCTION_LICENSES,
  inspectProductionLicenseReport,
  parseProductionLicenseReport,
} from './check-production-licenses.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

test('accepts every explicitly reviewed production license expression', () => {
  const report = Object.fromEntries(
    REVIEWED_PRODUCTION_LICENSES.map((license) => [license, [{ name: `package-${license}` }]]),
  );
  assert.deepEqual(inspectProductionLicenseReport(report), []);
});

test('rejects unresolved, non-commercial and strong-copyleft licenses', () => {
  for (const license of [
    'Unknown',
    'SEE LICENSE IN LICENSE.md',
    'LicenseRef-NonCommercial-1.0',
    'GPL-3.0-only',
    'AGPL-3.0-or-later',
    'SSPL-1.0',
  ]) {
    const violations = inspectProductionLicenseReport({ [license]: [{ name: 'blocked-package' }] });
    assert.equal(violations.length, 1, license);
    assert.equal(violations[0].reason, 'forbidden or unresolved license');
  }
});

test('rejects a valid but unreviewed SPDX license', () => {
  const violations = inspectProductionLicenseReport({ 'WTFPL-2.0': [{ name: 'surprise' }] });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].reason, 'license is not in the reviewed allow-list');
});

test('allows LGPL only for the reviewed Linux sharp runtime package', () => {
  const [sharpPackage] = REVIEWED_PACKAGE_LICENSE_EXCEPTIONS['LGPL-3.0-or-later'];
  assert.deepEqual(
    inspectProductionLicenseReport({
      'LGPL-3.0-or-later': [{ name: sharpPackage }],
    }),
    [],
  );

  const violations = inspectProductionLicenseReport({
    'LGPL-3.0-or-later': [{ name: sharpPackage }, { name: 'unreviewed-lgpl-package' }],
  });
  assert.deepEqual(violations, [
    {
      license: 'LGPL-3.0-or-later',
      packages: ['unreviewed-lgpl-package'],
      reason: 'license is not in the reviewed allow-list',
    },
  ]);
});

test('rejects malformed license command output', () => {
  assert.throws(() => parseProductionLicenseReport('not-json'), {
    message: 'PRODUCTION_LICENSE_REPORT_INVALID',
  });
  assert.deepEqual(inspectProductionLicenseReport(null), [
    { license: '<invalid report>', packages: [], reason: 'malformed license report' },
  ]);
});

test('repository pins reviewed production dependencies and excludes unsafe graphs', async () => {
  const [
    rootPackageText,
    frontendPackageText,
    lockfile,
    wagmiSource,
    walletButtonSource,
    workflow,
  ] = await Promise.all([
    readFile(path.join(repoRoot, 'package.json'), 'utf8'),
    readFile(path.join(repoRoot, 'apps/frontend/package.json'), 'utf8'),
    readFile(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8'),
    readFile(path.join(repoRoot, 'apps/frontend/src/lib/wagmi.ts'), 'utf8'),
    readFile(
      path.join(repoRoot, 'apps/frontend/src/components/wallet/connect-wallet-button.tsx'),
      'utf8',
    ),
    readFile(path.join(repoRoot, '.github/workflows/dependency-review.yml'), 'utf8'),
  ]);
  const rootPackage = JSON.parse(rootPackageText);
  const frontendPackage = JSON.parse(frontendPackageText);

  assert.equal(rootPackage.pnpm.overrides['qs@<6.16.0'], '6.16.0');
  assert.match(lockfile, /qs@6\.16\.0:/);
  assert.doesNotMatch(lockfile, /qs@6\.15\.3:/);
  assert.equal(frontendPackage.dependencies.wagmi, '3.7.7');
  assert.equal(frontendPackage.dependencies['@coinbase/wallet-sdk'], '4.3.7');
  assert.equal(frontendPackage.dependencies['@walletconnect/ethereum-provider'], '2.21.8');
  assert.doesNotMatch(lockfile, /@metamask\/sdk/i);
  assert.doesNotMatch(`${wagmiSource}\n${walletButtonSource}`, /from ['"]wagmi\/connectors['"]/);
  assert.match(wagmiSource, /wagmi\/connectors\/coinbaseWallet/);
  assert.match(wagmiSource, /wagmi\/connectors\/walletConnect/);
  assert.match(`${wagmiSource}\n${walletButtonSource}`, /wagmi\/connectors\/injected/);
  assert.match(workflow, /allow-licenses:/);
  assert.doesNotMatch(workflow, /deny-licenses:/);
});
