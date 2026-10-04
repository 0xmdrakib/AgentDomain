import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// Exercise Astro's actual installed dependency, not a copied or mocked CachePolicy.
// Upstream baseline: kornelski/http-cache-semantics@b1d4bd682fbab0252985de45219f4e7497c0067c.
const docsRequire = createRequire(new URL('../apps/docs/package.json', import.meta.url));
const astroRequire = createRequire(docsRequire.resolve('astro/package.json'));
const CachePolicy = astroRequire('http-cache-semantics');
const url = 'https://cache.example.invalid/account';
const cookie = 'synthetic-session=user-a';

function policyFor({
  cacheControl = 'max-age=600',
  requestHeaders = {},
  responseHeaders = {},
  options = {},
  age = 5,
} = {}) {
  const policy = new CachePolicy(
    { url, method: 'GET', headers: requestHeaders },
    { status: 200, headers: { 'cache-control': cacheControl, ...responseHeaders } },
    options,
  );
  const createdAt = policy.toObject().t;
  policy.now = () => createdAt + age * 1000;
  return policy;
}

function request(headers = {}) {
  return { url, method: 'GET', headers };
}

function assertReuse(policy, headers, expected) {
  const candidate = request(headers);
  assert.equal(policy.satisfiesWithoutRevalidation(candidate), expected);
  const result = policy.evaluateRequest(candidate);
  assert.equal(Boolean(result.response), expected);
  if (expected) assert.equal(result.revalidation, undefined);
  else assert.equal(result.revalidation.synchronous, true);
}

test('uses the official pinned version through Astro dependency resolution', () => {
  assert.equal(astroRequire('http-cache-semantics/package.json').version, '4.3.0');
});

const protectedEntries = [
  {
    name: 'shared Set-Cookie without explicit opt-in',
    responseHeaders: { 'set-cookie': cookie },
    storable: true,
  },
  {
    name: 'shared Set-Cookie with s-maxage but no cookie opt-in',
    cacheControl: 's-maxage=600',
    responseHeaders: { 'set-cookie': cookie },
    storable: true,
  },
  {
    name: 'shared private response',
    cacheControl: 'private, max-age=600',
    responseHeaders: { 'set-cookie': cookie },
    storable: false,
  },
  {
    name: 'authenticated original request without shared-cache permission',
    requestHeaders: { authorization: 'Bearer synthetic-user-a' },
    storable: false,
  },
  { name: 'response no-store', cacheControl: 'public, no-store, max-age=600', storable: false },
  {
    name: 'original request no-store',
    cacheControl: 'public, max-age=600',
    requestHeaders: { 'cache-control': 'no-store' },
    storable: false,
  },
  { name: 'response no-cache', cacheControl: 'public, no-cache, max-age=600', storable: true },
  {
    name: 'shared proxy-revalidate',
    cacheControl: 'public, proxy-revalidate, max-age=600',
    storable: true,
  },
  {
    name: 'no-cache with stale extensions',
    cacheControl: 'public, no-cache, max-age=600, stale-while-revalidate=60, stale-if-error=60',
    storable: true,
  },
];

for (const entry of protectedEntries) {
  test(`refuses max-stale reuse: ${entry.name}`, () => {
    const policy = policyFor(entry);
    assert.equal(policy.storable(), entry.storable);
    assert.equal(policy.maxAge(), 0);
    const restored = CachePolicy.fromObject(JSON.parse(JSON.stringify(policy.toObject())));
    restored.now = policy.now;
    for (const cached of [policy, restored]) {
      for (const directive of ['max-stale=999999', 'max-stale']) {
        const candidate = request({ 'cache-control': directive });
        // Simulate the documented cached-body/header delivery path from the actual PoC.
        const delivered = cached.satisfiesWithoutRevalidation(candidate)
          ? { body: 'synthetic user-a account', headers: cached.responseHeaders() }
          : undefined;
        assert.equal(delivered, undefined, `${entry.name}: ${directive}`);
        const result = cached.evaluateRequest(candidate);
        assert.equal(result.response, undefined);
        assert.equal(result.revalidation.synchronous, true);
      }
    }
  });
}

test('fresh public responses and ordinary expired public max-stale remain usable', () => {
  assertReuse(policyFor({ cacheControl: 'public, max-age=60', age: 30 }), {}, true);
  const expired = policyFor({ cacheControl: 'public, max-age=60', age: 70 });
  assertReuse(expired, {}, false);
  assertReuse(expired, { 'cache-control': 'max-stale=20' }, true);
  assertReuse(expired, { 'cache-control': 'max-stale=5' }, false);
  assertReuse(expired, { 'cache-control': 'max-stale' }, true);
});

test('ordinary public max-age=0 is not confused with a security prohibition', () => {
  const policy = policyFor({ cacheControl: 'public, max-age=0' });
  assert.equal(policy.storable(), true);
  assert.equal(policy.maxAge(), 0);
  assertReuse(policy, {}, false);
  assertReuse(policy, { 'cache-control': 'max-stale=10' }, true);
});

