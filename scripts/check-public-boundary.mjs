#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

const allowedRootFiles = new Set([
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  '.prettierignore',
  '.prettierrc',
  '.prettierrc.json',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'NOTICE',
  'README.md',
  'SECURITY.md',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'turbo.json',
]);
const allowedApplicationRoots = new Set(['docs', 'frontend', 'mcp-server']);
const allowedPackageRoots = new Set([
  'agentkit-plugin',
  'contracts',
  'eliza-plugin',
  'sdk',
  'shared',
]);

const forbiddenPathRules = [
  [/^apps\/web(?:\/|$)/i, 'private web application path'],
  [/^services(?:\/|$)/i, 'private services path'],
  [/^infrastructure(?:\/|$)/i, 'private infrastructure path'],
  [/^project-planning(?:\/|$)/i, 'private planning path'],
  [/^apps\/frontend\/src\/app\/admin(?:\/|$)/i, 'private admin application path'],
  [/^apps\/frontend\/src\/components\/admin(?:\/|$)/i, 'private admin component path'],
  [
    /^apps\/docs\/(?:src\/content\/docs\/)?(?:[^/]+\/)*(?:aws-migration|ses-inbound|dynamodb-migration|qstash-operations|private-runbook)\.(?:md|mdx)$/i,
    'private operational documentation',
  ],
  [
    /(?:^|\/)(?:node_modules|dist|build|out|\.next|\.open-next|\.astro|\.qa|\.turbo|\.wrangler|coverage)(?:\/|$)/i,
    'generated or local build output',
  ],
  [/(?:^|\/)\.codex(?:\/|$)/i, 'local Codex state'],
  [/(?:^|\/)[^/]+\.(?:bak|orig|tmp)$/i, 'temporary file'],
  [/(?:^|\/)[^/]+~$/i, 'temporary editor file'],
  [/(?:^|\/)\.vercel(?:\/|$)/i, 'Vercel local state'],
  [/(?:^|\/)(?:vercel\.json|\.vercelignore)$/i, 'Vercel configuration'],
  [/(?:^|\/)\.dev\.vars(?:\..+)?$/i, 'Cloudflare environment file'],
  [/(?:^|\/)(?:[^/]+\.env(?:\..+)?|\.env(?:\..+)?)$/i, 'environment file'],
  [
    /(?:^|\/)(?:id_rsa|id_ed25519|[^/]*(?:credentials?|service-account)[^/]*\.(?:json|ya?ml))$/i,
    'credential file',
  ],
  [/(?:^|\/)secrets?\.json$/i, 'secret file'],
  [/(?:^|\/)[^/]+\.(?:key|p12|pfx|jks)$/i, 'private-key container'],
];

const allowedEnvironmentTemplates = [/(?:^|\/)frontend\.env\.example$/i];

const forbiddenSecretPatterns = [
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, 'private key material'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, 'AWS access key ID'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bgithub_pat_[0-9A-Za-z_]{20,}\b/, 'GitHub fine-grained token'],
  [/\bgh[pousr]_[0-9A-Za-z]{20,}\b/, 'GitHub token'],
  [/\bnpm_[0-9A-Za-z]{30,}\b/, 'npm token'],
  [/\bxox[baprs]-[0-9A-Za-z-]{20,}\b/, 'Slack token'],
  [/\bsk_live_[0-9A-Za-z]{16,}\b/, 'live payment secret'],
  [/\bsk-ant-[0-9A-Za-z_-]{20,}\b/, 'Anthropic API key'],
  [
    /["']type["']\s*:\s*["']service_account["'][\s\S]{0,2000}["']private_key["']\s*:/,
    'Google service-account credential',
  ],
  [
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:/]+:[^\s/@]+@/i,
    'database URL with embedded password',
  ],
];

