import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { resolve } from 'node:path';
import { frontendRoot } from '../scripts/verify-assets.mjs';

const brand = JSON.parse(readFileSync(resolve(frontendRoot, 'src/lib/brand-assets.json'), 'utf8'));
const assetManifest = JSON.parse(
  readFileSync(resolve(frontendRoot, 'brand-assets.manifest.json'), 'utf8'),
);

// Run explicitly against the local frontend with test/fixtures/public-backend.mjs.
const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:3108');
if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:')
  throw new Error('Smoke tests are loopback-only.');
const id = '00000000-0000-4000-8000-000000000001';
const unavailableId = '00000000-0000-4000-8000-000000000003';

function requestWithHost(path, host) {
  return new Promise((resolveResponse, reject) => {
    const request = httpRequest(
      {
        hostname: origin.hostname,
        port: origin.port,
        path,
        method: 'GET',
        headers: { Host: host },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolveResponse(response));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

test('public profile SSR uses sanitized DTOs without forwarding request credentials', async () => {
  const response = await fetch(new URL(`/agents/${id}`, origin), {
    headers: { cookie: 'synthetic-session=fixture-only', authorization: 'Bearer fixture-only' },
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /example\.test/);
  assert.match(html, /Owner management is private/);
  assert.match(html, /noindex, follow/);
  assert.doesNotMatch(html, /providerIdentity|synthetic-session|fixture-only/);
});

test('registry and sitemap render backend-projected public records', async () => {
  const registry = await fetch(new URL('/registry', origin));
  assert.equal(registry.status, 200);
  const registryHtml = await registry.text();
  const registryText = registryHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(registryHtml, /Enterprise/);
  assert.match(registryText, /\b1 agent\b/);
  assert.doesNotMatch(registryText, /\b1 agents\b/);
  assert.doesNotMatch(registryHtml, /<a[^>]*\sdisabled(?:=|\s|>)/);
  assert.match(registryHtml, /<button[^>]*\sdisabled(?:=""|="disabled")[^>]*>Previous<\/button>/);
  const sitemap = await fetch(new URL('/sitemap-agents.xml', origin));
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get('content-type'), /application\/xml/);
  assert.match(await sitemap.text(), new RegExp(id));
});

test('true missing identity returns 404 and API origin cannot execute business handlers', async () => {
  const missing = await fetch(new URL('/agents/00000000-0000-4000-8000-000000000002', origin));
  assert.equal(missing.status, 404);
  for (const method of ['GET', 'POST', 'OPTIONS']) {
    const response = await fetch(new URL('/api/v1/agents/register', origin), { method });
    assert.equal(response.status, 404);
  }
});

test('backend outage remains an error instead of an empty registry', async () => {
  const response = await fetch(new URL('/registry?q=upstream-error', origin));
  const body = await response.text();
  assert.doesNotMatch(body, /No agents found/);
  assert.ok(response.status >= 500 || body.includes('temporarily unavailable'));
  assert.doesNotMatch(body, /Synthetic upstream failure/);
});

test('agent outage never becomes a fabricated not-found identity', async () => {
  const response = await fetch(new URL(`/agents/${unavailableId}`, origin));
  const body = await response.text();
  assert.ok(response.status >= 500 || body.includes('temporarily unavailable'));
  assert.doesNotMatch(body, /Synthetic upstream failure/);
});

test('all public page families publish the new share image and correctly typed icons', async () => {
  for (const path of [
    '/',
    '/register',
    '/registry',
    '/ai-agent-identity',
    '/privacy',
    '/terms',
    '/dashboard',
    `/agents/${id}`,
  ]) {
    const response = await fetch(new URL(path, origin), {
      headers: { 'user-agent': 'facebookexternalhit/1.1' },
    });
    assert.equal(response.status, 200, path);
    const html = await response.text();
    const head = html.slice(0, html.indexOf('</head>'));
    assert.ok(
      head.includes(
        `property="og:image" content="https://agentdomain.app${brand.assets.socialCard}"`,
      ),
      path,
    );
    assert.ok(
      head.includes(
        `name="twitter:image" content="https://agentdomain.app${brand.assets.socialCard}"`,
      ),
      path,
    );
    assert.ok(
      head.includes(`property="og:image:width" content="${brand.socialImage.width}"`),
      path,
    );
    assert.ok(
      head.includes(`property="og:image:height" content="${brand.socialImage.height}"`),
      path,
    );
    assert.ok(head.includes(`href="${brand.assets.favicon}"`), path);
    assert.ok(head.includes(`href="${brand.assets.faviconIco}"`), path);
    assert.ok(head.includes('type="image/x-icon"'), path);
    assert.ok(head.includes('property="og:image:type" content="image/jpeg"'), path);
    assert.ok(head.includes('sizes="96x96"'), path);
    assert.ok(head.includes(`href="${brand.assets.appleTouchIcon}"`), path);
    assert.doesNotMatch(
      head,
      /\/brand\/(?:brand-mark|social-card|app-icon-256|apple-touch-icon)\.png/,
    );
  }
});

test('favicon serves an actual ICO directly and the share image stays below its delivery budget', async () => {
  for (const [path, type] of [
    [brand.assets.faviconIco, 'image/x-icon'],
    [brand.assets.socialCard, 'image/jpeg'],
  ]) {
    const response = await fetch(new URL(path, origin), { redirect: 'manual' });
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('content-type')?.split(';')[0], type);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, readFileSync(resolve(frontendRoot, `public${path}`)));
    if (type === 'image/jpeg') assert.ok(bytes.length < 600_000);
    else assert.equal(bytes.subarray(0, 4).toString('hex'), '00000100');
  }
});

test('docs redirects preserve paths on the canonical docs origin', async () => {
  for (const [path, destination] of [
    ['/docs', 'https://docs.agentdomain.app/'],
    ['/docs/guides/email', 'https://docs.agentdomain.app/guides/email'],
  ]) {
    const response = await fetch(new URL(path, origin), { redirect: 'manual' });
    assert.equal(response.status, 308, path);
    assert.equal(response.headers.get('location'), destination, path);
  }
});

test('redirect-only routes reject unsafe methods without redirects or body forwarding', async () => {
  for (const path of ['/docs/guides/email', '/api']) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await fetch(new URL(path, origin), {
        method,
        body: method === 'OPTIONS' ? undefined : 'credential=must-not-move',
        redirect: 'manual',
      });
      assert.equal(response.status, 405, `${method} ${path}`);
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('allow'), 'GET, HEAD');
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    }
  }
});

