import assert from 'node:assert/strict';
import test from 'node:test';
import config from '../open-next.config';

test('Cloudflare can read generated routes from the deployment assets without a mutable cache', async () => {
  const cache = config.default?.override?.incrementalCache;
  assert.equal(typeof cache, 'function');
  if (typeof cache !== 'function') throw new Error('Missing prerendered route cache');
  assert.equal((await cache()).name, 'cf-static-assets-incremental-cache');
  assert.equal(config.default?.override?.queue, 'dummy');
  assert.equal(config.default?.override?.tagCache, 'dummy');
  assert.equal(config.dangerous?.enableCacheInterception, false);
});