const forbiddenImportRules = [
  [/^@aws-sdk\//, 'AWS SDK'],
  [/^aws-sdk$/, 'AWS SDK'],
  [/^@google-cloud\//, 'Google Cloud SDK'],
  [/^@upstash\//, 'Upstash provider SDK'],
  [/^@neondatabase\//, 'database provider SDK'],
  [
    /^(?:drizzle-orm|ioredis|pg|postgres|mysql2|firebase-admin|@prisma\/client)(?:\/|$)/,
    'backend database or storage package',
  ],
  [
    /^@agentdomain\/(?!(?:sdk|shared|mcp-server|agentkit-plugin|eliza-plugin|contracts|brand-assets)(?:\/|$))/,
    'non-public AgentDomain package',
  ],
  [/(?:^|\/)apps\/web(?:\/|$)/, 'private web source'],
  [/(?:^|\/)(?:db|database|services|storage)(?:\/|$)/, 'private backend source area'],
];

function normalizePath(path) {
  return path.split(sep).join('/').replace(/^\.\//, '');
}

function repositoryScopeViolation(path) {
  const [topLevel, child] = path.split('/');
  if (!child) return allowedRootFiles.has(topLevel) ? null : 'unapproved root file';
  if (topLevel === '.github' || topLevel === 'scripts') return null;
  if (topLevel === 'apps') {
    return allowedApplicationRoots.has(child) ? null : 'unapproved public application root';
  }
  if (topLevel === 'packages') {
    return allowedPackageRoots.has(child) ? null : 'unapproved public package root';
  }
  return 'unapproved top-level directory';
}

function listRepositoryFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return output.split('\0').filter(Boolean).map(normalizePath).sort();
}

function isAllowedEnvironmentTemplate(path) {
  return allowedEnvironmentTemplates.some((pattern) => pattern.test(path));
}

function pathViolation(path) {
  for (const [pattern, description] of forbiddenPathRules) {
    if (pattern.test(path) && !isAllowedEnvironmentTemplate(path)) return description;
  }
  return null;
}

function extractImports(text) {
  const imports = [];
  const staticImport =
    /^\s*(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/gm;
  for (const match of text.matchAll(staticImport)) imports.push(match[1]);

  const functionImport = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of text.matchAll(functionImport)) {
    if (!isCodeOffset(text, match.index)) continue;
    imports.push(match[1]);
  }
  return imports;
}

function isCodeOffset(text, offset) {
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < offset; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') quote = character;
  }

  return !quote && !lineComment && !blockComment;
}

function importViolation(specifier) {
  return forbiddenImportRules.find(([pattern]) => pattern.test(specifier))?.[1] ?? null;
}

function actionReferenceViolation(reference) {
  if (reference.startsWith('./')) return null;
  if (reference.startsWith('docker://')) {
    return /@sha256:[0-9a-f]{64}$/i.test(reference)
      ? null
      : 'container action must use an immutable sha256 digest';
  }
  return /@[0-9a-f]{40}$/i.test(reference)
    ? null
    : 'GitHub Action must use an immutable 40-character commit SHA';
}

function checkWorkflowActionPins(path, text, errors) {
  if (!/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path)) return;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*(?:-\s*)?uses:\s*["']?([^\s"'#]+)["']?/);
    if (!match) continue;
    const violation = actionReferenceViolation(match[1]);
    if (violation) errors.push(`${path}:${index + 1}: ${violation}`);
  }
}

function isText(buffer) {
  return !buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

function checkEnvironmentTemplate(path, text, errors) {
  if (!isAllowedEnvironmentTemplate(path)) return;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[1].trim();
    if (value !== '' && value !== '""' && value !== "''") {
      errors.push(`${path}:${index + 1}: environment template values must be empty`);
    }
  }
}

function checkPackageManifest(path, text, errors) {
  if (path !== 'package.json' && !/^(?:apps|packages)\/[^/]+\/package\.json$/.test(path)) return;
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    errors.push(`${path}: package manifest is not valid JSON`);
    return;
  }

  if (manifest.license && manifest.license !== 'Apache-2.0') {
    errors.push(`${path}: explicit license must be Apache-2.0`);
  }
  if (manifest.private !== true && manifest.license !== 'Apache-2.0') {
    errors.push(`${path}: publishable package must declare Apache-2.0`);
  }

  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const dependency of Object.keys(manifest[field] ?? {})) {
      const forbiddenDependency = importViolation(dependency);
      if (forbiddenDependency) {
        errors.push(`${path}: forbidden ${forbiddenDependency} dependency "${dependency}"`);
      }
    }
  }
}

