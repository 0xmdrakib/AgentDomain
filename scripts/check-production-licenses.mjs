import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export const REVIEWED_PRODUCTION_LICENSES = Object.freeze([
  '(Apache-2.0 AND MIT)',
  '(MIT AND BSD-3-Clause)',
  '(MIT OR Apache-2.0)',
  '0BSD',
  'Apache-2.0',
  'Apache-2.0 AND LGPL-3.0-or-later',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
]);

export const REVIEWED_PACKAGE_LICENSE_EXCEPTIONS = Object.freeze({
  'LGPL-3.0-or-later': Object.freeze(['@img/sharp-libvips-linux-x64']),
});

const reviewedLicenses = new Set(REVIEWED_PRODUCTION_LICENSES);
const reviewedPackageLicenses = new Map(
  Object.entries(REVIEWED_PACKAGE_LICENSE_EXCEPTIONS).map(([license, packages]) => [
    license,
    new Set(packages),
  ]),
);
const forbiddenLicensePattern =
  /unknown|see\s+licen[cs]e|non[-_ ]?commercial|(?:^|[^a-z])(?:agpl|gpl|sspl)-/i;

function allPackageNames(entries) {
  if (!Array.isArray(entries)) return [];
  return [
    ...new Set(entries.map((entry) => entry?.name).filter((name) => typeof name === 'string')),
  ].sort();
}

export function inspectProductionLicenseReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return [{ license: '<invalid report>', packages: [], reason: 'malformed license report' }];
  }

  const violations = [];
  for (const [license, entries] of Object.entries(report).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const allPackages = allPackageNames(entries);
    const packages = allPackages.slice(0, 20);
    if (forbiddenLicensePattern.test(license)) {
      violations.push({ license, packages, reason: 'forbidden or unresolved license' });
      continue;
    }
    if (!reviewedLicenses.has(license)) {
      const packageExceptions = reviewedPackageLicenses.get(license);
      const unreviewedPackages = packageExceptions
        ? allPackages.filter((packageName) => !packageExceptions.has(packageName))
        : allPackages;
      if (allPackages.length > 0 && unreviewedPackages.length === 0) {
        continue;
      }
      violations.push({
        license,
        packages: unreviewedPackages.slice(0, 20),
        reason: 'license is not in the reviewed allow-list',
      });
    }
  }
  return violations;
}

export function parseProductionLicenseReport(stdout) {
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new Error('PRODUCTION_LICENSE_REPORT_INVALID');
  }
  return report;
}

function loadProductionLicenseReport() {
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) {
    throw new Error('PRODUCTION_LICENSE_ENUMERATION_FAILED');
  }

  const result = spawnSync(process.execPath, [pnpmCli, 'licenses', 'list', '--prod', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error('PRODUCTION_LICENSE_ENUMERATION_FAILED');
  }
  return parseProductionLicenseReport(result.stdout);
}

export function runProductionLicenseCheck() {
  const violations = inspectProductionLicenseReport(loadProductionLicenseReport());
  if (violations.length === 0) {
    process.stdout.write('Production dependency licenses match the reviewed allow-list.\n');
    return;
  }

  const details = violations.map(({ license, packages, reason }) => {
    const suffix = packages.length > 0 ? `: ${packages.join(', ')}` : '';
    return `- ${license} (${reason})${suffix}`;
  });
  throw new Error(`PRODUCTION_LICENSE_POLICY_VIOLATION\n${details.join('\n')}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    runProductionLicenseCheck();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'PRODUCTION_LICENSE_CHECK_FAILED'}\n`,
    );
    process.exitCode = 1;
  }
}
