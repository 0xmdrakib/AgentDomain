import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parsers } from 'prettier/plugins/yaml';
import { RELEASE_CI_LIMITS, verifyReleaseCi } from './verify-release-ci.mjs';

const context = {
  repository: '0xmdrakib/AgentDomain',
  ref: 'refs/heads/main',
  sha: 'a'.repeat(40),
};
const run = {
  id: 1,
  head_sha: context.sha,
  head_branch: 'main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  path: '.github/workflows/public-ci.yml',
  repository: { full_name: context.repository },
  head_repository: { full_name: context.repository },
};

test('requires successful Public CI for the exact public main commit', () => {
  assert.equal(verifyReleaseCi({ workflow_runs: [run] }, context), 1);
  for (const patch of [
    { repository: 'someone/AgentDomain' },
    { ref: 'refs/heads/codex/feature' },
    { sha: 'a'.repeat(39) },
  ])
    assert.throws(() => verifyReleaseCi({ workflow_runs: [run] }, { ...context, ...patch }));
});

test('rejects skipped, failed, unrelated, fork and pull-request checks', () => {
  for (const patch of [
    { id: '1' },
    { id: -1 },
    { head_sha: 'b'.repeat(40) },
    { head_branch: 'codex/feature' },
    { event: 'pull_request' },
    { status: 'in_progress' },
    { conclusion: 'skipped' },
    { conclusion: 'failure' },
    { path: '.github/workflows/publish-npm.yml' },
    { repository: { full_name: 'someone/AgentDomain' } },
    { head_repository: { full_name: 'someone/AgentDomain' } },
    { head_repository: null },
  ])
    assert.throws(() => verifyReleaseCi({ workflow_runs: [{ ...run, ...patch }] }, context));
  for (const payload of [null, {}, { workflow_runs: [] }, { workflow_runs: Array(11).fill(run) }])
    assert.throws(() => verifyReleaseCi(payload, context));
});

test('CLI rejects malformed and oversized bodies without logging their contents', () => {
  const filename = fileURLToPath(new URL('./verify-release-ci.mjs', import.meta.url));
  for (const input of ['private-body-marker', 'x'.repeat(RELEASE_CI_LIMITS.maxBytes + 1)]) {
    const result = spawnSync(process.execPath, [filename], { input, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /private-body-marker|xxxxxxxx/);
    assert.equal(result.stdout, '');
  }
});

test('publish validation requires this check before packing, with read-only Actions access', async () => {
  const source = await readFile(
    new URL('../.github/workflows/publish-npm.yml', import.meta.url),
    'utf8',
  );
  const validation = source.split('\n  publish:')[0];
  assert.match(validation, /actions: read/);
  assert.match(validation, /head_sha="\$GITHUB_SHA"/);
  assert.match(validation, /event=push/);
  assert.match(validation, /branch=main/);
  assert.match(validation, /status=success/);
  assert.match(validation, /per_page=10/);
  assert.ok(
    validation.indexOf('node scripts/verify-release-ci.mjs') <
      validation.indexOf('pack_release packages/shared'),
  );
  const publish = source.split('\n  publish:')[1];
  assert.doesNotMatch(publish, /actions: write|contents: write/);
});

// Use the existing formatter's YAML parser, keeping scalar text uncoerced (including "on").
function yamlValue(node) {
  if (!node) return null;
  if (['mapping', 'flowMapping'].includes(node.type)) {
    const entries = node.children.map(({ children }) => children.map(yamlValue));
    assert.equal(new Set(entries.map(([key]) => key)).size, entries.length, 'Duplicate YAML key');
    return Object.fromEntries(entries);
  }
  if (['sequence', 'flowSequence'].includes(node.type)) return node.children.map(yamlValue);
  if (['plain', 'quoteSingle', 'quoteDouble', 'blockLiteral', 'blockFolded'].includes(node.type))
    return node.value;
  assert.ok(
    ['documentBody', 'mappingKey', 'mappingValue', 'sequenceItem', 'flowSequenceItem'].includes(
      node.type,
    ),
    `Unsupported YAML node: ${node.type}`,
  );
  assert.ok(node.children.length <= 1);
  return yamlValue(node.children[0]);
}

async function readYaml(path) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const { children } = parsers.yaml.parse(source);
  assert.equal(children.length, 1, `${path} must have one YAML document`);
  return yamlValue(children[0].children.find(({ type }) => type === 'documentBody'));
}

const workflows = {};
for (const file of await readdir(new URL('../.github/workflows/', import.meta.url))) {
  if (/\.ya?ml$/.test(file)) workflows[file] = await readYaml(`.github/workflows/${file}`);
}

function assertCodeqlPins(steps) {
  const codeql = steps.filter((step) => step.uses?.startsWith('github/codeql-action/'));
  const references = codeql.map(({ uses }) => uses.split('@'));
  assert.equal(references.filter(([action]) => action === 'github/codeql-action/init').length, 1);
  assert.equal(
    references.filter(([action]) => action === 'github/codeql-action/analyze').length,
    1,
  );
  for (const [, sha] of references) assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(
    new Set(references.map(([, sha]) => sha)).size,
    1,
    'CodeQL subactions must share a SHA',
  );
}

