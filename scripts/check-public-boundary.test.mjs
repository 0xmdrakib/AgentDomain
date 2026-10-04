import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { repositoryScopeViolation } from './check-public-boundary.mjs';

test('allows the exact reviewed http-cache-semantics 4.3.0 patch file', async () => {
  const path = 'patches/http-cache-semantics@4.3.0.patch';
  const patch = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  assert.match(patch, /^diff --git a\/index\.js b\/index\.js\r?\n/);
  assert.equal(repositoryScopeViolation(path), null);
});

test('rejects neighboring unapproved patches and the patches directory itself', () => {
  for (const path of [
    'patches',
    'patches/http-cache-semantics@4.3.1.patch',
    'patches/http-cache-semantics@4.2.0.patch',
    'patches/another-package@4.3.0.patch',
    'patches/http-cache-semantics@4.3.0.patch.bak',
    'patches/nested/http-cache-semantics@4.3.0.patch',
    'patches/http-cache-semantics@4.3.0.patch/private.js',
    'Patches/http-cache-semantics@4.3.0.patch',
  ]) {
    assert.equal(
      repositoryScopeViolation(path),
      path === 'patches' ? 'unapproved root file' : 'unapproved top-level directory',
      path,
    );
  }
});

test('preserves the existing public boundary checker self-tests', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./check-public-boundary.mjs', import.meta.url)), '--self-test'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'Public boundary checker self-test passed.');
});
