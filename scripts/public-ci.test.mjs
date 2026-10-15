import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { publicLintArgs, runCi } from './public-ci.mjs';

const publicSteps = [
  ['check:public-boundary'],
  ['check:production-licenses'],
  ['audit', '--prod', '--audit-level', 'high'],
  ['format:check'],
  ['lint:public', '--filter=!@agentdomain/langchain-plugin'],
  ['typecheck:public'],
  ['test:public'],
  ['build:public'],
];
const dryRuns = (workspace) =>
  [['--env='], ['--env', 'preview']].map((environment) => [
    '--filter',
    workspace,
    'exec',
    'wrangler',
    'deploy',
    '--dry-run',
    ...environment,
  ]);
const cloudflareSteps = (docsCommand) => [
  ['--filter', '@agentdomain/frontend', 'build:cloudflare'],
  ...dryRuns('@agentdomain/frontend'),
  ['--filter', '@agentdomain/docs', docsCommand],
  ...dryRuns('@agentdomain/docs'),
];

function capture(args) {
  const commands = [];
  runCi(args, (command) => commands.push(command));
  return commands;
}

test('public CI retains every source gate and audits without repeating security tests', () => {
  assert.deepEqual(capture([]), publicSteps);
});

const lintManifest = {
  scripts: {
    'lint:public': 'turbo run lint --filter=!@agentdomain/contracts',
    'typecheck:public': 'turbo run typecheck --filter=!@agentdomain/contracts',
  },
};
const langchainManifest = {
  name: '@agentdomain/langchain-plugin',
  scripts: { lint: 'tsc --noEmit', typecheck: 'tsc --noEmit && tsc -p tsconfig.test.json' },
};

test('only the exact duplicated LangChain compiler command can be deferred to typecheck', () => {
  assert.deepEqual(publicLintArgs(lintManifest, langchainManifest), publicSteps[4]);
  for (const [task, command] of [
    ['lint', 'eslint .'],
    ['lint', 'tsc --noEmit && node extra-lint.mjs'],
    ['typecheck', 'tsc -p tsconfig.test.json'],
    ['typecheck', 'tsc --noEmit || tsc -p tsconfig.test.json'],
    ['typecheck', 'tsc --noEmit --project other.json && tsc -p tsconfig.test.json'],
    ...['prelint', 'postlint', 'pretypecheck', 'posttypecheck'].map((task) => [
      task,
      'node hook.mjs',
    ]),
  ]) {
    assert.deepEqual(
      publicLintArgs(lintManifest, {
        ...langchainManifest,
        scripts: { ...langchainManifest.scripts, [task]: command },
      }),
      ['lint:public'],
      `${task} drift must restore the complete lint gate`,
    );
  }
  for (const task of ['lint:public', 'typecheck:public']) {
    assert.deepEqual(
      publicLintArgs(
        { scripts: { ...lintManifest.scripts, [task]: `pnpm --filter @agentdomain/docs ${task}` } },
        langchainManifest,
      ),
      ['lint:public'],
    );
  }
  for (const changed of [{}, { name: '@agentdomain/docs', scripts: langchainManifest.scripts }]) {
    assert.deepEqual(publicLintArgs(lintManifest, changed), ['lint:public']);
  }
  assert.deepEqual(publicLintArgs({}, langchainManifest), ['lint:public']);
});

test('combined CI validates this invocation before reusing docs and keeps every Worker dry-run', () => {
  assert.deepEqual(capture(['--cloudflare']), [
    ...publicSteps,
    ...cloudflareSteps('validate:output'),
  ]);
});

test('standalone Cloudflare checks never trust output left by another invocation', () => {
  capture(['--cloudflare']);
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(capture(['--cloudflare-only']), cloudflareSteps('check'));
  }
});

test('every failed combined stage stops immediately, including reused docs output validation', () => {
  const expected = [...publicSteps, ...cloudflareSteps('validate:output')];
  for (let failure = 0; failure < expected.length; failure++) {
    const commands = [];
    const error = new Error(`stage ${failure} failed`);
    assert.throws(
      () =>
        runCi(['--cloudflare'], (command) => {
          commands.push(command);
          if (commands.length === failure + 1) throw error;
        }),
      (actual) => actual === error,
    );
    assert.deepEqual(commands, expected.slice(0, failure + 1));
  }
});

test('standalone docs failures prevent both docs dry-runs', () => {
  const commands = [];
  assert.throws(() =>
    runCi(['--cloudflare-only'], (command) => {
      commands.push(command);
      if (command.at(-1) === 'check') throw new Error('docs failed');
    }),
  );
  assert.deepEqual(commands, cloudflareSteps('check').slice(0, 4));
});

test('CLI rejects skip flags, unknown options and combined modes before running commands', () => {
  const filename = fileURLToPath(new URL('./public-ci.mjs', import.meta.url));
  for (const args of [
    ['--reuse-docs'],
    ['--skip-docs'],
    ['--cloudflare', '--cloudflare-only'],
    ['--cloudflare', '--skip-docs'],
  ]) {
    assert.throws(() => runCi(args, () => assert.fail('must not run')), /Usage:/);
    const result = spawnSync(process.execPath, [filename, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
    assert.equal(result.stdout, '');
  }
});

test('standalone audit and test commands retain security coverage, with CI policy tests wired in', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts['ci:public'], 'node scripts/public-ci.mjs');
  assert.equal(manifest.scripts['ci:cloudflare'], 'node scripts/public-ci.mjs --cloudflare-only');
  assert.equal(
    manifest.scripts['audit:production:high'],
    'pnpm test:dependency-security && pnpm audit --prod --audit-level high',
  );
  assert.equal(manifest.scripts['test:public'].match(/\btest:dependency-security\b/g)?.length, 1);
  for (const filename of ['verify-release-ci.test.mjs', 'public-ci.test.mjs']) {
    assert.equal(manifest.scripts['test:public'].split(filename).length - 1, 1);
  }
  for (const filename of ['http-cache-semantics', 'braces', 'production-dependencies']) {
    assert.ok(manifest.scripts['test:dependency-security'].includes(`${filename}.test.mjs`));
  }
});

test('reused docs coverage matches the complete standalone check contract', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const docs = JSON.parse(
    await readFile(new URL('../apps/docs/package.json', import.meta.url), 'utf8'),
  );
  for (const task of ['lint', 'typecheck', 'build']) {
    assert.equal(
      manifest.scripts[`${task}:public`],
      `turbo run ${task} --filter=!@agentdomain/contracts`,
    );
  }
  assert.ok(
    manifest.scripts['test:public'].endsWith('turbo run test --filter=!@agentdomain/contracts'),
  );
  assert.equal(docs.scripts.lint, docs.scripts['validate:content']);
  assert.equal(
    docs.scripts.check,
    'pnpm run validate:content && pnpm run typecheck && pnpm run test && pnpm run build && pnpm run validate:output',
    'New standalone docs gates must also be covered before combined CI reuses their output',
  );
});