test('all workflow actions keep immutable pins and setup actions stay coordinated', () => {
  const setupPins = new Map([
    ['actions/setup-python', new Set()],
    ['pnpm/action-setup', new Set()],
  ]);
  for (const workflow of Object.values(workflows)) {
    for (const job of Object.values(workflow.jobs)) {
      for (const { uses } of [job, ...(job.steps ?? [])]) {
        if (!uses || uses.startsWith('./')) continue;
        assert.match(uses, /(?:@[0-9a-f]{40}|@sha256:[0-9a-f]{64})$/);
        const [action, sha] = uses.split('@');
        setupPins.get(action)?.add(sha);
      }
    }
  }
  for (const [action, pins] of setupPins) assert.equal(pins.size, 1, `${action} pins must agree`);
});

test('CodeQL init and analyze share an immutable release, rejecting either partial update', () => {
  assertCodeqlPins(workflows['codeql.yml'].jobs.analyze.steps);
  const oldSha = 'cdf488f595d80d6e07e03d4674febd5ab45fa938';
  const newSha = 'b96794f015dfd88f77b49b1c93e0fa7110f94c63';
  const pair = (init, analyze) => [
    { uses: `github/codeql-action/init@${init}` },
    { uses: `github/codeql-action/analyze@${analyze}` },
  ];
  assertCodeqlPins(pair(newSha, newSha));
  assert.throws(() => assertCodeqlPins(pair(newSha, oldSha)), /must share a SHA/);
  assert.throws(() => assertCodeqlPins(pair(oldSha, newSha)), /must share a SHA/);
  assert.throws(() => assertCodeqlPins(pair('v4', 'v4')));
  assert.throws(() => assertCodeqlPins(pair(newSha, newSha).slice(0, 1)));
});

test('Dependabot groups CodeQL subactions for version and security updates without ignoring them', async () => {
  const config = await readYaml('.github/dependabot.yml');
  const actions = config.updates.find((update) => update['package-ecosystem'] === 'github-actions');
  assert.equal(actions.directory, '/');
  assert.equal(actions.ignore, undefined);
  assert.equal(actions.allow, undefined);
  for (const [name, appliesTo] of [
    ['codeql-actions', 'version-updates'],
    ['codeql-security-updates', 'security-updates'],
  ]) {
    const group = actions.groups[name];
    assert.equal(group['applies-to'] ?? 'version-updates', appliesTo);
    assert.deepEqual(group.patterns, ['github/codeql-action', 'github/codeql-action/*']);
    assert.equal(group['exclude-patterns'], undefined);
    assert.equal(group['update-types'], undefined);
  }
});

test('CodeQL and dependency review remain mandatory on pull requests with scoped permissions', () => {
  for (const [file, jobName] of [
    ['codeql.yml', 'analyze'],
    ['dependency-review.yml', 'review'],
  ]) {
    const workflow = workflows[file];
    assert.ok(Object.hasOwn(workflow.on, 'pull_request'));
    assert.equal(workflow.on.pull_request, null);
    assert.equal(workflow.on.pull_request_target, undefined);
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    const job = workflow.jobs[jobName];
    assert.equal(job['continue-on-error'], undefined);
    for (const step of job.steps) {
      assert.equal(step.if, undefined);
      assert.equal(step['continue-on-error'], undefined);
    }
  }
  const codeql = workflows['codeql.yml'];
  assert.deepEqual(codeql.on.push.branches, ['main']);
  assert.ok(codeql.on.schedule.some(({ cron }) => cron));
  assert.equal(codeql.jobs.analyze.if, undefined);
  assert.deepEqual(codeql.jobs.analyze.permissions, {
    actions: 'read',
    contents: 'read',
    packages: 'read',
    'security-events': 'write',
  });
  const review = workflows['dependency-review.yml'].jobs.review;
  assert.equal(review.if, 'github.event.pull_request.base.repo.full_name == github.repository');
  assert.equal(review.permissions, undefined);
});

test('setup updates preserve Python and pnpm inputs without removed pip-install usage', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const pnpmVersion = manifest.packageManager.replace(/^pnpm@/, '');
  for (const workflow of Object.values(workflows)) {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith('actions/setup-python@'))
          assert.deepEqual(step.with, { 'python-version': '3.12' });
        if (step.uses?.startsWith('pnpm/action-setup@'))
          assert.deepEqual(step.with, { version: pnpmVersion });
      }
    }
  }
});

test('release OIDC remains isolated to main-only production publishing after validation', () => {
  for (const [file, environment] of [
    ['publish-npm.yml', 'npm-production'],
    ['publish-python.yml', 'pypi-production'],
  ]) {
    const workflow = workflows[file];
    assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.deepEqual(workflow.jobs.validate.permissions, { contents: 'read', actions: 'read' });
    assert.equal(workflow.jobs.validate.environment, undefined);
    const publish = workflow.jobs.publish;
    assert.equal(publish.needs, 'validate');
    for (const job of [workflow.jobs.validate, publish])
      assert.equal(
        job.if,
        "github.ref == 'refs/heads/main' && github.repository == '0xmdrakib/AgentDomain'",
      );
    assert.deepEqual(publish.environment, { name: environment });
    assert.deepEqual(publish.permissions, { contents: 'read', 'id-token': 'write' });
  }
});
