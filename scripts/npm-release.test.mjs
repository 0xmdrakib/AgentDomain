import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  PACKAGES,
  VERSION,
  releaseRows,
  publishEnvironment,
  publishRelease,
} from './npm-release.mjs';

const rows =
  PACKAGES.map(
    (name) => `@agentdomain/${name}\t${VERSION}\tpackages/agentdomain-${name}-${VERSION}.tgz`,
  ).join('\n') + '\n';
const env = {
  GITHUB_REPOSITORY: '0xmdrakib/AgentDomain',
  GITHUB_REF: 'refs/heads/main',
  NODE_AUTH_TOKEN: 'old',
  NPM_BOOTSTRAP_TOKEN: 'sensitive-test',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-test',
};
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentdomain-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'packages'));
  writeFileSync(join(root, 'publish-order.tsv'), rows);
  for (const [, , file] of releaseRows(rows)) writeFileSync(join(root, file), 'immutable');
  return root;
}

test('six exact names, versions, order and safe paths only', () => {
  assert.equal(releaseRows(rows).length, 6);
  for (const bad of [
    rows.replace('/sdk\t', '/other\t'),
    rows.replaceAll('0.11.0', '0.11.1'),
    rows + rows,
    rows.replace('packages/agentdomain-shared', '../agentdomain-shared'),
    rows.replaceAll('\t', ' '),
  ])
    assert.throws(() => releaseRows(bad), /NPM_RELEASE_REFUSED/);
});
test('bootstrap child environment is exact-target only and strips ambient credentials', () => {
  const ordinary = publishEnvironment(env, '@agentdomain/sdk', VERSION, undefined, false);
  assert.equal(ordinary.NPM_BOOTSTRAP_TOKEN, undefined);
  assert.equal(ordinary.NODE_AUTH_TOKEN, undefined);
  assert.equal(ordinary.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'oidc-test');
  const boot = publishEnvironment(env, '@agentdomain/langchain-plugin', VERSION, 'test-only', true);
  assert.equal(boot.NODE_AUTH_TOKEN, 'test-only');
  assert.equal(boot.NPM_CONFIG_IGNORE_SCRIPTS, 'true');
  assert.equal(boot.NPM_CONFIG_FETCH_RETRIES, '0');
  assert.throws(() => publishEnvironment(env, '@agentdomain/sdk', VERSION, 'test-only', true));
  assert.throws(() =>
    publishEnvironment(env, '@agentdomain/langchain-plugin', '0.11.1', 'test-only', true),
  );
});
test('five OIDC children receive no bootstrap token, even if caller mistakenly supplied one', async (t) => {
  const calls = [];
  await publishRelease({
    root: fixture(t),
    npmCli: '/verified/npm-cli.js',
    mode: 'oidc',
    env,
    token: 'test-only',
    lookup: async () => ({ status: 404 }),
    run: async (...call) => {
      calls.push(call);
      return 0;
    },
  });
  assert.equal(calls.length, 5);
  for (const [, args, childEnv] of calls) {
    assert(args.includes('--ignore-scripts'));
    assert(args.includes('--provenance'));
    assert.equal(childEnv.NODE_AUTH_TOKEN, undefined);
    assert.equal(childEnv.NPM_BOOTSTRAP_TOKEN, undefined);
  }
});
test('one missing project bootstrap receives token only in env, never argv', async (t) => {
  const calls = [];
  await publishRelease({
    root: fixture(t),
    npmCli: '/verified/npm-cli.js',
    mode: 'bootstrap',
    env,
    token: 'test-only',
    lookup: async () => ({ status: 404 }),
    run: async (...call) => {
      calls.push(call);
      return 0;
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].NODE_AUTH_TOKEN, 'test-only');
  assert(!calls[0][1].join(' ').includes('test-only'));
});
test('existing project or absent optional token uses OIDC without bootstrap', async (t) => {
  for (const token of ['test-only', undefined]) {
    const calls = [];
    await publishRelease({
      root: fixture(t),
      npmCli: '/verified/npm-cli.js',
      mode: 'bootstrap',
      env,
      token,
      lookup: async (path) => ({ status: path.endsWith(VERSION) ? 404 : 200 }),
      run: async (...call) => {
        calls.push(call);
        return 0;
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][2].NODE_AUTH_TOKEN, undefined);
  }
});
test('network/auth errors fail closed and unknown publish is not retried', async (t) => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    await assert.rejects(
      publishRelease({
        root: fixture(t),
        npmCli: 'npm',
        mode: 'oidc',
        env,
        lookup: async () => ({ status }),
        run: async () => {
          calls++;
          return 0;
        },
      }),
    );
    assert.equal(calls, 0);
  }
  let calls = 0;
  await assert.rejects(
    publishRelease({
      root: fixture(t),
      npmCli: 'npm',
      mode: 'oidc',
      env,
      lookup: async () => ({ status: 404 }),
      run: async () => {
        calls++;
        return null;
      },
    }),
  );
  assert.equal(calls, 1);
});
test('already published artifact must match exact immutable integrity', async (t) => {
  const root = fixture(t);
  const integrity = `sha512-${createHash('sha512').update('immutable').digest('base64')}`;
  const lookup = async () => ({
    status: 200,
    body: { name: '@agentdomain/langchain-plugin', version: VERSION, dist: { integrity } },
  });
  await publishRelease({
    root,
    npmCli: 'npm',
    mode: 'bootstrap',
    env,
    lookup,
    run: () => {
      throw Error('must not publish');
    },
  });
  writeFileSync(join(root, `packages/agentdomain-langchain-plugin-${VERSION}.tgz`), 'changed');
  await assert.rejects(publishRelease({ root, npmCli: 'npm', mode: 'bootstrap', env, lookup }));
});
test('wrong source context refuses before lookup', async (t) => {
  await assert.rejects(
    publishRelease({
      root: fixture(t),
      mode: 'bootstrap',
      env: { ...env, GITHUB_REF: 'refs/heads/feature' },
      lookup: () => {
        throw Error('must not lookup');
      },
    }),
    /NPM_RELEASE_REFUSED/,
  );
});
test('workflow confines secret to single final step; PyPI has no static token fallback', () => {
  const npm = readFileSync(
    new URL('../.github/workflows/publish-npm.yml', import.meta.url),
    'utf8',
  );
  assert.equal(npm.split('secrets.NPM_BOOTSTRAP_TOKEN').length - 1, 1);
  assert(npm.indexOf('secrets.NPM_BOOTSTRAP_TOKEN') > npm.indexOf('oidc\n'));
  assert.match(npm, /npm_config_ignore_scripts: 'true'/);
  const python = readFileSync(
    new URL('../.github/workflows/publish-python.yml', import.meta.url),
    'utf8',
  );
  assert.match(python, /name: pypi-production/);
  assert.match(python, /attestations: true/);
  assert.match(python, /skip-existing: false/);
  assert(!python.includes('secrets.'));
  assert(python.indexOf('verify-release-ci.mjs') < python.indexOf('build-python --output'));
  assert(!python.split('\n  publish:')[1].includes('actions/checkout'));
});

test('first Python release installs framework dependencies before forcibly installing local wheels', () => {
  const input = readFileSync(
    new URL('../packages/mcp-server/examples/autogen/framework-requirements.txt', import.meta.url),
    'utf8',
  );
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  assert(lines.length > 0);
  for (const line of lines) {
    assert.match(
      line,
      /^(?:autogen-(?:agentchat|core|ext)(?:\[mcp\])?|mcp|pydantic)==[0-9]+\.[0-9]+\.[0-9]+$/,
    );
    assert(!line.includes('agentdomain'));
  }
  for (const file of ['public-ci.yml', 'publish-python.yml']) {
    const workflow = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
    assert(!workflow.includes('-r packages/mcp-server/examples/autogen/requirements.txt'));
    assert(
      workflow.indexOf('autogen/framework-requirements.txt') <
        workflow.indexOf('--force-reinstall "$RUNNER_TEMP/python-release/dist/agentdomain_autogen'),
    );
    assert.equal(workflow.split('--no-deps --no-index --force-reinstall').length - 1, 2);
    assert.equal(workflow.split('-m pip check').length - 1, 2);
    assert.equal(workflow.split('find_spec(').length - 1, 2);
  }
});
