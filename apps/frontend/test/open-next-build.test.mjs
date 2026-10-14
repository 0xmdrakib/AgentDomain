import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkOpenNextBuild } from '../scripts/check-open-next.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentdomain-worker-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, '.open-next');
  const assets = join(output, 'assets');
  mkdirSync(assets, { recursive: true });
  writeFileSync(join(output, 'worker.js'), 'export default {};');
  writeFileSync(join(assets, 'BUILD_ID'), 'current-build\n');
  const seed = (build) => {
    const directory = join(assets, 'cdn-cgi/_next_cache', build);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'index.cache'), '{}');
  };
  return { root, assets, seed };
}

test('requires the current build cache in static assets, not only an unused cache directory', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, '.open-next/cache/current-build'), { recursive: true });
  assert.throws(() => checkOpenNextBuild(f.root), /Current prerender cache is missing/);
  f.seed('previous-build');
  assert.throws(() => checkOpenNextBuild(f.root), /Current prerender cache is missing/);
  f.seed('current-build');
  assert.ok(checkOpenNextBuild(f.root).files > 0);
});

test('rejects an empty or escaping build identity instead of accepting unrelated assets', (t) => {
  const f = fixture(t);
  f.seed('current-build');
  for (const buildId of ['', '../current-build', '/current-build']) {
    writeFileSync(join(f.assets, 'BUILD_ID'), buildId);
    assert.throws(() => checkOpenNextBuild(f.root), /Current prerender cache is missing/);
  }
});
