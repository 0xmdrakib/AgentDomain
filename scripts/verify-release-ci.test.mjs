import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
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
