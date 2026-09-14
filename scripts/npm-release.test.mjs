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

test('Python project choice never narrows validation or native integration tests', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/publish-python.yml', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n');
  assert.match(workflow, /^on:\n  workflow_dispatch:\n    inputs:\n      project:\n/m);
  const choice = workflow.match(/^      project:\n((?: {8}.+\n)+)/m)?.[1];
  assert.equal(typeof choice, 'string');
  assert.match(choice, /^        required: true$/m);
  assert.match(choice, /^        type: choice$/m);
  assert.match(choice, /^        default: all$/m);
  assert.deepEqual(
    [...choice.matchAll(/^          - (.+)$/gm)].map((match) => match[1]),
    ['all', 'agentdomain-crewai', 'agentdomain-autogen'],
  );

  const validation = workflow.split('\n  validate:\n')[1].split('\n  publish:\n')[0];
  assert.doesNotMatch(validation, /inputs\.project|PROJECT_TO_PUBLISH|--project/);
  assert.doesNotMatch(validation, /^ {6,}(?:if|continue-on-error):/m);
  assert.doesNotMatch(validation, /id-token: write/);
  assert.match(validation, /actions: read/);
  assert.match(
    validation,
    /release-manifest-sha256: \$\{\{ steps\.build\.outputs\.release-manifest-sha256 \}\}/,
  );
  assert.match(validation, /verifier-sha256: \$\{\{ steps\.build\.outputs\.verifier-sha256 \}\}/);
  const commands = [
    'node scripts/verify-release-ci.mjs',
    'python -B -m unittest discover -s scripts -p test_release_artifacts.py',
    'build-python --output "$RUNNER_TEMP/python-release"',
    'cp scripts/release-artifacts.py "$RUNNER_TEMP/python-release/verifier.py"',
    'AGENTDOMAIN_CREWAI_PYTHON="$RUNNER_TEMP/crewai/bin/python" node packages/mcp-server/test/crewai-integration.mjs',
    'AGENTDOMAIN_AUTOGEN_PYTHON="$RUNNER_TEMP/autogen/bin/python" node --test packages/mcp-server/test/autogen.integration.test.mjs',
    'uses: actions/upload-artifact@',
  ];
  let previous = -1;
  for (const command of commands) {
    const index = validation.indexOf(command);
    assert.ok(index > previous, `${command} must run unconditionally in validation order`);
    previous = index;
  }
});

test('Python publishing stages a fixed verified subset before the pinned OIDC action', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/publish-python.yml', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n');
  const validation = workflow.split('\n  validate:\n')[1].split('\n  publish:\n')[0];
  const publish = workflow.split('\n  publish:\n')[1];
  for (const job of [validation, publish]) {
    assert.equal(
      job.split('\n').find((line) => line.startsWith('    if:')),
      "    if: github.ref == 'refs/heads/main' && github.repository == '0xmdrakib/AgentDomain'",
    );
  }
  assert.match(workflow, /^concurrency:\n  group: publish-python\n  cancel-in-progress: false$/m);
  assert.match(publish, /^    needs: validate$/m);
  assert.match(publish, /^    environment:\n      name: pypi-production$/m);
  assert.match(publish, /^    permissions:\n      contents: read\n      id-token: write$/m);
  assert.match(
    publish,
    /EXPECTED_RELEASE_MANIFEST_SHA256: \$\{\{ needs\.validate\.outputs\.release-manifest-sha256 \}\}/,
  );
  assert.match(
    publish,
    /EXPECTED_VERIFIER_SHA256: \$\{\{ needs\.validate\.outputs\.verifier-sha256 \}\}/,
  );
  assert.match(publish, /^          PROJECT_TO_PUBLISH: \$\{\{ inputs\.project \}\}$/m);
  assert.equal(workflow.split('${{ inputs.project }}').length - 1, 1);

  const command =
    'python -B release-inputs/verifier.py stage-python --output release-inputs --project "$PROJECT_TO_PUBLISH"';
  const steps = publish.split('\n      - ').slice(1);
  const stage = steps.find((step) => step.includes(command));
  assert.equal(typeof stage, 'string');
  const script = stage.split('\n        run: |\n')[1];
  assert.equal(typeof script, 'string');
  assert.doesNotMatch(script, /\$\{\{/);
  assert.match(script, /set -euo pipefail/);
  assert.match(script, /\[\[ "\$EXPECTED_VERIFIER_SHA256" =~ \^\[0-9a-f\]\{64\}\$ \]\]/);
  const hashCheck = script.indexOf(
    'printf \'%s  release-inputs/verifier.py\\n\' "$EXPECTED_VERIFIER_SHA256" | sha256sum --check --status',
  );
  assert.ok(hashCheck >= 0 && script.indexOf(command) > hashCheck);
  assert.equal(steps.indexOf(stage), steps.length - 2);
  const upload = steps.at(-1);
  assert.match(
    upload,
    /^        uses: pypa\/gh-action-pypi-publish@dc37677b2e1c63e2034f94d8a5b11f265b73ba33 # release\/v1$/m,
  );
  assert.match(upload, /^          packages-dir: release-inputs\/publish-dist\/$/m);
  assert.match(upload, /^          attestations: true$/m);
  assert.match(upload, /^          skip-existing: false$/m);
  assert.match(upload, /^          print-hash: true$/m);
  assert.doesNotMatch(publish, /actions\/checkout|build-python|pip install|secrets\.|password:/);
  assert.doesNotMatch(publish, /^ {6,}(?:if|continue-on-error):/m);
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