test('explicit public and immutable cookie opt-ins retain upstream behavior', () => {
  for (const optIn of ['public', 'immutable']) {
    const policy = policyFor({
      cacheControl: `${optIn}, max-age=60`,
      responseHeaders: { 'set-cookie': cookie },
      age: 70,
    });
    assertReuse(policy, { 'cache-control': 'max-stale=20' }, true);
    assert.equal(policy.responseHeaders()['set-cookie'], cookie);
  }
});

test('explicitly public authenticated responses remain shareable', () => {
  const policy = policyFor({
    cacheControl: 'public, max-age=60',
    requestHeaders: { authorization: 'Bearer synthetic-user-a' },
    age: 70,
  });
  assertReuse(policy, { 'cache-control': 'max-stale=20' }, true);
  assertReuse(
    policyFor({
      cacheControl: 's-maxage=60',
      requestHeaders: { authorization: 'Bearer synthetic-user-a' },
    }),
    {},
    true,
  );
});

test('single-user private, cookie, authenticated and proxy-revalidate caches still work', () => {
  for (const cacheControl of ['private, max-age=60', 'max-age=60, proxy-revalidate']) {
    const policy = policyFor({
      cacheControl,
      requestHeaders: { authorization: 'Bearer synthetic-user-a' },
      responseHeaders: { 'set-cookie': cookie },
      options: { shared: false },
      age: 70,
    });
    assertReuse(policy, { 'cache-control': 'max-stale=20' }, true);
  }
});

test('Vary still partitions both fresh and stale public representations', () => {
  for (const age of [5, 70]) {
    const policy = policyFor({
      cacheControl: 'public, max-age=60',
      requestHeaders: { 'accept-language': 'en' },
      responseHeaders: { vary: 'Accept-Language' },
      age,
    });
    assertReuse(policy, { 'accept-language': 'en', 'cache-control': 'max-stale=20' }, true);
    assertReuse(policy, { 'accept-language': 'fr', 'cache-control': 'max-stale=20' }, false);
    assertReuse(policy, { 'cache-control': 'max-stale=20' }, false);
  }
});

test('upstream 4.3 Vary wildcard and inherited-property fixes are retained', () => {
  for (const vary of ['*', ' * ', '*, accept-language', 'accept-language, *']) {
    assertReuse(
      policyFor({ cacheControl: 'public, max-age=60', responseHeaders: { vary } }),
      { 'cache-control': 'max-stale' },
      false,
    );
  }
  const policy = policyFor({
    cacheControl: 'public, max-age=60',
    requestHeaders: { constructor: 'own-value' },
    responseHeaders: { vary: 'constructor' },
  });
  assertReuse(policy, { constructor: 'own-value' }, true);
  assertReuse(policy, Object.create({ constructor: 'own-value' }), false);
});

test('request restrictions and must-revalidate still require revalidation', () => {
  const publicPolicy = policyFor({ cacheControl: 'public, max-age=60' });
  for (const headers of [
    { 'cache-control': 'no-cache, max-stale' },
    { pragma: 'no-cache' },
    { 'cache-control': 'max-age=1, max-stale' },
  ]) {
    assertReuse(publicPolicy, headers, false);
  }
  assertReuse(
    policyFor({ cacheControl: 'public, must-revalidate, max-age=0' }),
    { 'cache-control': 'max-stale' },
    false,
  );
  assert.throws(
    () => publicPolicy.satisfiesWithoutRevalidation({ url }),
    /Request headers missing/,
  );
});

test('ordinary public stale-while-revalidate behavior is unchanged', () => {
  const policy = policyFor({
    cacheControl: 'public, max-age=60, stale-while-revalidate=20',
    age: 70,
  });
  const result = policy.evaluateRequest(request());
  assert.ok(result.response);
  assert.equal(result.revalidation.synchronous, false);
  assert.equal(policy.satisfiesWithoutRevalidation(request()), false);
});

test('Astro remote-image loading and conditional revalidation still work', async () => {
  const remoteUrl = new URL(
    './dist/assets/build/remote.js',
    pathToFileURL(astroRequire.resolve('astro/package.json')),
  );
  const { loadRemoteImage, revalidateRemoteImage } = await import(remoteUrl);
  const src = 'https://images.example.invalid/logo.png';
  const image = await loadRemoteImage(src, async (incoming) => {
    assert.equal(incoming.headers.get('cookie'), null);
    assert.equal(incoming.headers.get('authorization'), null);
    return new Response('synthetic image bytes', {
      headers: { 'cache-control': 'public, max-age=600', etag: 'synthetic-etag' },
    });
  });
  assert.equal(image.data.toString(), 'synthetic image bytes');
  assert.equal(image.etag, 'synthetic-etag');
  const revalidated = await revalidateRemoteImage(src, image, async (incoming) => {
    assert.equal(incoming.headers.get('if-none-match'), 'synthetic-etag');
    return new Response(null, {
      status: 304,
      headers: { 'cache-control': 'public, max-age=600', etag: 'synthetic-etag' },
    });
  });
  assert.equal(revalidated.data, null);
  assert.equal(revalidated.etag, 'synthetic-etag');
});