function checkRepository() {
  const errors = [];
  const files = listRepositoryFiles();

  for (const path of files) {
    const absolute = resolve(root, path);
    const insideRoot = relative(root, absolute);
    if (insideRoot.startsWith(`..${sep}`) || insideRoot === '..') {
      errors.push(`${path}: resolves outside repository root`);
      continue;
    }
    if (!existsSync(absolute)) continue;
    if (lstatSync(absolute).isSymbolicLink()) {
      errors.push(`${path}: symbolic links are not allowed in the public repository`);
      continue;
    }
    if (!statSync(absolute).isFile()) continue;

    const repositoryScope = repositoryScopeViolation(path);
    if (repositoryScope) errors.push(`${path}: ${repositoryScope}`);

    const forbiddenPath = pathViolation(path);
    if (forbiddenPath) errors.push(`${path}: forbidden ${forbiddenPath}`);

    const buffer = readFileSync(absolute);
    if (!isText(buffer)) continue;
    const text = buffer.toString('utf8');

    const privateRepositoryName = ['agentdomain', 'platform'].join('-');
    if (text.toLowerCase().includes(privateRepositoryName)) {
      errors.push(`${path}: private repository name is forbidden`);
    }
    for (const [pattern, description] of forbiddenSecretPatterns) {
      if (pattern.test(text)) errors.push(`${path}: detected ${description}`);
    }
    for (const specifier of extractImports(text)) {
      const forbiddenImport = importViolation(specifier);
      if (forbiddenImport) {
        errors.push(`${path}: forbidden ${forbiddenImport} import "${specifier}"`);
      }
    }

    checkEnvironmentTemplate(path, text, errors);
    checkPackageManifest(path, text, errors);
    checkWorkflowActionPins(path, text, errors);
  }

  const licensePath = resolve(root, 'LICENSE');
  const noticePath = resolve(root, 'NOTICE');
  if (
    !existsSync(licensePath) ||
    !/Apache License\s+Version 2\.0/.test(readFileSync(licensePath, 'utf8'))
  ) {
    errors.push('LICENSE: root Apache License 2.0 text is required');
  }
  if (!existsSync(noticePath) || readFileSync(noticePath, 'utf8').trim() === '') {
    errors.push('NOTICE: non-empty root notice is required');
  }

  if (errors.length > 0) {
    console.error('Public boundary check failed:');
    for (const error of [...new Set(errors)].sort()) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Public boundary check passed (${files.length} files inspected).`);
}

function runSelfTest() {
  assert.equal(repositoryScopeViolation('README.md'), null);
  assert.equal(repositoryScopeViolation('apps/frontend/src/app/page.tsx'), null);
  assert.equal(
    repositoryScopeViolation('apps/backend/src/index.ts'),
    'unapproved public application root',
  );
  assert.equal(repositoryScopeViolation('private-notes.md'), 'unapproved root file');
  assert.equal(pathViolation('apps/web/src/index.ts'), 'private web application path');
  assert.equal(pathViolation('services/worker.ts'), 'private services path');
  assert.equal(pathViolation('apps/frontend/vercel.json'), 'Vercel configuration');
  assert.equal(
    pathViolation('apps/docs/guides/aws-migration.mdx'),
    'private operational documentation',
  );
  assert.equal(pathViolation('frontend.env'), 'environment file');
  assert.equal(pathViolation('frontend.env.example'), null);
  assert.equal(pathViolation('backend.env.example'), 'environment file');
  assert.equal(importViolation('@agentdomain/sdk'), null);
  assert.equal(importViolation('@agentdomain/storage'), 'non-public AgentDomain package');
  assert.equal(importViolation('@aws-sdk/client-s3'), 'AWS SDK');
  assert.equal(importViolation('../storage/private-client'), 'private backend source area');
  assert.equal(actionReferenceViolation('./.github/actions/local'), null);
  assert.equal(actionReferenceViolation(`actions/checkout@${'a'.repeat(40)}`), null);
  assert.equal(
    actionReferenceViolation('actions/checkout@v7'),
    'GitHub Action must use an immutable 40-character commit SHA',
  );
  assert.equal(
    actionReferenceViolation('docker://alpine:3.22'),
    'container action must use an immutable sha256 digest',
  );
  const packageErrors = [];
  checkPackageManifest(
    'package.json',
    JSON.stringify({ private: true, license: 'Apache-2.0', dependencies: { pg: '1.0.0' } }),
    packageErrors,
  );
  assert.deepEqual(packageErrors, [
    'package.json: forbidden backend database or storage package dependency "pg"',
  ]);
  assert.deepEqual(
    extractImports("import { x } from '@agentdomain/sdk';\nconst y = import('pg');"),
    ['@agentdomain/sdk', 'pg'],
  );
  assert.deepEqual(extractImports('const fixture = "import(\'pg\')";'), []);
  assert.match(['AKIA', '1234567890ABCDEF'].join(''), forbiddenSecretPatterns[1][0]);
  console.log('Public boundary checker self-test passed.');
}

if (args.has('--self-test')) runSelfTest();
else checkRepository();