test('unversioned API routes canonicalize and unknown frontend API routes use JSON errors', async () => {
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(new URL('/api?format=json', origin), {
      method,
      redirect: 'manual',
    });
    assert.equal(response.status, 308);
    assert.equal(
      response.headers.get('location'),
      'https://api.agentdomain.app/api/v1?format=json',
    );
  }

  const unknown = await fetch(new URL('/api/v2/private', origin));
  assert.equal(unknown.status, 404);
  assert.match(unknown.headers.get('content-type') ?? '', /application\/json/);
  assert.match(unknown.headers.get('cache-control') ?? '', /no-store/);
  assert.deepEqual(await unknown.json(), {
    error: 'NOT_FOUND',
    message: 'This API route does not exist.',
  });
});

test('www redirects preserve the canonical root, paths and queries', async () => {
  for (const [path, destination] of [
    ['/', 'https://agentdomain.app/'],
    ['/?ref=test', 'https://agentdomain.app/?ref=test'],
    ['/registry?page=2', 'https://agentdomain.app/registry?page=2'],
  ]) {
    const response = await requestWithHost(path, 'www.agentdomain.app');
    assert.equal(response.statusCode, 308, path);
    assert.equal(response.headers.location, destination, path);
  }
});

test('all 41 supplied images are served byte-for-byte and legacy URLs redirect to their replacements', async () => {
  const images = Object.keys(assetManifest.files).filter((file) =>
    file.startsWith('public/brand/agentdomain-brand/'),
  );
  assert.equal(images.length, 41);
  for (const file of images) {
    const response = await fetch(new URL(file.slice('public'.length), origin));
    assert.equal(response.status, 200, file);
    assert.match(
      response.headers.get('content-type') ?? '',
      file.endsWith('.svg') ? /image\/svg\+xml/ : /image\/png/,
    );
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      readFileSync(resolve(frontendRoot, file)),
      file,
    );
  }
  for (const [path, asset] of Object.entries(brand.legacyAliases)) {
    const response = await fetch(new URL(path, origin), { redirect: 'manual' });
    assert.equal(response.status, 308, path);
    assert.equal(
      new URL(response.headers.get('location'), origin).pathname,
      brand.assets[asset],
      path,
    );
  }
});
